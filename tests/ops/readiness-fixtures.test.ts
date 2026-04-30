import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildUpgradeReadinessItems } from "@/cli/ops.js";
import { validateUpgradeReadinessItemV0 } from "@/contracts/ops.js";
import { UpgradeStore } from "@/ops/upgrade-store.js";

let workDir: string;
let dataDir: string;
let store: UpgradeStore;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-ops-readiness-fixtures-"));
  dataDir = join(workDir, ".pluto");
  store = new UpgradeStore({ dataDir });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("ops readiness fixtures", () => {
  it("derives ready and blocked local upgrade states from stored controls", async () => {
    await seedFixtureRun({
      runId: "upgrade-run-ready",
      planId: "upgrade-plan-ready",
      runStatus: "healthCheck",
      healthStatus: "healthy",
      blockedHealthGate: false,
    });
    await seedFixtureRun({
      runId: "upgrade-run-blocked",
      planId: "upgrade-plan-blocked",
      runStatus: "approved",
      healthStatus: "failed",
      blockedHealthGate: true,
    });

    const items = await buildUpgradeReadinessItems(store, { workspaceId: "workspace-1" });
    expect(items).toHaveLength(2);
    expect(items).toContainEqual(expect.objectContaining({
        upgradeRunId: "upgrade-run-ready",
        ready: true,
        backupVerified: true,
        latestHealthStatus: "healthy",
        rollbackPrepared: true,
        pendingGateKeys: [],
        blockingGateKeys: [],
      }));
    expect(items).toContainEqual(expect.objectContaining({
        upgradeRunId: "upgrade-run-blocked",
        ready: false,
        backupVerified: true,
        latestHealthStatus: "failed",
        rollbackPrepared: true,
        blockingGateKeys: ["health_check"],
      }));
  });

  it("keeps audit evidence visible in the derived readiness view", async () => {
    await seedFixtureRun({
      runId: "upgrade-run-ready",
      planId: "upgrade-plan-ready",
      runStatus: "healthCheck",
      healthStatus: "healthy",
      blockedHealthGate: false,
    });

    const [item] = await buildUpgradeReadinessItems(store, { upgradeRunId: "upgrade-run-ready" });
    expect(validateUpgradeReadinessItemV0(item).ok).toBe(true);
    expect(item).toMatchObject({
      workspaceId: "workspace-1",
      planId: "upgrade-plan-ready",
      upgradeRunId: "upgrade-run-ready",
      verifiedBackupCount: 1,
      rollbackPlaybookCount: 1,
    });
    expect(item?.recentEventTypes).toContain("rollback_prepared");
    expect(item?.recentEventTypes).toContain("gate_evaluated");
    expect(item?.evidenceRefs).toContain("evidence:rollback:upgrade-run-ready");
    expect(item?.evidenceRefs).toContain("evidence:gate:upgrade-run-ready:health_check");
  });
});

