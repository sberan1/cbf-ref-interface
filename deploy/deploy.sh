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
# the proxy network is external; create it on a host where the proxy isn't set up yet
proxy_network=$(sed -n 's/^PROXY_NETWORK=//p' .env | tail -n 1)
proxy_network=${proxy_network:-nginx_default}
docker network inspect "$proxy_network" >/dev/null 2>&1 || docker network create "$proxy_network"
# the app first: the logging stack (ADR 0009) is optional and must never block a deploy
core="db rabbitmq migrate app worker scheduler"
# shellcheck disable=SC2086
docker compose pull --quiet $core
# runs migrate first, then recreates app, worker and scheduler on the new image
# shellcheck disable=SC2086
docker compose up --detach --remove-orphans $core

if grep -q '^GRAYLOG_PASSWORD_SECRET=..*' .env && grep -q '^GRAYLOG_ROOT_PASSWORD=..*' .env; then
	{ docker compose pull --quiet mongodb opensearch graylog &&
		docker compose up --detach mongodb opensearch graylog graylog-setup; } ||
		echo "Warning: the logging stack did not start, see docker compose logs graylog" >&2
else
	echo "Logging stack skipped: set GRAYLOG_PASSWORD_SECRET and GRAYLOG_ROOT_PASSWORD in .env" >&2
fi

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
