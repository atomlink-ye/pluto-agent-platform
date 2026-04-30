import { describe, expect, it } from "vitest";

import { assertUpgradeExecutableV0 } from "@/ops/upgrade-gates.js";

describe("upgrade approval gate", () => {
  it("blocks execution when the plan has no approval refs", () => {
    expect(() => assertUpgradeExecutableV0({
      plan: {
        schema: "pluto.ops.upgrade-plan",
        schemaVersion: 0,
        id: "upgrade-plan-1",
        workspaceId: "workspace-1",
        requestedById: "operator-1",
        sourceRuntimeVersion: "opencode@1.0.0",
        targetRuntimeVersion: "opencode@1.1.0",
        status: "planned",
        summary: "Upgrade runtime locally.",
        approvalRefs: [],
        backupRefs: ["backup:manifest-1"],
        healthRefs: [],
        rollbackRefs: ["rollback:playbook-1"],
        evidenceRefs: ["evidence:ticket-1"],
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
      backupManifest: null,
      occurredAt: "2026-04-30T00:01:00.000Z",
      actorId: "operator-1",
    })).toThrow("Upgrade plan upgrade-plan-1 is missing approval refs");
  });
});
