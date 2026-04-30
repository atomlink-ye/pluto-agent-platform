import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { PaseoTeamAdapter } from "@/contracts/adapter.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import type { TeamTask } from "@/contracts/types.js";

let workDir: string;

beforeEach(async () => {
  vi.resetModules();
  workDir = await mkdtemp(join(tmpdir(), "pluto-evidence-failure-test-"));
});

afterEach(async () => {
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("@/orchestrator/evidence.js");
  vi.resetModules();
  await rm(workDir, { recursive: true, force: true });
});

function buildTask(): TeamTask {
  return {
    id: "evidence-failure-task",
    title: "Evidence failure task",
    prompt: "Produce a safe artifact",
    workspacePath: workDir,
    minWorkers: 2,
  };
}

describe("evidence failure handling", () => {
  it("cleans up partial evidence files when persistence fails mid-write", async () => {
    const fsActual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let writeCount = 0;
    vi.doMock("node:fs/promises", () => ({
      ...fsActual,
      writeFile: vi.fn(async (...args: Parameters<typeof fsActual.writeFile>) => {
        writeCount += 1;
        if (writeCount === 1) {
          return fsActual.writeFile(...args);
        }
        throw new Error("disk full EVIDENCE_SECRET=disk-secret-value");
      }),
    }));

    const { generateEvidencePacket, writeEvidence } = await import("@/orchestrator/evidence.js");
    const packet = generateEvidencePacket({
      task: buildTask(),
      result: {
        runId: "run-evidence-cleanup",
        status: "completed",
        blockerReason: null,
        artifact: {
          runId: "run-evidence-cleanup",
          markdown: "# Artifact",
          leadSummary: "Artifact",
          contributions: [],
        },
        events: [],
      },
      events: [],
      startedAt: new Date("2026-04-30T00:00:00.000Z"),
      finishedAt: new Date("2026-04-30T00:00:01.000Z"),
      blockerReason: null,
    });

    await expect(writeEvidence(workDir, packet)).rejects.toThrow(/disk full/);
    await expect(access(join(workDir, "evidence.md"), constants.F_OK)).rejects.toThrow();
    await expect(access(join(workDir, "evidence.json"), constants.F_OK)).rejects.toThrow();
  });

  it("records a visible runtime_error blocker and fails the run when evidence generation fails", async () => {
    const actualEvidence = await vi.importActual<typeof import("@/orchestrator/evidence.js")>("@/orchestrator/evidence.js");
    vi.doMock("@/orchestrator/evidence.js", () => ({
      ...actualEvidence,
      generateEvidencePacket: vi.fn(() => {
        throw new Error("evidence exploded SECRET_TOKEN=super-secret-value");
      }),
    }));

    const { TeamRunService } = await import("@/orchestrator/team-run-service.js");
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter: new FakeAdapter({ team: DEFAULT_TEAM }),
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask());
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const events = eventsRaw.trim().split("\n").map((line) => JSON.parse(line));
    const blocker = events.find((event: { type: string }) => event.type === "blocker");

    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("runtime_error");
    expect(result.failure?.message).toContain("[REDACTED]");
    expect(result.failure?.message).not.toContain("SECRET_TOKEN");
    expect(events.some((event: { type: string }) => event.type === "run_completed")).toBe(false);
    expect(events.at(-1)?.type).toBe("run_failed");
    expect(blocker?.payload.reason).toBe("runtime_error");
    expect(blocker?.payload.classifierVersion).toBe(0);
    expect(eventsRaw).not.toContain("super-secret-value");
    expect(eventsRaw).toContain("[REDACTED]");
    expect(eventsRaw).not.toContain("SECRET_TOKEN");
    await expect(
      access(join(workDir, ".pluto", "runs", result.runId, "evidence.json"), constants.F_OK),
    ).rejects.toThrow();
  });

  it("surfaces evidence failure even when the run had already failed in the outer catch path", async () => {
    const actualEvidence = await vi.importActual<typeof import("@/orchestrator/evidence.js")>("@/orchestrator/evidence.js");
    vi.doMock("@/orchestrator/evidence.js", () => ({
      ...actualEvidence,
      generateEvidencePacket: vi.fn(() => {
        throw new Error("secondary evidence failure SECRET_TOKEN=catch-secret-value");
      }),
    }));

    const { TeamRunService } = await import("@/orchestrator/team-run-service.js");
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const adapter: PaseoTeamAdapter = {
      async startRun() {},
      async createLeadSession() {
        throw new Error("429 Too Many Requests");
      },
      async createWorkerSession() {
        throw new Error("unexpected worker creation");
      },
      async sendMessage() {},
      async readEvents() {
        return [];
      },
      async waitForCompletion() {
        return [];
      },
      async endRun() {},
    };
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask());
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const events = eventsRaw.trim().split("\n").map((line) => JSON.parse(line));
    const blockerEvents = events.filter((event: { type: string }) => event.type === "blocker");
    const meta = await store.readRunMeta(result.runId);

    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("runtime_error");
    expect(result.failure?.message).toContain("[REDACTED]");
    expect(result.failure?.message).not.toContain("SECRET_TOKEN");
    expect(blockerEvents).toHaveLength(2);
    expect(blockerEvents[0]?.payload.reason).toBe("quota_exceeded");
    expect(blockerEvents[1]?.payload.reason).toBe("runtime_error");
    expect(events.at(-1)?.type).toBe("run_failed");
    expect(events.at(-1)?.payload.message).toContain("[REDACTED]");
    expect(events.at(-1)?.payload.message).not.toContain("SECRET_TOKEN");
    expect(eventsRaw).not.toContain("catch-secret-value");
    expect(meta?.blockerReason).toBe("runtime_error");
  });
});
