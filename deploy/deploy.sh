#!/bin/sh
# Runs on the VPS, called by CI over SSH:  deploy.sh <image tag> <registry user>  (registry token on stdin).
# Manual rollback to an older build:        IMAGE_TAG=<sha> docker compose up -d
set -eu
cd "$(dirname "$0")"

tag="$1"
registry_user="$2"

if [ ! -f .env ]; then
	echo "Missing $(pwd)/.env (template: deploy/.env.example)" >&2
	exit 1
fi

docker login ghcr.io --username "$registry_user" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

export IMAGE_TAG="$tag"
docker compose pull --quiet
# runs migrate first, then recreates app, worker and scheduler on the new image
docker compose up --detach --remove-orphans

echo "Waiting for the app to become healthy…"
for _ in $(seq 1 60); do
	status=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps --quiet app)" 2>/dev/null || true)
	if [ "$status" = healthy ]; then
		# keep two weeks of builds for rollbacks, drop older unused ones
		docker image prune --all --force --filter "until=336h" \
			--filter "label=org.opencontainers.image.source=https://github.com/sberan1/cbf-ref-interface" >/dev/null
		docker compose ps
		echo "Deployed $tag"
		exit 0
	fi
	sleep 2
done

docker compose ps
docker compose logs --tail 80 migrate app
echo "App did not become healthy" >&2
exit 1
