#!/bin/sh
set -eu

config_target="${HOME:-/root}/.config/opencode/opencode.json"
mkdir -p "$(dirname "$config_target")"
cp /tmp/opencode/default-opencode.json "$config_target"

exec opencode web --hostname 0.0.0.0 --port "${OPENCODE_PORT:-${PORT:-4096}}"
