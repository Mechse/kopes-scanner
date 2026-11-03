# syntax=docker/dockerfile:1
FROM aquasec/trivy:0.76.1 AS trivy
FROM node:24.17.0-bookworm-slim AS build
WORKDIR /repo
RUN npm install --global pnpm@10.8.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . ./
RUN pnpm build

FROM node:24.17.0-bookworm-slim AS runtime
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data && chown 65532:65532 /data
WORKDIR /app
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=build /repo/.output/ ./.output/
COPY LICENSE THIRD_PARTY_NOTICES.md licenses/ ./licenses/
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 DATA_DIR=/data HOST_ROOT=/host TMPDIR=/data/tmp
USER 65532:65532
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