async function seedFixtureRun(input: {
  runId: string;
  planId: string;
  runStatus: string;
  healthStatus: "healthy" | "failed";
  blockedHealthGate: boolean;
}): Promise<void> {
  await store.put({
    schema: "pluto.ops.upgrade-plan",
    schemaVersion: 0,
    id: input.planId,
    workspaceId: "workspace-1",
    requestedById: "operator-1",
    sourceRuntimeVersion: "opencode@1.0.0",
    targetRuntimeVersion: "opencode@1.1.0",
    status: "approved",
    summary: `Fixture plan for ${input.runId}`,
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [`backup:${input.runId}`],
    healthRefs: [`health:${input.runId}`],
    rollbackRefs: [`rollback:${input.runId}`],
    evidenceRefs: [`evidence:ticket:${input.runId}`],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
  });

  await store.put({
    schema: "pluto.ops.upgrade-run",
    schemaVersion: 0,
    id: input.runId,
    workspaceId: "workspace-1",
    planId: input.planId,
    sourceRuntimeVersion: "opencode@1.0.0",
    targetRuntimeVersion: "opencode@1.1.0",
    status: input.runStatus,
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [`backup:${input.runId}`],
    healthRefs: [`health:${input.runId}`],
    rollbackRefs: [`rollback:${input.runId}`],
    evidenceRefs: [`evidence:run:${input.runId}`],
    lastTransitionAt: "2026-04-30T00:01:00.000Z",
    lastTransitionKey: `transition:${input.runId}`,
    startedAt: "2026-04-30T00:01:00.000Z",
    finishedAt: null,
    failureReason: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:01:00.000Z",
  });

  await store.put({
    schema: "pluto.ops.backup-manifest",
    schemaVersion: 0,
    id: `backup-${input.runId}`,
    workspaceId: "workspace-1",
    planId: input.planId,
    upgradeRunId: input.runId,
    sourceRuntimeVersion: "opencode@1.0.0",
    targetRuntimeVersion: "opencode@1.1.0",
    manifestRef: `backup:${input.runId}`,
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [`backup:${input.runId}`],
    healthRefs: [`health:${input.runId}`],
    rollbackRefs: [`rollback:${input.runId}`],
    evidenceRefs: [`evidence:backup:${input.runId}`],
    createdAt: "2026-04-30T00:02:00.000Z",
  });

  await store.put({
    schema: "pluto.ops.health-signal",
    schemaVersion: 0,
    id: `health-${input.runId}`,
    workspaceId: "workspace-1",
    planId: input.planId,
    upgradeRunId: input.runId,
    sourceRuntimeVersion: "opencode@1.0.0",
    targetRuntimeVersion: "opencode@1.1.0",
    signalKey: "runtime.smoke",
    status: input.healthStatus,
    summary: `${input.healthStatus} smoke signal`,
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [`backup:${input.runId}`],
    healthRefs: [`health:${input.runId}`],
    rollbackRefs: [`rollback:${input.runId}`],
    evidenceRefs: [`evidence:health:${input.runId}`],
    recordedAt: "2026-04-30T00:03:00.000Z",
  });

  await store.put({
    schema: "pluto.ops.rollback-playbook",
    schemaVersion: 0,
    id: `rollback-${input.runId}`,
    workspaceId: "workspace-1",
    planId: input.planId,
    upgradeRunId: input.runId,
    sourceRuntimeVersion: "opencode@1.0.0",
    targetRuntimeVersion: "opencode@1.1.0",
    triggerSummary: "Use when smoke validation fails.",
    steps: ["Stop runtime", "Restore backup"],
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [`backup:${input.runId}`],
    healthRefs: [`health:${input.runId}`],
    rollbackRefs: [`rollback:${input.runId}`],
    evidenceRefs: [`evidence:rollback:${input.runId}`],
    createdAt: "2026-04-30T00:04:00.000Z",
    updatedAt: "2026-04-30T00:04:00.000Z",
  });

  for (const gateKey of ["approval", "backup", "runtime_pairing", "health_check", "rollback_readiness"] as const) {
    await store.put({
      schema: "pluto.ops.upgrade-gate",
      schemaVersion: 0,
      id: `${input.runId}:${gateKey}`,
      workspaceId: "workspace-1",
      planId: input.planId,
      upgradeRunId: input.runId,
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      gateKey,
      status: gateKey === "health_check" && input.blockedHealthGate ? "blocked" : "passed",
      summary: `${gateKey} gate`,
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: [`backup:${input.runId}`],
      healthRefs: [`health:${input.runId}`],
      rollbackRefs: [`rollback:${input.runId}`],
      evidenceRefs: [`evidence:gate:${input.runId}:${gateKey}`],
      checkedAt: gateKey === "health_check" ? "2026-04-30T00:05:00.000Z" : "2026-04-30T00:04:30.000Z",
    });
  }
}
