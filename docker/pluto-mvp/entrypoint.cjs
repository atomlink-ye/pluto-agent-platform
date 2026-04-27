#!/usr/bin/env node
/**
 * Inside-container bootstrap for `pluto-mvp` service.
 *   1. Install workspace deps (pnpm).
 *   2. Hand off to docker/live-smoke.ts via tsx.
 */
const { spawnSync } = require("node:child_process");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: "/workspace", ...opts });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

run("pnpm", ["install", "--frozen-lockfile=false", "--prefer-offline"]);
run("pnpm", ["exec", "tsx", "docker/live-smoke.ts"]);
