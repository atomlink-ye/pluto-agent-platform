import { describe, expect, it } from "vitest";

import { assertHealthCompletionV0 } from "@/ops/upgrade-gates.js";

describe("health timeout fail secure", () => {
  it("marks the run failed when health observation times out", () => {
    const result = assertHealthCompletionV0({
      run: baseRun(),
      healthSignals: [],
      occurredAt: "2026-04-30T00:06:00.000Z",
      actorId: "operator-1",
      transitionKey: "health-timeout-1",
      observationTimedOut: true,
      evidenceRefs: ["evidence:timeout-window-1"],
    });

    expect(result.outcome).toBe("failed");
    expect(result.run.status).toBe("failed");
    expect(result.run.failureReason).toBe("Health observation timed out");
    expect(result.events.map((event) => event.eventType)).toEqual([
      "health_validation_recorded",
      "failure_recorded",
    ]);
  });
});

function baseRun() {
  return {
    schema: "pluto.ops.upgrade-run" as const,
    schemaVersion: 0 as const,
    id: "upgrade-run-1",
    workspaceId: "workspace-1",
    planId: "upgrade-plan-1",
    sourceRuntimeVersion: "opencode@1.0.0",
    targetRuntimeVersion: "opencode@1.1.0",
    status: "healthCheck",
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: ["backup:manifest-1"],
    healthRefs: [],
    rollbackRefs: ["rollback:playbook-1"],
    evidenceRefs: ["evidence:ticket-1"],
    lastTransitionAt: "2026-04-30T00:05:00.000Z",
    lastTransitionKey: "health-check-1",
    startedAt: "2026-04-30T00:01:00.000Z",
    finishedAt: null,
    failureReason: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:05:00.000Z",
  };
}
