import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UpgradeStore } from "@/ops/upgrade-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-ops-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const store = new UpgradeStore({ dataDir });
  await seedRun(store, {
    runId: "upgrade-run-ready",
    planId: "upgrade-plan-ready",
    runStatus: "healthCheck",
    gateStatus: "passed",
    healthStatus: "healthy",
  });
  await seedRun(store, {
    runId: "upgrade-run-blocked",
    planId: "upgrade-plan-blocked",
    runStatus: "approved",
    gateStatus: "blocked",
    healthStatus: "degraded",
  });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("pnpm ops", () => {
  it("lists plans and runs in json mode", async () => {
    const plans = await runCli(["plans", "--json"]);
    expect(plans.exitCode).toBe(0);
    expect(JSON.parse(plans.stdout).items.map((item: { id: string }) => item.id)).toEqual([
      "upgrade-plan-blocked",
      "upgrade-plan-ready",
    ]);

    const runs = await runCli(["runs", "--status", "healthCheck", "--json"]);
    expect(runs.exitCode).toBe(0);
    expect(JSON.parse(runs.stdout).items.map((item: { id: string }) => item.id)).toEqual([
      "upgrade-run-ready",
    ]);
  });

  it("shows backup, health, and rollback operator queries", async () => {
    const backup = await runCli(["backup", "--run", "upgrade-run-ready"]);
    expect(backup.exitCode).toBe(0);
    expect(backup.stdout).toContain("backup-upgrade-run-ready");
    expect(backup.stdout).toContain("true");

    const health = await runCli(["health", "--run", "upgrade-run-blocked", "--status", "degraded"]);
    expect(health.exitCode).toBe(0);
    expect(health.stdout).toContain("health-upgrade-run-blocked");
    expect(health.stdout).toContain("degraded");

    const rollback = await runCli(["rollback", "--run", "upgrade-run-ready"]);
    expect(rollback.exitCode).toBe(0);
    expect(rollback.stdout).toContain("rollback-upgrade-run-ready");
    expect(rollback.stdout).toContain("Use when local health checks fail.");
  });

  it("renders readiness summaries from local upgrade controls", async () => {
    const readiness = await runCli(["readiness", "--json"]);
    expect(readiness.exitCode).toBe(0);
    const output = JSON.parse(readiness.stdout) as {
      items: Array<{
        workspaceId: string;
        planId: string;
        upgradeRunId: string;
        ready: boolean;
        verifiedBackupCount: number;
        rollbackPlaybookCount: number;
        blockingGateKeys: string[];
        latestHealthStatus: string | null;
      }>;
    };
    expect(output.items).toEqual([
      expect.objectContaining({
        workspaceId: "workspace-1",
        planId: "upgrade-plan-blocked",
        upgradeRunId: "upgrade-run-blocked",
        ready: false,
        verifiedBackupCount: 1,
        rollbackPlaybookCount: 1,
        blockingGateKeys: ["health_check"],
        latestHealthStatus: "degraded",
      }),
      expect.objectContaining({
        workspaceId: "workspace-1",
        planId: "upgrade-plan-ready",
        upgradeRunId: "upgrade-run-ready",
        ready: true,
        verifiedBackupCount: 1,
        rollbackPlaybookCount: 1,
        blockingGateKeys: [],
        latestHealthStatus: "healthy",
      }),
    ]);
  });

  it("lists filtered upgrade audit events", async () => {
    const audit = await runCli(["audit", "--run", "upgrade-run-ready", "--event-type", "rollback_prepared", "--json"]);
    expect(audit.exitCode).toBe(0);
    const output = JSON.parse(audit.stdout) as { items: Array<{ eventType: string; upgradeRunId: string | null }> };
    expect(output.items).toHaveLength(1);
    expect(output.items[0]).toMatchObject({
      eventType: "rollback_prepared",
      upgradeRunId: "upgrade-run-ready",
    });
  });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/ops.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: dataDir },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const result = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.code ?? 1 };
  }
}

async function seedRun(
  store: UpgradeStore,
  input: {
    runId: string;
    planId: string;
    runStatus: string;
    gateStatus: "passed" | "blocked";
    healthStatus: "healthy" | "degraded";
  },
): Promise<void> {
  await store.put({
    schema: "pluto.ops.upgrade-plan",
    schemaVersion: 0,
    id: input.planId,
    workspaceId: "workspace-1",
    requestedById: "operator-1",
    sourceRuntimeVersion: "opencode@1.0.0",
    targetRuntimeVersion: "opencode@1.1.0",
    status: "approved",
    summary: `Upgrade plan for ${input.runId}`,
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [`backup:${input.runId}`],
    healthRefs: [`health:${input.runId}`],
    rollbackRefs: [`rollback:${input.runId}`],
    evidenceRefs: [`evidence:ticket:${input.runId}`],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: input.runId.endsWith("ready") ? "2026-04-30T00:06:00.000Z" : "2026-04-30T00:07:00.000Z",
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
    lastTransitionAt: "2026-04-30T00:02:00.000Z",
    lastTransitionKey: `transition:${input.runId}`,
    startedAt: "2026-04-30T00:01:00.000Z",
    finishedAt: null,
    failureReason: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: input.runId.endsWith("ready") ? "2026-04-30T00:06:00.000Z" : "2026-04-30T00:07:00.000Z",
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
    createdAt: "2026-04-30T00:03:00.000Z",
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
    summary: `${input.healthStatus} local check`,
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [`backup:${input.runId}`],
    healthRefs: [`health:${input.runId}`],
    rollbackRefs: [`rollback:${input.runId}`],
    evidenceRefs: [`evidence:health:${input.runId}`],
    recordedAt: "2026-04-30T00:04:00.000Z",
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
    triggerSummary: "Use when local health checks fail.",
    steps: ["Stop runtime", "Restore backup"],
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: [`backup:${input.runId}`],
    healthRefs: [`health:${input.runId}`],
    rollbackRefs: [`rollback:${input.runId}`],
    evidenceRefs: [`evidence:rollback:${input.runId}`],
    createdAt: "2026-04-30T00:05:00.000Z",
    updatedAt: "2026-04-30T00:05:00.000Z",
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
      status: gateKey === "health_check" ? input.gateStatus : "passed",
      summary: `${gateKey} ${gateKey === "health_check" ? input.gateStatus : "passed"}`,
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: [`backup:${input.runId}`],
      healthRefs: [`health:${input.runId}`],
      rollbackRefs: [`rollback:${input.runId}`],
      evidenceRefs: [`evidence:gate:${input.runId}:${gateKey}`],
      checkedAt: gateKey === "health_check" ? "2026-04-30T00:06:00.000Z" : "2026-04-30T00:05:30.000Z",
    });
  }
}
