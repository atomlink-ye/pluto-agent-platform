import { describe, expect, it } from "vitest";

import { assertUpgradeExecutableV0 } from "@/ops/upgrade-gates.js";

describe("backup verification gate", () => {
  it("blocks execution when the required backup manifest is not verified", () => {
    expect(() => assertUpgradeExecutableV0({
      plan: basePlan(),
      backupManifest: {
        schema: "pluto.ops.backup-manifest",
        schemaVersion: 0,
        id: "backup-1",
        workspaceId: "workspace-1",
        planId: "upgrade-plan-1",
        upgradeRunId: "upgrade-run-1",
        sourceRuntimeVersion: "opencode@1.0.0",
        targetRuntimeVersion: "opencode@1.1.0",
        manifestRef: "backup:manifest-1",
        approvalRefs: ["approval:upgrade-1"],
        backupRefs: ["backup:manifest-1"],
        healthRefs: [],
        rollbackRefs: ["rollback:playbook-1"],
        evidenceRefs: [],
        createdAt: "2026-04-30T00:01:00.000Z",
      },
      occurredAt: "2026-04-30T00:02:00.000Z",
      actorId: "operator-1",
    })).toThrow("Backup manifest backup-1 is not verified for plan upgrade-plan-1");
  });

  it("emits approval, backup verification, and executable decision events when checks pass", () => {
    const result = assertUpgradeExecutableV0({
      plan: basePlan(),
      backupManifest: {
        schema: "pluto.ops.backup-manifest",
        schemaVersion: 0,
        id: "backup-1",
        workspaceId: "workspace-1",
        planId: "upgrade-plan-1",
        upgradeRunId: "upgrade-run-1",
        sourceRuntimeVersion: "opencode@1.0.0",
        targetRuntimeVersion: "opencode@1.1.0",
        manifestRef: "backup:manifest-1",
        approvalRefs: ["approval:upgrade-1"],
        backupRefs: ["backup:manifest-1"],
        healthRefs: [],
        rollbackRefs: ["rollback:playbook-1"],
        evidenceRefs: ["evidence:backup-checksum-1"],
        createdAt: "2026-04-30T00:01:00.000Z",
      },
      occurredAt: "2026-04-30T00:02:00.000Z",
      actorId: "operator-1",
    });

    expect(result.events.map((event) => event.eventType)).toEqual([
      "approval_recorded",
      "backup_verification_recorded",
      "decision_recorded",
    ]);
  });
});

function basePlan() {
  return {
    schema: "pluto.ops.upgrade-plan" as const,
    schemaVersion: 0 as const,
    id: "upgrade-plan-1",
    workspaceId: "workspace-1",
    requestedById: "operator-1",
    sourceRuntimeVersion: "opencode@1.0.0",
    targetRuntimeVersion: "opencode@1.1.0",
    status: "planned",
    summary: "Upgrade runtime locally.",
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: ["backup:manifest-1"],
    healthRefs: [],
    rollbackRefs: ["rollback:playbook-1"],
    evidenceRefs: ["evidence:ticket-1"],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
  };
}
