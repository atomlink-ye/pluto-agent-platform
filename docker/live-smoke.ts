#!/usr/bin/env tsx
/**
 * Pluto MVP-alpha live smoke.
 *
 * Submits a fixed team task to the live PaseoOpenCodeAdapter and asserts:
 *   - Team Lead session was created.
 *   - At least 2 worker sessions completed.
 *   - The final artifact references each contributing role.
 *
 * Architecture note:
 *   The Paseo CLI is a macOS app bundle and cannot be installed inside a
 *   Linux Docker container. Therefore live mode runs on the HOST (where the
 *   Paseo daemon and provider CLIs live). The OpenCode runtime container in
 *   docker/compose.yml is optional and is only useful as the OpenCode web UI
 *   debug endpoint. The live adapter does not require it to be running.
 *
 * Preconditions (see .paseo-pluto-mvp/root/integration-plan.md):
 *   - paseo CLI reachable on $PATH (host).
 *   - $OPENCODE_BASE_URL set to declare you are explicitly running the live
 *     adapter — kept as a deterministic safety gate even though the paseo →
 *     opencode CLI path does not call the OpenCode HTTP server.
 *   - Free model available: $OPENCODE_MODEL (default opencode/minimax-m2.5-free).
 *
 * If preconditions are missing this script prints a structured BLOCKER report
 * and exits with code 2 (intentionally distinct from generic failure exit 1).
 */
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { FakeAdapter } from "../src/adapters/fake/index.js";
import { PaseoOpenCodeAdapter } from "../src/adapters/paseo-opencode/index.js";
import { DEFAULT_RUNNER } from "../src/adapters/paseo-opencode/process-runner.js";
import { DEFAULT_TEAM, RunStore, TeamRunService } from "../src/orchestrator/index.js";
import type { PaseoTeamAdapter } from "../src/contracts/adapter.js";

const WORKSPACE = resolve(
  process.env["PLUTO_LIVE_WORKSPACE"] ?? `${process.cwd()}/.tmp/live-quickstart`,
);
const DATA_DIR = resolve(process.env["PLUTO_DATA_DIR"] ?? `${WORKSPACE}/.pluto`);
const ARTIFACT_PATH = process.env["PLUTO_LIVE_ARTIFACT_PATH"] ?? `${WORKSPACE}/hello-pluto.md`;
const ADAPTER_KIND: "paseo-opencode" | "fake" = (() => {
  // Two equivalent ways to opt in to fake mode:
  //   PLUTO_LIVE_ADAPTER=fake   (the canonical knob)
  //   PLUTO_FAKE_LIVE=1         (a convenience flag used by external gates)
  if (
    process.env["PLUTO_FAKE_LIVE"] === "1" ||
    process.env["PLUTO_FAKE_LIVE"]?.toLowerCase() === "true"
  ) {
    return "fake";
  }
  const v = (process.env["PLUTO_LIVE_ADAPTER"] ?? "paseo-opencode") as
    | "paseo-opencode"
    | "fake";
  return v === "fake" ? "fake" : "paseo-opencode";
})();

interface BlockerReport {
  status: "blocker";
  reason: string;
  hint: string;
}

async function preflight(): Promise<BlockerReport | null> {
  if (ADAPTER_KIND === "fake") return null;
  const baseUrl = process.env["OPENCODE_BASE_URL"];
  if (!baseUrl) {
    return {
      status: "blocker",
      reason: "OPENCODE_BASE_URL unset",
      hint: "Point at the OpenCode runtime, e.g. http://pluto-runtime:4096.",
    };
  }
  const provider = process.env["PASEO_PROVIDER"] ?? "opencode/minimax-m2.5-free";
  if (!provider) {
    return {
      status: "blocker",
      reason: "PASEO_PROVIDER unset",
      hint: "Set PASEO_PROVIDER to a paseo provider alias that targets the OpenCode runtime.",
    };
  }
  const probe = await DEFAULT_RUNNER.exec("paseo", ["--version"]).catch((e) => ({
    stdout: "",
    stderr: String(e),
    exitCode: -1 as number | null,
  }));
  if (probe.exitCode !== 0) {
    return {
      status: "blocker",
      reason: "paseo CLI unavailable",
      hint: "Install paseo on PATH or rerun with PLUTO_LIVE_ADAPTER=fake.",
    };
  }
  return null;
}

async function main() {
  await mkdir(WORKSPACE, { recursive: true });

  const blocker = await preflight();
  if (blocker) {
    console.error(JSON.stringify(blocker, null, 2));
    process.exit(2);
  }

  const adapter: PaseoTeamAdapter =
    ADAPTER_KIND === "fake"
      ? new FakeAdapter({ team: DEFAULT_TEAM })
      : new PaseoOpenCodeAdapter({ workspaceCwd: WORKSPACE });

  const store = new RunStore({ dataDir: DATA_DIR });
  const service = new TeamRunService({
    adapter,
    team: DEFAULT_TEAM,
    store,
    timeoutMs: 8 * 60 * 1000,
    pumpIntervalMs: 250,
  });

  const startedAt = Date.now();
  const result = await service.run({
    id: `live-smoke-${startedAt}`,
    title: "Pluto MVP-alpha hello team",
    prompt:
      "Produce a markdown file that says hello from the team lead, planner, generator, and evaluator (one line each).",
    workspacePath: WORKSPACE,
    artifactPath: ARTIFACT_PATH,
    minWorkers: 2,
  });

  const summary = {
    runId: result.runId,
    status: result.status,
    elapsedMs: Date.now() - startedAt,
    contributions: result.artifact?.contributions.map((c) => ({
      roleId: c.roleId,
      chars: c.output.length,
    })),
    artifactPath: `${store.runDir(result.runId)}/artifact.md`,
    eventsPath: `${store.runDir(result.runId)}/events.jsonl`,
  };

  if (result.status !== "completed") {
    console.error(JSON.stringify({ status: "failed", failure: result.failure?.message, summary }, null, 2));
    process.exit(1);
  }

  // Assertions on the artifact content.
  const artifactMd = await readFile(`${store.runDir(result.runId)}/artifact.md`, "utf8");
  const requiredRoles = ["lead", "planner", "generator", "evaluator"];
  const missing = requiredRoles.filter((r) => !artifactMd.toLowerCase().includes(r));
  if (missing.length > 0) {
    console.error(
      JSON.stringify(
        { status: "assertion_failed", message: "artifact missing required roles", missing, summary },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(JSON.stringify({ status: "ok", summary }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
