import { describe, expect, it } from "vitest";

import type { AgentEvent, EvidencePacketV0, RunsListItemV0, TeamRunResult } from "@/index.js";
import {
  normalizeGovernanceRunStatusV0,
  normalizePublishAttemptStatusV0,
  normalizeReviewStatusV0,
  parseDecisionEventV0,
  toGovernedPublishPackageRefV0,
} from "@/index.js";

describe("compliance public type compatibility", () => {
  it("keeps existing runtime and evidence public types readable without renaming", () => {
    const event: AgentEvent = {
      id: "evt-1",
      runId: "run-1",
      ts: "2026-04-30T00:00:00.000Z",
      type: "run_completed",
      payload: {},
    };
    const runResult: TeamRunResult = {
      runId: "run-1",
      status: "completed",
      events: [event],
      blockerReason: null,
    };
    const listItem: RunsListItemV0 = {
      schemaVersion: 0,
      runId: "run-1",
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
      runId: "run-1",
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

    expect(runResult.status).toBe("completed");
    expect(event.type).toBe("run_completed");
    expect(listItem.status).toBe("done");
    expect(evidence.status).toBe("done");
  });

  it("keeps existing status and event vocabulary intact while exporting the new compliance surface", () => {
    expect(normalizeGovernanceRunStatusV0("done")).toBe("succeeded");
    expect(normalizeReviewStatusV0("done")).toBe("succeeded");
    expect(normalizePublishAttemptStatusV0("succeeded")).toBe("succeeded");
    expect(parseDecisionEventV0("approved")).toBe("approved");

    expect(toGovernedPublishPackageRefV0({
      id: "pkg-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
    })).toMatchObject({
      kind: "publish_package",
      stableId: "pkg-1",
      packageId: "pkg-1",
    });
  });
});
