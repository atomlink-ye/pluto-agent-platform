#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
shared_root=/tmp/project-shared/pluto-agent-platform
local_link="$repo_root/.local"

mkdir -p "$shared_root"

if [ -L "$local_link" ]; then
  current_target=$(readlink "$local_link")
  if [ "$current_target" = "$shared_root" ]; then
    printf 'Already linked: %s -> %s\n' "$local_link" "$shared_root"
    exit 0
  fi

  printf 'Refusing to replace existing symlink: %s -> %s\n' "$local_link" "$current_target" >&2
  exit 1
fi

if [ -e "$local_link" ]; then
  printf 'Refusing to replace existing path: %s\n' "$local_link" >&2
  exit 1
fi

ln -s "$shared_root" "$local_link"
printf 'Linked %s -> %s\n' "$local_link" "$shared_root"
