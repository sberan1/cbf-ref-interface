# syntax=docker/dockerfile:1
# One image for every role (ADR 0007): web app, sync worker, scheduler, migrations, CLI.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:worker && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
# behind the reverse proxy: the public origin is https://<Host>, the scheme comes from X-Forwarded-Proto
ENV NODE_ENV=production \
	PORT=3000 \
	PROTOCOL_HEADER=x-forwarded-proto
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
USER node
EXPOSE 3000
# per-role commands and healthchecks are set in deploy/compose.yaml
CMD ["node", "build"]
