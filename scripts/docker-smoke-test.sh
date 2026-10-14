#!/bin/sh
# Boots a built image against a throwaway Postgres and checks what a deploy relies on:
# migrations (twice, idempotent), /healthz, the login page behind a TLS proxy, the CSRF origin
# check and the bundled CLI. Usage: scripts/docker-smoke-test.sh <image>
set -eu

image="$1"
name="cbf-smoke-$$"
url="postgres://cbf:cbf@$name-db:5432/cbf"

cleanup() {
	status=$?
	if [ "$status" -ne 0 ]; then docker logs "$name-app" 2>&1 | tail -n 50 || true; fi
	docker rm --force "$name-db" "$name-app" >/dev/null 2>&1 || true
	docker network rm "$name" >/dev/null 2>&1 || true
	exit "$status"
}
trap cleanup EXIT

retry() {
	for _ in $(seq 1 30); do
		if "$@" >/dev/null 2>&1; then return 0; fi
		sleep 1
	done
	echo "timed out: $*" >&2
	return 1
}

docker network create "$name" >/dev/null
docker run --detach --name "$name-db" --network "$name" \
	-e POSTGRES_USER=cbf -e POSTGRES_PASSWORD=cbf -e POSTGRES_DB=cbf postgres:17 >/dev/null
retry docker exec "$name-db" pg_isready -h 127.0.0.1 -U cbf -d cbf

echo '== migrations'
docker run --rm --network "$name" -e DATABASE_URL="$url" "$image" node dist/migrate.js
docker run --rm --network "$name" -e DATABASE_URL="$url" "$image" node dist/migrate.js

echo '== CLI bundle'
docker run --rm "$image" node dist/cbf.js help | head -n 1

echo '== web app'
docker run --detach --name "$name-app" --network "$name" --publish 127.0.0.1::3000 \
	-e DATABASE_URL="$url" "$image" >/dev/null
port=$(docker port "$name-app" 3000/tcp | head -n 1 | sed 's/.*://')
base="http://127.0.0.1:$port"
retry curl --fail --silent "$base/healthz"
curl --fail --silent "$base/healthz" | grep -q '"ok":true'
curl --fail --silent -H 'X-Forwarded-Proto: https' "$base/login?q=smoke" | grep -q 'Přihlášení rozhodčího'

post_login() {
	curl --silent --output /dev/null --write-out '%{http_code}' -H 'X-Forwarded-Proto: https' \
		-H "Origin: $1" -H 'Content-Type: application/x-www-form-urlencoded' \
		--data 'officialId=1' "$base/login"
}
cross=$(post_login https://evil.example)
same=$(post_login "https://127.0.0.1:$port")
echo "login POST: cross-origin $cross, same-origin $same"
[ "$cross" = 403 ]
[ "$same" != 403 ] && [ "$same" -lt 500 ]

echo 'smoke test passed'
