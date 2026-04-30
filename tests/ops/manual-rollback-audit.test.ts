import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { recordManualRollbackV0 } from "@/ops/rollback.js";
import { UpgradeStore } from "@/ops/upgrade-store.js";

describe("manual rollback audit", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists rollback invocation status and evidence through the upgrade store facade", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-manual-rollback-"));
    const store = new UpgradeStore({ dataDir });
    const run = await store.put<"pluto.ops.upgrade-run">(baseRun());

    const result = await recordManualRollbackV0({
      store,
      run,
      playbook: {
        schema: "pluto.ops.rollback-playbook",
        schemaVersion: 0,
        id: "rollback-playbook-1",
        workspaceId: "workspace-1",
        planId: "upgrade-plan-1",
        upgradeRunId: "upgrade-run-1",
        sourceRuntimeVersion: "opencode@1.0.0",
        targetRuntimeVersion: "opencode@1.1.0",
        triggerSummary: "Use when validation fails.",
        steps: ["Stop runtime", "Restore backup"],
        approvalRefs: ["approval:upgrade-1"],
        backupRefs: ["backup:manifest-1"],
        healthRefs: ["health:signal-1"],
        rollbackRefs: ["rollback:playbook-1"],
        evidenceRefs: ["evidence:rollback-drill-1"],
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
      occurredAt: "2026-04-30T00:06:00.000Z",
      actorId: "operator-1",
      status: "completed",
      transitionKey: "rollback-1",
      reason: "Manual rollback invoked after failed smoke check.",
      evidenceRefs: ["evidence:rollback-console-1"],
    });

    expect(result.run.status).toBe("rolledBack");
    expect(result.event.eventType).toBe("rollback_recorded");
    expect(result.event.details.status).toBe("completed");
    expect(result.event.evidenceRefs).toContain("evidence:rollback-console-1");
    expect((await store.get("pluto.ops.upgrade-run", "upgrade-run-1"))?.status).toBe("rolledBack");
    expect((await store.listEvents({ upgradeRunId: "upgrade-run-1" })).map((event) => event.eventType)).toEqual([
      "rollback_recorded",
      "rollback_recorded",
    ]);
  });

  it("preserves the current run status for invoked rollbacks while still recording audit evidence", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-manual-rollback-invoked-"));
    const store = new UpgradeStore({ dataDir });
    const run = await store.put<"pluto.ops.upgrade-run">(baseRun());

    const result = await recordManualRollbackV0({
      store,
      run,
      playbook: {
        schema: "pluto.ops.rollback-playbook",
        schemaVersion: 0,
        id: "rollback-playbook-1",
        workspaceId: "workspace-1",
        planId: "upgrade-plan-1",
        upgradeRunId: "upgrade-run-1",
        sourceRuntimeVersion: "opencode@1.0.0",
        targetRuntimeVersion: "opencode@1.1.0",
        triggerSummary: "Use when validation fails.",
        steps: ["Stop runtime", "Restore backup"],
        approvalRefs: ["approval:upgrade-1"],
        backupRefs: ["backup:manifest-1"],
        healthRefs: ["health:signal-1"],
        rollbackRefs: ["rollback:playbook-1"],
        evidenceRefs: ["evidence:rollback-drill-1"],
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
      occurredAt: "2026-04-30T00:06:00.000Z",
      actorId: "operator-1",
      status: "invoked",
      transitionKey: "rollback-1",
      reason: "Manual rollback prepared while health checks are still running.",
      evidenceRefs: ["evidence:rollback-console-1"],
    });

    expect(result.run.status).toBe("healthCheck");
    expect(result.run.lastTransitionKey).toBe("health-check-1");
    expect(result.run.evidenceRefs).toContain("evidence:rollback-console-1");
    expect(result.event.eventType).toBe("rollback_recorded");
    expect(result.event.details.status).toBe("invoked");
    expect((await store.get("pluto.ops.upgrade-run", "upgrade-run-1"))?.status).toBe("healthCheck");
  });

  it("preserves the current run status for failed rollback attempts while still recording audit evidence", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-manual-rollback-failed-"));
    const store = new UpgradeStore({ dataDir });
    const run = await store.put<"pluto.ops.upgrade-run">(baseRun());

    const result = await recordManualRollbackV0({
      store,
      run,
      playbook: {
        schema: "pluto.ops.rollback-playbook",
        schemaVersion: 0,
        id: "rollback-playbook-1",
        workspaceId: "workspace-1",
        planId: "upgrade-plan-1",
        upgradeRunId: "upgrade-run-1",
        sourceRuntimeVersion: "opencode@1.0.0",
        targetRuntimeVersion: "opencode@1.1.0",
        triggerSummary: "Use when validation fails.",
        steps: ["Stop runtime", "Restore backup"],
        approvalRefs: ["approval:upgrade-1"],
        backupRefs: ["backup:manifest-1"],
        healthRefs: ["health:signal-1"],
        rollbackRefs: ["rollback:playbook-1"],
        evidenceRefs: ["evidence:rollback-drill-1"],
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
      occurredAt: "2026-04-30T00:06:00.000Z",
      actorId: "operator-1",
      status: "failed",
      transitionKey: "rollback-1",
      reason: "Rollback helper failed while restoring the backup.",
      evidenceRefs: ["evidence:rollback-error-1"],
    });

    expect(result.run.status).toBe("healthCheck");
    expect(result.run.lastTransitionKey).toBe("health-check-1");
    expect(result.run.evidenceRefs).toContain("evidence:rollback-error-1");
    expect(result.event.eventType).toBe("rollback_recorded");
    expect(result.event.details.status).toBe("failed");
    expect((await store.get("pluto.ops.upgrade-run", "upgrade-run-1"))?.status).toBe("healthCheck");
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
    healthRefs: ["health:signal-1"],
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
