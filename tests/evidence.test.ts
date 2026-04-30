import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  generateEvidencePacket,
  validateEvidencePacketV0,
  renderEvidenceMarkdown,
  writeEvidence,
} from "@/orchestrator/evidence.js";
import type {
  AgentEvent,
  TeamRunResult,
  TeamTask,
} from "@/contracts/types.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-evidence-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeTask(): TeamTask {
  return {
    id: "test-task-1",
    title: "Test Task",
    prompt: "Generate a test artifact",
    workspacePath: workDir,
    minWorkers: 2,
  };
}

function makeEvents(runId: string): AgentEvent[] {
  return [
    { id: "e1", runId, ts: "2026-04-29T00:00:00.000Z", type: "run_started", payload: { taskId: "t1", prompt: "test" } },
    { id: "e2", runId, ts: "2026-04-29T00:00:01.000Z", type: "lead_started", roleId: "lead", sessionId: "s1", payload: {} },
    { id: "e3", runId, ts: "2026-04-29T00:00:02.000Z", type: "worker_started", roleId: "planner", sessionId: "s2", payload: {} },
    { id: "e4", runId, ts: "2026-04-29T00:00:03.000Z", type: "worker_completed", roleId: "planner", sessionId: "s2", payload: { output: "Plan step 1\nPlan step 2" } },
    { id: "e5", runId, ts: "2026-04-29T00:00:04.000Z", type: "worker_started", roleId: "generator", sessionId: "s3", payload: {} },
    { id: "e6", runId, ts: "2026-04-29T00:00:05.000Z", type: "worker_completed", roleId: "generator", sessionId: "s3", payload: { output: "Generated body" } },
    { id: "e7", runId, ts: "2026-04-29T00:00:06.000Z", type: "worker_started", roleId: "evaluator", sessionId: "s4", payload: {} },
    { id: "e8", runId, ts: "2026-04-29T00:00:07.000Z", type: "worker_completed", roleId: "evaluator", sessionId: "s4", payload: { output: "PASS: deliverable matches the team goal." } },
    { id: "e9", runId, ts: "2026-04-29T00:00:08.000Z", type: "run_completed", payload: { workerCount: 3 } },
  ];
}

function makeCompletedResult(runId: string): TeamRunResult {
  return {
    runId,
    status: "completed",
    events: makeEvents(runId),
    artifact: {
      runId,
      markdown: "# Test artifact\nContent",
      leadSummary: "Test artifact",
      contributions: [
        { roleId: "planner", sessionId: "s2", output: "Plan step 1\nPlan step 2" },
        { roleId: "generator", sessionId: "s3", output: "Generated body" },
        { roleId: "evaluator", sessionId: "s4", output: "PASS: deliverable matches the team goal." },
      ],
    },
    blockerReason: null,
  };
}

function makeBlockedResult(runId: string): TeamRunResult {
  return {
    runId,
    status: "failed",
    events: [
      { id: "e1", runId, ts: "2026-04-29T00:00:00.000Z", type: "run_started", payload: { taskId: "t1" } },
      { id: "e2", runId, ts: "2026-04-29T00:00:01.000Z", type: "run_failed", payload: { message: "team_run_timeout" } },
    ],
    failure: { message: "team_run_timeout" },
    blockerReason: "runtime_timeout",
  };
}

