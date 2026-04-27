#!/bin/sh
set -eu

config_target="${HOME:-/root}/.config/opencode/opencode.json"
mkdir -p "$(dirname "$config_target")"
if [ ! -f "$config_target" ]; then
  cp /tmp/opencode/default-opencode.json "$config_target"
fi

# If an operator-mounted auth directory is present, copy it on top of the
# default config so we keep the free-model defaults but layer their auth.
if [ -n "${PLUTO_AUTH_HOST_DIR:-}" ] && [ -d "${PLUTO_AUTH_HOST_DIR}" ]; then
  cp -R "${PLUTO_AUTH_HOST_DIR}/." "$(dirname "$config_target")/" 2>/dev/null || true
fi

exec opencode web --hostname 0.0.0.0 --port "${OPENCODE_PORT:-4096}"
