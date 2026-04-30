import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import type { TeamTask } from "@/contracts/types.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-team-redaction-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("TeamRunService event redaction", () => {
  it("redacts orchestrator and adapter payloads before persisting events", async () => {
    const promptSecret = "PROMPT_SECRET=prompt-secret-value";
    const outputSecret = "WORKER_SECRET=worker-secret-value";
    const summarySecret = "SUMMARY_SECRET=summary-secret-value";
    const task: TeamTask = {
      id: "redaction-task",
      title: "Redaction task",
      prompt: `Do not leak ${promptSecret}`,
      workspacePath: workDir,
      minWorkers: 2,
    };
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      workerOutputs: {
        planner: `planner output ${outputSecret}`,
        generator: `generator output ${outputSecret}`,
        evaluator: "PASS: safe evaluator output",
      },
      summaryBuilder: () => `# Summary\ncontains ${summarySecret}`,
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(task);
    const raw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );

    expect(raw).not.toContain("prompt-secret-value");
    expect(raw).not.toContain("worker-secret-value");
    expect(raw).not.toContain("summary-secret-value");
    expect(raw).not.toContain(workDir);
    expect(raw).toContain("[REDACTED]");
    expect(raw).toContain("[REDACTED:path]");
  });

  it("uses transient raw adapter payloads for live orchestration while persisting redacted events", async () => {
    const task: TeamTask = {
      id: "transient-raw-task",
      title: "Transient raw task",
      prompt: "Keep raw data in memory only",
      workspacePath: workDir,
      minWorkers: 2,
    };
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      workerOutputs: {
        planner: "planner token sk-ant-api03-abcdefghijklmnop",
        generator: "generator token sk-ant-api03-qrstuvwxyzabcdef",
        evaluator: "PASS: evaluator token sk-ant-api03-ghijklmnopqrstuv",
      },
      summaryBuilder: (contributions) =>
        `# Raw summary\n${contributions.map((entry) => entry.output).join(" | ")}`,
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(task);
    const raw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const persistedArtifact = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "artifact.md"),
      "utf8",
    );

    expect(result.status).toBe("completed");
    expect(result.artifact?.contributions.map((entry) => entry.output)).toEqual([
      "planner token sk-ant-api03-abcdefghijklmnop",
      "generator token sk-ant-api03-qrstuvwxyzabcdef",
      "PASS: evaluator token sk-ant-api03-ghijklmnopqrstuv",
    ]);
    expect(result.artifact?.markdown).toContain("planner token sk-ant-api03-abcdefghijklmnop");
    expect(raw).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(raw).toContain("[REDACTED]");
    expect(persistedArtifact).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(persistedArtifact).toContain("[REDACTED]");
  });
});
