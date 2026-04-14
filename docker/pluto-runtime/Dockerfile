FROM node:22-bookworm-slim

ENV NODE_ENV=production
ARG OPENCODE_VERSION=1.4.3

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g "opencode-ai@${OPENCODE_VERSION}"

WORKDIR /workspace

COPY docker/pluto-runtime/opencode.config.json /tmp/opencode/default-opencode.json
COPY docker/pluto-runtime/entrypoint.sh /usr/local/bin/pluto-runtime-entrypoint.sh

RUN chmod +x /usr/local/bin/pluto-runtime-entrypoint.sh

ENV PORT=4096
ENV OPENCODE_PORT=4096

ENTRYPOINT ["/usr/local/bin/pluto-runtime-entrypoint.sh"]
