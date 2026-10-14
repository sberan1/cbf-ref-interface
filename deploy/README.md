# Nasazení na VPS (Docker)

Rozhodnutí a důvody: ADR 0007 v `docs/agent-context`.

## Jak to funguje

Workflow `.github/workflows/ci-cd.yml`:

| Job                | Kdy                                 | Co dělá                                                                                                                             |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Lint, types, tests | každý PR a push                     | `npm run lint`, `npm run check`, unit testy, kontrola, že schéma má commitnutou migraci                                             |
| Docker image       | po úspěšném checku                  | build image, smoke test (migrace, `/healthz`, login za proxy, CSRF, CLI). Na `master` push do GHCR jako `:<commit sha>` a `:latest` |
| Deploy to VPS      | `master` (push nebo ruční spuštění) | SSH na VPS, nahraje `compose.yaml` + `deploy.sh`, `docker compose pull` + `up -d`, počká, až je aplikace healthy                    |

Deploy se přeskočí, dokud v repu není proměnná `VPS_HOST`. Ruční redeploy: Actions → CI/CD → Run
workflow (větev `master`).

Na VPS běží jeden image ve více rolích (`compose.yaml`):

| Služba      | Co                                                                       |
| ----------- | ------------------------------------------------------------------------ |
| `db`        | PostgreSQL 17, volume `pgdata`                                           |
| `rabbitmq`  | fronta syncu, management UI na `127.0.0.1:15672`                         |
| `migrate`   | jednorázově aplikuje migrace před každým startem aplikace (idempotentní) |
| `app`       | SvelteKit web na `127.0.0.1:3000`, ven jen přes tvůj nginx               |
| `worker`    | stahování z ČBF a normalizace (1 request / 2–3 s)                        |
| `scheduler` | denní obnova (`CBF_DAILY_AT`, výchozí 04:30) a okno zápasů každých 6 h   |

## 1. Příprava VPS (jednou)

Potřebuješ Docker Engine ≥ 25 s compose pluginem (`docker compose version`).

```sh
# uživatel pro deploy (členství ve skupině docker = root přístup, klíč podle toho chraň)
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -o deploy -g deploy -m 750 /opt/cbf-ref
```

SSH klíč pro GitHub Actions vygeneruj u sebe (bez hesla, jen pro tenhle deploy):

```sh
ssh-keygen -t ed25519 -N "" -C "github-actions cbf-ref" -f cbf-ref-deploy
```

Veřejný klíč `cbf-ref-deploy.pub` přidej na VPS do `/home/deploy/.ssh/authorized_keys`
(adresář `700`, soubor `600`, vlastník `deploy`).

Konfigurace `/opt/cbf-ref/.env` (šablona je `deploy/.env.example`):

```sh
scp deploy/.env.example deploy@<vps>:/opt/cbf-ref/.env
ssh deploy@<vps>
cd /opt/cbf-ref && chmod 600 .env
sed -i "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(openssl rand -hex 24)/; s/^RABBITMQ_PASSWORD=$/RABBITMQ_PASSWORD=$(openssl rand -hex 24)/" .env
```

Hesla se uloží do volumes při prvním startu Postgresu a RabbitMQ. Pozdější změna v `.env` je
nezmění, musel bys je změnit i v databázi (`ALTER USER cbf PASSWORD …`) a v RabbitMQ
(`rabbitmqctl change_password cbf …`).

## 2. Nastavení na GitHubu

Repo → Settings → Secrets and variables → Actions:

**Secrets**

