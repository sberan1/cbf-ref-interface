# cbf-ref-interface

Rozhraní nad daty ČBF pro rozhodčí (delegace, zápasy, komisaři). Aplikace čte jen z vlastní
databáze. Data z XML/JSON exportu ČBF stahuje sync worker (ADR 0001).

Stack: SvelteKit + Drizzle + PostgreSQL. Fronta syncu běží na RabbitMQ.
Rozhodnutí a kontext jsou ve znalostní bázi `docs/agent-context` (git submodul,
[sberan1/cbf-ref-interface-agent-context](https://github.com/sberan1/cbf-ref-interface-agent-context)).
Před změnou architektury si přečti její README a platné ADR.

```sh
git submodule update --init
```

## Lokální vývoj

```sh
cp .env.example .env
npm install
npm run db:start          # PostgreSQL + RabbitMQ (docker compose), management UI na :15672
npm run db:migrate        # aplikuje migrace z drizzle/
npm run dev
```

Po změně schématu (`src/lib/server/db/schema/`) vygeneruj migraci příkazem `npm run db:generate`
a commitni ji.

## Sync dat z ČBF

Struktura (`src/lib/server/cbf/`):

| Modul                     | Účel                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `endpoints.ts`            | registr v1/v2 endpointů, kanonický `request_key`                    |
| `http.ts`, `rate-limiter` | HTTP klient: 1 request / 2–3 s, pauza při 403/429/503               |
| `parse/`                  | tolerantní parsery v1 XML a v2 JSON → typované objekty              |
| `pipeline/fetch.ts`       | fetch krok: kontrola čerstvosti → request → `ingest.raw_payload`    |
| `pipeline/normalize.ts`   | normalize krok: poslední payload → `cbf.*` tabulky, expanze potomků |
| `normalize/`              | mapování na tabulky, delegace a jejich historie                     |
| `queue/broker.ts`         | RabbitMQ topologie (fetch / normalize, retry 30s/5m/30m, dead)      |
| `scheduler.ts`            | kořenové úlohy: bootstrap, daily, window                            |
| `discovery/`              | vzorkování všech endpointů do souborů (ověření skutečného schématu) |

Datové vrstvy (ADR 0004): `ingest.raw_payload` drží každou odpověď beze změny (deduplikace hashem),
`ingest.fetch_state` stav a plán obnovy každého zdroje, `ingest.fetch_log` audit všech requestů.
Ve schématu `cbf.*` je normalizovaná vrstva: sezóny, soutěže, fáze, týmy, zápasy, rozhodčí,
delegace a jejich historie, tabulky a hráči.

### Příkazy

```sh
npm run cbf -- help
npm run cbf -- discover                 # nejdřív: vzorky endpointů do discovery/out/ (bez DB a fronty)
npm run cbf:worker                      # consumer fronty (fetch + normalize), Ctrl+C = čisté ukončení
npm run cbf -- bootstrap                # posledních 20 sezón + aktuální, nejnovější první
npm run cbf -- daily                    # obnova aktuální sezóny (1× denně)
npm run cbf -- window                   # detaily zápasů v okně −3/+14 dní (po pár hodinách)
npm run cbf -- scheduler                # trvale běžící plánovač daily + window (místo cronu)
npm run cbf -- fetch v2.game game=273093 --force
npm run cbf -- renormalize --endpoint v2.games --force   # přepočet z raw dat, bez HTTP
npm run cbf -- stats                    # hloubka front, počty řádků, requesty za poslední hodinu
npm run cbf -- requeue-dead --queue fetch
```

Fetch fronta má jediného aktivního consumera, takže limit 1 request / 2–3 s platí i při víc
spuštěných workerech. Bootstrap jde přerušit a znovu spustit: co je stažené a čerstvé, se znovu
nestahuje. Discovery ale používá vlastní limiter, takže ji nespouštěj zároveň s workerem.

Mapování polí je ověřené na živých vzorcích z discovery 2026-10-14 (sezóny 2026/27 a 2012/13,
viz `docs/agent-context/history/20261014-scaffold-cbf-ingestu.md`). Výchozí host je `cbf.cz`
(`CBF_BASE_URL`).

Hlavní zvláštnosti exportu:

- v1 identifikuje osoby a týmy „group“ ID (v2 `uNgroup` / `groupby`), v DB jsou ve sloupcích
  `group_id`.
- `score_quarter` obsahuje průběžný stav po čtvrtinách, ne body za čtvrtinu.
- Rozhodčí jsou jen v detailu zápasu. ID 0 se jménem „Delegováno“ znamená, že delegace ještě není
  zveřejněná.

Za HTTP proxy (např. cloudový sandbox) potřebuje Node `fetch` proměnnou `NODE_USE_ENV_PROXY=1`
(Node ≥ 22.21).

## Aplikace

- **Přihlášení** přes Google (ADR 0008). Účet se spáruje se záznamem rozhodčího po schválení
  správcem (`/admin`).
- **Přehled** (`/dashboard`): zápasy v čase, odměny za řízení podle sazebníků (PDR 0002) a součty
  náhrad.
- **Cesty a náhrady** (`/trips`): cestovné, stravné a náhrada za všední den po dnech (PDR 0003).
  Průvodce ke každému dni zaznamená, kde jsi nabral a vysadil kolegy. Vzdálenosti počítá
  Mapy.com.
- **Profil** (`/profile`): bydliště a uložená místa.

Lokálně potřebuješ `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (redirect
`http://localhost:5173/login/google/callback`) a svůj e-mail v `ADMIN_EMAILS`. `MAPY_API_KEY` je
volitelný.

## Nasazení

Produkce běží v Dockeru na VPS. Jeden image slouží pro web, worker, scheduler i migrace. Push do
`master` spustí GitHub Actions: kontroly → build a smoke test image → push do GHCR → deploy přes
SSH (`docker compose`). Nastavení VPS, secrets, nginx a první spuštění popisuje
[`deploy/README.md`](deploy/README.md), rozhodnutí je v ADR 0007.

## Testy

```sh
npm run test:unit -- --run   # vitest (parsery, časová zóna, delegace, plánování)
npm run check && npm run lint
docker build -t cbf-ref:test . && scripts/docker-smoke-test.sh cbf-ref:test   # produkční image
```
