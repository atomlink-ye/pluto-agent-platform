FROM node:22-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl wget git \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@9.12.3 --activate

WORKDIR /workspace

# We mount the repo at /workspace; the entrypoint just runs the live smoke.
# Build deps are installed lazily on first run so the image stays small.
COPY docker/pluto-mvp/entrypoint.cjs /usr/local/bin/pluto-mvp-entrypoint.cjs

CMD ["node", "/usr/local/bin/pluto-mvp-entrypoint.cjs"]
