import { describe, expect, it } from "vitest";

import type { RunsListItemV0, AgentEvent, EvidencePacketV0, TeamRunResult } from "@/contracts/types.js";
import { toRunRefV0 } from "@/contracts/governance.js";
import {
  normalizeGovernedStorageEventStatusV0,
  projectGovernedRuntimeOutcomeV0,
} from "@/identity/security-storage-boundary.js";

describe("public type compatibility", () => {
  it("keeps existing runtime public names and values accepted", () => {
    const event: AgentEvent = {
      id: "evt_01",
      runId: "run_01",
      ts: "2026-04-30T00:00:00.000Z",
      type: "run_completed",
      payload: {},
    };
    const runResult: TeamRunResult = {
      runId: "run_01",
      status: "completed",
      events: [event],
      blockerReason: null,
    };
    const listItem: RunsListItemV0 = {
      schemaVersion: 0,
      runId: "run_01",
      taskTitle: "Publish package",
      status: "done",
      blockerReason: null,
      startedAt: "2026-04-30T00:00:00.000Z",
      finishedAt: "2026-04-30T00:01:00.000Z",
      parseWarnings: 0,
      workerCount: 2,
      artifactPresent: true,
      evidencePresent: true,
    };
    const evidence: EvidencePacketV0 = {
      schemaVersion: 0,
      runId: "run_01",
      taskTitle: "Publish package",
      status: "done",
      blockerReason: null,
      startedAt: "2026-04-30T00:00:00.000Z",
      finishedAt: "2026-04-30T00:01:00.000Z",
      workspace: "ws_local_alpha",
      workers: [],
      validation: { outcome: "pass", reason: null },
      citedInputs: { taskPrompt: "publish", workspaceMarkers: ["ws_local_alpha"] },
      risks: [],
      openQuestions: [],
      classifierVersion: 0,
      generatedAt: "2026-04-30T00:01:00.000Z",
    };

    expect(projectGovernedRuntimeOutcomeV0(runResult)).toEqual({
      eventType: "run_completed",
      runsStatus: "done",
      evidenceStatus: "done",
    });
    expect(toRunRefV0({
      runId: runResult.runId,
      status: listItem.status,
      blockerReason: null,
      finishedAt: listItem.finishedAt,
    })).toEqual({
      runId: "run_01",
      status: "succeeded",
      blockerReason: null,
      finishedAt: "2026-04-30T00:01:00.000Z",
    });
    expect(normalizeGovernedStorageEventStatusV0("done")).toBe("succeeded");
    expect(event.type).toBe("run_completed");
    expect(listItem.status).toBe("done");
    expect(evidence.status).toBe("done");
  });

  it("preserves blocked and failed projections without renaming public outputs", () => {
    const blockedResult: TeamRunResult = {
      runId: "run_blocked_01",
      status: "failed",
      events: [],
      blockerReason: "runtime_permission_denied",
    };
    const failedResult: TeamRunResult = {
      runId: "run_failed_01",
      status: "failed",
      events: [],
      blockerReason: null,
      failure: { message: "adapter failed" },
    };

    expect(projectGovernedRuntimeOutcomeV0(blockedResult)).toEqual({
      eventType: "run_failed",
      runsStatus: "blocked",
      evidenceStatus: "blocked",
    });
    expect(projectGovernedRuntimeOutcomeV0(failedResult)).toEqual({
      eventType: "run_failed",
      runsStatus: "failed",
      evidenceStatus: "failed",
    });
  });
});
