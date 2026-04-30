#!/usr/bin/env node
/**
 * scripts/verify.mjs — Pluto MVP-alpha fast local verification.
 *
 * Runs the following gates in order:
 *   1. pnpm typecheck  (TypeScript strict)
 *   2. pnpm test       (vitest run)
 *   3. pnpm spec:hygiene (optional mirror validation)
 *   4. pnpm build      (dist/ output)
 *   5. pnpm smoke:fake (fake adapter E2E)
 *   6. No-endpoint blocker check (exit 2 if OPENCODE_BASE_URL unset)
 *
 * This script is cross-platform (macOS/Node.js) and requires no secrets.
 * Excludes: pnpm smoke:docker (broader validation — see docs/testing-and-evals.md).
 */
import { execSync, spawnSync } from "node:child_process";
import { env } from "node:process";

const VERIFY_SCRIPTS = [
  { name: "typecheck", cmd: "pnpm typecheck", expect: 0 },
  { name: "test", cmd: "pnpm test", expect: 0 },
  { name: "spec:hygiene", cmd: "pnpm spec:hygiene", expect: 0 },
  { name: "build", cmd: "pnpm build", expect: 0 },
  { name: "smoke:fake", cmd: "pnpm smoke:fake", expect: 0 },
];

function run(cmd, expectExit) {
  console.log(`\n[verify] Running: ${cmd}`);
  const start = Date.now();
  try {
    execSync(cmd, { stdio: "inherit", encoding: "utf8" });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[verify] ✓ ${cmd} passed (${elapsed}s)`);
    return { ok: true, exit: 0, elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`[verify] ✗ ${cmd} failed (${elapsed}s)`);
    return { ok: false, exit: err.status ?? 1, elapsed, stderr: err.stderr };
  }
}

function checkNoEndpointBlocker() {
  console.log("\n[verify] Running no-endpoint blocker check...");
  const start = Date.now();
  // Simulate the live smoke with OPENCODE_BASE_URL unset.
  // Do not inherit a developer's local Docker/OpenCode endpoint here; this
  // gate must prove the deterministic missing-endpoint blocker path.
  const blockerEnv = { ...env, PLUTO_LIVE_ADAPTER: "paseo-opencode" };
  delete blockerEnv.OPENCODE_BASE_URL;

  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", "docker/live-smoke.ts"],
    {
      stdio: "pipe",
      encoding: "utf8",
      env: blockerEnv,
    }
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const exitCode = result.status ?? 1;

  console.log(`[verify] Blocker check exit code: ${exitCode}`);
  if (output) {
    console.log(`[verify] Blocker output:\n${output.substring(0, 500)}`);
  }

  if (exitCode === 2 && output.includes("OPENCODE_BASE_URL")) {
    console.log(`[verify] ✓ No-endpoint blocker correctly exits 2 with OPENCODE_BASE_URL message (${elapsed}s)`);
    return { ok: true, exit: 2, elapsed };
  } else {
    console.error(`[verify] ✗ Blocker check failed: expected exit 2 + OPENCODE_BASE_URL in output`);
    if (exitCode !== 2) console.error(`[verify]   Expected exit 2, got ${exitCode}`);
    if (!output.includes("OPENCODE_BASE_URL")) console.error(`[verify]   Output did not contain "OPENCODE_BASE_URL"`);
    return { ok: false, exit: exitCode, elapsed };
  }
}

function main() {
  console.log("=".repeat(60));
  console.log("Pluto MVP-alpha verify — fast local gates");
  console.log("=".repeat(60));

  let allPassed = true;
  const results = [];

  for (const step of VERIFY_SCRIPTS) {
    const r = run(step.cmd, step.expect);
    results.push(r);
    if (!r.ok) {
      console.error(`\n[verify] FAILED at step: ${step.name}`);
      allPassed = false;
      break;
    }
  }

  if (allPassed) {
    const blockerCheck = checkNoEndpointBlocker();
    results.push(blockerCheck);
    if (!blockerCheck.ok) {
      allPassed = false;
    }
  }

  console.log("\n" + "=".repeat(60));
  if (allPassed) {
    console.log("✓ All verify gates passed");
    console.log("=".repeat(60));
    process.exit(0);
  } else {
    const failed = results.filter((r) => !r.ok).map((r) => r.name ?? "?");
    console.error("✗ Verify failed");
    console.error("=".repeat(60));
    process.exit(1);
  }
}

main();
