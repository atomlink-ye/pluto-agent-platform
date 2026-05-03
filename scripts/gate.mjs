#!/usr/bin/env node

import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");

if (separatorIndex < 1 || separatorIndex === args.length - 1) {
  console.error("usage: node scripts/gate.mjs <gate-name> -- <command>");
  process.exit(2);
}

const gateName = args[0];
const command = args.slice(separatorIndex + 1).join(" ").trim();

if (!gateName || !command) {
  console.error("usage: node scripts/gate.mjs <gate-name> -- <command>");
  process.exit(2);
}

const timeoutMs = Number(process.env["PLUTO_GATE_TIMEOUT_MS"] ?? DEFAULT_TIMEOUT_MS);
const startedAt = new Date();
const startedHr = process.hrtime.bigint();

process.stdout.write(`# started: ${startedAt.toISOString()}\n`);
process.stdout.write(`# command: ${command}\n`);

const child = spawn(command, {
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

let timedOut = false;
let finished = false;

const timeout = setTimeout(() => {
  timedOut = true;
  process.stderr.write(`# timeout: ${gateName} exceeded ${timeoutMs}ms\n`);
  child.kill("SIGTERM");
  const forceKill = setTimeout(() => {
    child.kill("SIGKILL");
  }, 5_000);
  forceKill.unref?.();
}, timeoutMs);
timeout.unref?.();

const finish = (exitCode) => {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  const durationMs = Number(process.hrtime.bigint() - startedHr) / 1_000_000;
  process.stdout.write(`# duration: ${(durationMs / 1000).toFixed(2)}s\n`);
  process.stdout.write(`# exit: ${exitCode}\n`);
  process.exit(exitCode);
};

child.on("error", (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  finish(1);
});

child.on("close", (code, signal) => {
  const exitCode = timedOut ? 124 : (code ?? (signal ? 1 : 0));
  finish(exitCode);
});
