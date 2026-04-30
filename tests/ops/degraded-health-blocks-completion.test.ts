import { describe, expect, it } from "vitest";

import { assertHealthCompletionV0 } from "@/ops/upgrade-gates.js";

describe("degraded health blocks completion", () => {
  it("fails the run instead of completing when any health signal is degraded", () => {
    const result = assertHealthCompletionV0({
      run: baseRun(),
      healthSignals: [{
        schema: "pluto.ops.health-signal",
        schemaVersion: 0,
        id: "health-1",
        workspaceId: "workspace-1",
        planId: "upgrade-plan-1",
        upgradeRunId: "upgrade-run-1",
        sourceRuntimeVersion: "opencode@1.0.0",
        targetRuntimeVersion: "opencode@1.1.0",
        signalKey: "runtime.smoke",
        status: "degraded",
        summary: "Synthetic smoke checks are degraded.",
        approvalRefs: ["approval:upgrade-1"],
        backupRefs: ["backup:manifest-1"],
        healthRefs: ["health:signal-1"],
        rollbackRefs: ["rollback:playbook-1"],
        evidenceRefs: ["evidence:health-log-1"],
        recordedAt: "2026-04-30T00:06:00.000Z",
      }],
      occurredAt: "2026-04-30T00:07:00.000Z",
      actorId: "operator-1",
      transitionKey: "health-degraded-1",
    });

    expect(result.outcome).toBe("failed");
    expect(result.run.status).toBe("failed");
    expect(result.run.failureReason).toContain("runtime.smoke is degraded");
    expect(result.events[1].objectRef.kind).toBe("health_signal");
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