describe("evidence packet generation", () => {
  it("generates a valid packet for a completed run", () => {
    const task = makeTask();
    const result = makeCompletedResult("run-done-1");
    const packet = generateEvidencePacket({
      task,
      result,
      events: result.events,
      startedAt: new Date("2026-04-29T00:00:00.000Z"),
      finishedAt: new Date("2026-04-29T00:00:08.000Z"),
      blockerReason: null,
    });

    expect(validateEvidencePacketV0(packet).ok).toBe(true);
    expect(packet.schemaVersion).toBe(0);
    expect(packet.status).toBe("done");
    expect(packet.blockerReason).toBeNull();
    expect(packet.workspace).toBe("[REDACTED:workspace-path]");
    expect(packet.workers.length).toBe(3);
    expect(packet.validation.outcome).toBe("pass");
    expect(packet.classifierVersion).toBe(0);
  });

  it("generates a valid packet for a blocked run", () => {
    const task = makeTask();
    const result = makeBlockedResult("run-blocked-1");
    const packet = generateEvidencePacket({
      task,
      result,
      events: result.events,
      startedAt: new Date("2026-04-29T00:00:00.000Z"),
      finishedAt: new Date("2026-04-29T00:00:01.000Z"),
      blockerReason: "runtime_timeout",
    });

    expect(validateEvidencePacketV0(packet).ok).toBe(true);
    expect(packet.status).toBe("blocked");
    expect(packet.blockerReason).toBe("runtime_timeout");
  });

  it("generates a valid packet for a failed run with unknown reason", () => {
    const task = makeTask();
    const result: TeamRunResult = {
      runId: "run-fail-1",
      status: "failed",
      events: [
        { id: "e1", runId: "run-fail-1", ts: "2026-04-29T00:00:00.000Z", type: "run_started", payload: {} },
        { id: "e2", runId: "run-fail-1", ts: "2026-04-29T00:00:01.000Z", type: "run_failed", payload: { message: "unexpected" } },
      ],
      failure: { message: "unexpected" },
      blockerReason: "unknown",
    };
    const packet = generateEvidencePacket({
      task,
      result,
      events: result.events,
      startedAt: new Date("2026-04-29T00:00:00.000Z"),
      finishedAt: new Date("2026-04-29T00:00:01.000Z"),
      blockerReason: "unknown",
    });

    expect(validateEvidencePacketV0(packet).ok).toBe(true);
    expect(packet.status).toBe("blocked");
    expect(packet.blockerReason).toBe("unknown");
  });

});

describe("validateEvidencePacketV0", () => {
  it("rejects invalid packets", () => {
      expect(validateEvidencePacketV0(null).ok).toBe(false);
      expect(validateEvidencePacketV0({}).ok).toBe(false);
      expect(validateEvidencePacketV0({ schemaVersion: 1 }).ok).toBe(false);
      expect(validateEvidencePacketV0({ schemaVersion: 0, runId: 123 }).ok).toBe(false);
  });

  it("accepts a well-formed packet with extra fields", () => {
    const task = makeTask();
    const result = makeCompletedResult("run-extra-1");
    const packet = generateEvidencePacket({
      task,
      result,
      events: result.events,
      startedAt: new Date("2026-04-29T00:00:00.000Z"),
      finishedAt: new Date("2026-04-29T00:00:08.000Z"),
      blockerReason: null,
    });

    const withExtra = { ...packet, futureField: "hello" };
    expect(validateEvidencePacketV0(withExtra).ok).toBe(true);
  });
});

describe("renderEvidenceMarkdown", () => {
  it("produces markdown with required sections", () => {
    const task = makeTask();
    const result = makeCompletedResult("run-md-1");
    const packet = generateEvidencePacket({
      task,
      result,
      events: result.events,
      startedAt: new Date("2026-04-29T00:00:00.000Z"),
      finishedAt: new Date("2026-04-29T00:00:08.000Z"),
      blockerReason: null,
    });

    const md = renderEvidenceMarkdown(packet);
    expect(md).toContain("# Evidence Packet");
    expect(md).toContain("**Status:** done");
    expect(md).toContain("## Workers");
    expect(md).toContain("## Validation");
    expect(md).toContain("Schema version: 0");
  });
});

describe("writeEvidence", () => {
  it("writes evidence.md and evidence.json to disk", async () => {
    const task = makeTask();
    const result = makeCompletedResult("run-write-1");
    const packet = generateEvidencePacket({
      task,
      result,
      events: result.events,
      startedAt: new Date("2026-04-29T00:00:00.000Z"),
      finishedAt: new Date("2026-04-29T00:00:08.000Z"),
      blockerReason: null,
    });

    const { mdPath, jsonPath } = await writeEvidence(workDir, packet);

    const mdContent = await readFile(mdPath, "utf8");
    expect(mdContent).toContain("# Evidence Packet");

    const jsonContent = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(jsonContent);
    expect(validateEvidencePacketV0(parsed).ok).toBe(true);
  });
});