| Název                 | Hodnota                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VPS_SSH_KEY`         | celý obsah privátního klíče `cbf-ref-deploy`                                                                                                               |
| `VPS_SSH_KNOWN_HOSTS` | výstup `ssh-keyscan -t ed25519 <vps>` (s jiným portem `ssh-keyscan -p 2222 …`). Otisk porovnej s `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` na VPS |

**Variables**

| Název             | Hodnota                        |
| ----------------- | ------------------------------ |
| `VPS_HOST`        | hostname nebo IP VPS (povinné) |
| `VPS_USER`        | výchozí `deploy`               |
| `VPS_SSH_PORT`    | výchozí `22`                   |
| `VPS_DEPLOY_PATH` | výchozí `/opt/cbf-ref`         |

Nic dalšího není potřeba. Image publikuje workflow přes `GITHUB_TOKEN` do
`ghcr.io/sberan1/cbf-ref-interface`. Balíček se automaticky propojí s repem a deploy job ho
stejným tokenem stáhne (na VPS po sobě udělá `docker logout`, žádný token tam nezůstává).
Environment `production` vznikne sám při prvním deployi. Jestli chceš deploy ručně schvalovat,
nastav mu v Settings → Environments required reviewers.

## 3. nginx

Vzor je v `deploy/nginx.conf.example` (TLS, basic auth, proxy na `127.0.0.1:3000`). Povinné jsou
tyhle dvě hlavičky:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

Bez nich aplikace nepozná svůj veřejný origin a přihlášení skončí na **403** (SvelteKit u
formulářů kontroluje hlavičku `Origin`). Soubor pro basic auth vytvoříš příkazem
`htpasswd -c /etc/nginx/cbf-ref.htpasswd <jméno>` (balíček `apache2-utils`).

Pokud nginx nebo Traefik běží v Dockeru, není `127.0.0.1:3000` z jeho kontejneru vidět. Na VPS
vytvoř vedle `compose.yaml` soubor `compose.override.yaml`. Compose ho načte automaticky a CI ho
nepřepisuje. Např. připojení `app` do sítě proxy:

```yaml
services:
  app:
    networks: [default, proxy]
networks:
  proxy:
    external: true
```

Proxy pak míří na `http://app:3000` (u Traefiku přidej labels do stejného override).

## 4. První spuštění

1. Dokonči kroky 1–3, potom mergni PR do `master`. Workflow image sestaví, publikuje a nasadí.
   Průběh uvidíš v Actions, na VPS přes `docker compose ps` v `/opt/cbf-ref`.
2. Ověř stav:

   ```sh
   cd /opt/cbf-ref
   docker compose ps                         # app (healthy), worker, scheduler, db, rabbitmq běží
   curl -s localhost:3000/healthz            # {"ok":true}
   docker compose logs -f worker scheduler   # scheduler hned zařadí aktuální sezónu
   ```

3. Spusť stažení historie (jednou). Scheduler sám stahuje jen aktuální sezónu a okno zápasů.
   Historii 20 sezón zařadíš ručně:

   ```sh
   docker compose exec worker node dist/cbf.js bootstrap
   ```

   Při 1 requestu / 2–3 s to poběží řádově **1–2 týdny** (odhad v ADR 0005). Jde se nejnovější
   sezónou napřed a průběžné obnovy mají ve frontě přednost. Restarty a deploye nevadí: co je
   stažené a čerstvé, se znovu nestahuje.

4. Sleduj průběh:

   ```sh
   docker compose exec worker node dist/cbf.js stats     # fronty, počty řádků, requesty za hodinu
   ssh -L 15672:127.0.0.1:15672 deploy@<vps>             # pak http://localhost:15672 (cbf / heslo z .env)
   ```

5. Přihlášení: otevři svou doménu, projdi basic auth, vyhledej se a klikni „To jsem já“.
   Rozhodčí jsou jen v detailech zápasů. Najdeš se tedy až po stažení aktuální sezóny (první
   hodiny), starší zápasy přibývají s bootstrapem.

## Provoz

- **Logy:** `docker compose logs -f app worker scheduler`. Rotují se (5 × 10 MB na kontejner).
- **Ruční příkazy syncu:** `docker compose exec worker node dist/cbf.js help`, kompletní přehled
  je v hlavním README.
- **Rollback:** `IMAGE_TAG=<commit sha> docker compose up -d` (image posledních 14 dní zůstávají
  na VPS), nebo v Actions znovu spusť deploy job staršího běhu. Pozor, migrace se nevracejí.
  Starší kód musí zvládnout novější schéma.
- **Záloha DB** (obsahuje osobní údaje, ukládej ji bezpečně), např. denně z cronu na hostu:

  ```sh
  cd /opt/cbf-ref && docker compose exec -T db pg_dump -U cbf -Fc cbf > /var/backups/cbf-ref-$(date +%F).dump
  ```

  Obnova: `docker compose exec -T db pg_restore -U cbf -d cbf --clean --if-exists < soubor.dump`.

- **Upgrade Postgresu:** image je zamčený na `postgres:17`. Přechod na novou major verzi znamená
  dump a restore, ne jen změnu tagu.
- **Lokální test produkčního image:** `docker build -t cbf-ref:test . && scripts/docker-smoke-test.sh cbf-ref:test`.
