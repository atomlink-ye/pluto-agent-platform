import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RunsEventV0 } from "@/contracts/types.js";

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-cli-follow-test-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("pnpm runs events --follow", () => {
  it("waits for terminal completion events instead of stopping on blockers", async () => {
    const runId = "follow-stream-run";
    const runDir = join(dataDir, "runs", runId);
    const eventsPath = join(runDir, "events.jsonl");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      eventsPath,
      [
        { id: "seed-1", runId, ts: "2026-04-29T12:00:00.000Z", type: "run_started", payload: { title: "Follow stream" } },
        { id: "seed-2", runId, ts: "2026-04-29T12:00:01.000Z", type: "worker_started", roleId: "generator", payload: { attempt: 1 } },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );

    const child = spawn(
      "npx",
      ["tsx", join(process.cwd(), "src/cli/runs.ts"), "events", runId, "--follow", "--since", "seed-1", "--role", "generator", "--kind", "worker_completed", "--json"],
      {
        cwd: process.cwd(),
        env: { ...process.env, PLUTO_DATA_DIR: dataDir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    await sleep(350);
    await appendFile(
      eventsPath,
      [
        { id: "ignore-1", runId, ts: "2026-04-29T12:00:02.000Z", type: "worker_completed", roleId: "planner", payload: { attempt: 1, output: "planner" } },
        { id: "emit-1", runId, ts: "2026-04-29T12:00:03.000Z", type: "worker_completed", roleId: "generator", payload: { attempt: 2, output: "generator" } },
        { id: "block-1", runId, ts: "2026-04-29T12:00:04.000Z", type: "blocker", payload: { reason: "validation_failed", message: "stop" } },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );

    await sleep(900);
    expect(child.exitCode).toBeNull();

    await appendFile(
      eventsPath,
      JSON.stringify(
        { id: "fail-1", runId, ts: "2026-04-29T12:00:05.000Z", type: "run_failed", payload: { message: "Blocker: validation_failed" } },
      ) + "\n",
      "utf8",
    );

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("follow process did not exit"));
      }, 12_000);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code ?? 0);
      });
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);

    const event: RunsEventV0 = JSON.parse(lines[0]!);
    expect(event.eventId).toBe("emit-1");
    expect(event.role).toBe("generator");
    expect(event.kind).toBe("worker_completed");
    expect(event.attempt).toBe(2);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
