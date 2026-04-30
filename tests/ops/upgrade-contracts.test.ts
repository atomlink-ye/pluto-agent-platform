import { describe, expect, it } from "vitest";

import {
  approveUpgradeRunV0,
  completeUpgradeRunV0,
  failUpgradeRunV0,
  startUpgradeBackupV0,
  startUpgradeExecutionV0,
  startUpgradeHealthCheckV0,
  startUpgradeValidationV0,
  transitionUpgradeRunV0,
} from "@/ops/upgrade-lifecycle.js";
import {
  validateBackupManifestV0,
  validateHealthSignalV0,
  validateRollbackPlaybookV0,
  validateUpgradeReadinessItemV0,
  validateRuntimePairingStateV0,
  validateUpgradePlanV0,
  validateUpgradeRunV0,
} from "@/contracts/ops.js";

describe("upgrade contracts", () => {
  it("validates upgrade planning and runtime records", () => {
    const plan = {
      schema: "pluto.ops.upgrade-plan",
      schemaVersion: 0,
      id: "upgrade-plan-1",
      workspaceId: "workspace-1",
      requestedById: "operator-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "planned",
      summary: "Upgrade the workspace runtime to the next vetted OpenCode build.",
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: [],
      healthRefs: [],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:change-ticket-1"],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    };

    const run = {
      schema: "pluto.ops.upgrade-run",
      schemaVersion: 0,
      id: "upgrade-run-1",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "planned",
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: [],
      healthRefs: [],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:change-ticket-1"],
      lastTransitionAt: "2026-04-30T00:00:00.000Z",
      lastTransitionKey: null,
      startedAt: null,
      finishedAt: null,
      failureReason: null,
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    };

    const backup = {
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
    };

    const health = {
      schema: "pluto.ops.health-signal",
      schemaVersion: 0,
      id: "health-1",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      signalKey: "runtime.smoke",
      status: "healthy",
      summary: "Smoke test passed against the upgraded runtime.",
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: ["health:signal-1"],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:smoke-output-1"],
      recordedAt: "2026-04-30T00:02:00.000Z",
    };

    const rollback = {
      schema: "pluto.ops.rollback-playbook",
      schemaVersion: 0,
      id: "rollback-playbook-1",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      triggerSummary: "Use when health checks fail after runtime pairing completes.",
      steps: ["Stop runtime", "Restore backup", "Rebind traffic"],
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: ["health:signal-1"],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:rollback-drill-1"],
      createdAt: "2026-04-30T00:03:00.000Z",
      updatedAt: "2026-04-30T00:03:00.000Z",
    };

    const pairing = {
      schema: "pluto.ops.runtime-pairing-state",
      schemaVersion: 0,
      id: "pairing-1",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "paired",
      pairedRuntimeIds: ["runtime:old", "runtime:new"],
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: ["health:signal-1"],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:pairing-log-1"],
      createdAt: "2026-04-30T00:04:00.000Z",
      updatedAt: "2026-04-30T00:04:00.000Z",
    };

    expect(validateUpgradePlanV0(plan).ok).toBe(true);
    expect(validateUpgradeRunV0(run).ok).toBe(true);
    expect(validateBackupManifestV0(backup).ok).toBe(true);
    expect(validateHealthSignalV0(health).ok).toBe(true);
    expect(validateRollbackPlaybookV0(rollback).ok).toBe(true);
    expect(validateRuntimePairingStateV0(pairing).ok).toBe(true);
  });

  it("rejects malformed refs on upgrade records", () => {
    const result = validateUpgradePlanV0({
      schema: "pluto.ops.upgrade-plan",
      schemaVersion: 0,
      id: "upgrade-plan-bad",
      workspaceId: "workspace-1",
      requestedById: "operator-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "planned",
      summary: "Broken refs",
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: [1],
      healthRefs: [],
      rollbackRefs: [],
      evidenceRefs: [],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("backupRefs must be an array of strings");
  });

  it("validates derived upgrade readiness items with stable identity and audit fields", () => {
    const result = validateUpgradeReadinessItemV0({
      schemaVersion: 0,
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      planStatus: "approved",
      runStatus: "healthCheck",
      backupVerified: true,
      verifiedBackupCount: 1,
      latestHealthStatus: "healthy",
      rollbackPrepared: true,
      rollbackPlaybookCount: 1,
      gateStatus: {
        approval: "passed",
        backup: "passed",
        runtime_pairing: "passed",
        health_check: "passed",
        rollback_readiness: "passed",
      },
      blockingGateKeys: [],
      pendingGateKeys: [],
      recentEventTypes: ["gate_evaluated", "rollback_prepared"],
      evidenceRefs: ["evidence:rollback-1", "evidence:gate-1"],
      ready: true,
    });

    expect(result.ok).toBe(true);
  });
});

describe("upgrade lifecycle", () => {
  it("moves through the fail-secure lifecycle in order", () => {
    const planned = baseRun();
    const approved = approveUpgradeRunV0(planned, "2026-04-30T00:01:00.000Z", "approve-1");
    const backingUp = startUpgradeBackupV0(approved, "2026-04-30T00:02:00.000Z", "backup-1", ["backup:manifest-1"]);
    const running = startUpgradeExecutionV0(backingUp, "2026-04-30T00:03:00.000Z", "run-1");
    const validating = startUpgradeValidationV0(running, "2026-04-30T00:04:00.000Z", "validate-1");
    const healthCheck = startUpgradeHealthCheckV0(validating, "2026-04-30T00:05:00.000Z", "health-1", ["health:signal-1"]);
    const completed = completeUpgradeRunV0(healthCheck, "2026-04-30T00:06:00.000Z", "complete-1", ["evidence:cutover-1"]);

    expect(completed.status).toBe("completed");
    expect(completed.startedAt).toBe("2026-04-30T00:01:00.000Z");
    expect(completed.finishedAt).toBe("2026-04-30T00:06:00.000Z");
    expect(completed.backupRefs).toContain("backup:manifest-1");
    expect(completed.healthRefs).toContain("health:signal-1");
    expect(completed.evidenceRefs).toContain("evidence:cutover-1");
  });

  it("supports replay protection for the last applied transition key", () => {
    const approved = approveUpgradeRunV0(baseRun(), "2026-04-30T00:01:00.000Z", "approve-1");
    const replayed = approveUpgradeRunV0(approved, "2026-04-30T00:09:00.000Z", "approve-1");

    expect(replayed).toBe(approved);
    expect(replayed.lastTransitionAt).toBe("2026-04-30T00:01:00.000Z");
  });

  it("rejects skipped stages and conflicting terminal outcomes", () => {
    expect(() => startUpgradeExecutionV0(baseRun(), "2026-04-30T00:01:00.000Z", "run-1")).toThrow(
      "Invalid upgrade transition from planned to running",
    );

    const completed = completeUpgradeRunV0(
      startUpgradeHealthCheckV0(
        startUpgradeValidationV0(
          startUpgradeExecutionV0(
            startUpgradeBackupV0(
              approveUpgradeRunV0(baseRun(), "2026-04-30T00:01:00.000Z", "approve-1"),
              "2026-04-30T00:02:00.000Z",
              "backup-1",
            ),
            "2026-04-30T00:03:00.000Z",
            "run-1",
          ),
          "2026-04-30T00:04:00.000Z",
          "validate-1",
        ),
        "2026-04-30T00:05:00.000Z",
        "health-1",
      ),
      "2026-04-30T00:06:00.000Z",
      "complete-1",
    );

    expect(() => failUpgradeRunV0(completed, "2026-04-30T00:07:00.000Z", "late failure", "fail-1")).toThrow(
      "Upgrade run upgrade-run-1 is already terminal at completed",
    );
  });

  it("requires a failure reason and rejects unknown statuses fail-secure", () => {
    expect(() => transitionUpgradeRunV0({
      run: { ...baseRun(), status: "future_status" },
      toStatus: "approved",
      transitionedAt: "2026-04-30T00:01:00.000Z",
      transitionKey: "approve-1",
    })).toThrow("run.status must be one of: planned, approved, backingUp, running, validating, healthCheck, completed, rolledBack, failed");

    expect(() => failUpgradeRunV0(baseRun(), "2026-04-30T00:01:00.000Z", "" as string, "fail-1")).not.toThrow();
    expect(() => transitionUpgradeRunV0({
      run: baseRun(),
      toStatus: "failed",
      transitionedAt: "2026-04-30T00:01:00.000Z",
      transitionKey: "fail-1",
    })).toThrow("failureReason is required when transitioning to failed");
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
    status: "planned",
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [],
    healthRefs: [],
    rollbackRefs: ["rollback:playbook-1"],
    evidenceRefs: ["evidence:change-ticket-1"],
    lastTransitionAt: "2026-04-30T00:00:00.000Z",
    lastTransitionKey: null,
    startedAt: null,
    finishedAt: null,
    failureReason: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
  };
}
