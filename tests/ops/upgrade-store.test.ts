import { dirname, join } from "node:path";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UpgradeStore } from "@/ops/upgrade-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-upgrade-store-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("upgrade store", () => {
  it("persists, loads, and lists upgrade records by schema", async () => {
    const store = new UpgradeStore({ dataDir: workDir });
    const plan = await store.put({
      schema: "pluto.ops.upgrade-plan",
      schemaVersion: 0,
      id: "upgrade-plan-1",
      workspaceId: "workspace-1",
      requestedById: "operator-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "planned",
      summary: "Upgrade the workspace runtime.",
      approvalRefs: ["approval:upgrade-1", "approval:upgrade-1"],
      backupRefs: [],
      healthRefs: [],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:ticket-1"],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    });

    expect(plan.approvalRefs).toEqual(["approval:upgrade-1"]);
    expect(await store.get("pluto.ops.upgrade-plan", "upgrade-plan-1")).toEqual(plan);
    expect(await store.list("pluto.ops.upgrade-plan", "workspace-1")).toEqual([plan]);
    expect(await store.list("pluto.ops.upgrade-plan", "workspace-2")).toEqual([]);
  });

  it("keeps stored legacy done statuses readable without rewriting them", async () => {
    const store = new UpgradeStore({ dataDir: workDir });
    await store.put({
      schema: "pluto.ops.runtime-pairing-state",
      schemaVersion: 0,
      id: "pairing-probe",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "pending",
      pairedRuntimeIds: ["runtime:old", "runtime:new"],
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: ["health:signal-1"],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:pairing-log-1"],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    });

    const dir = dirname(await findFileNamed(workDir, "pairing-probe.json"));
    const record = {
      schema: "pluto.ops.runtime-pairing-state",
      schemaVersion: 0,
      id: "pairing-legacy",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "done",
      pairedRuntimeIds: ["runtime:old", "runtime:new"],
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: ["health:signal-1"],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:pairing-log-1"],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    };

    await writeFile(join(dir, "pairing-legacy.json"), JSON.stringify(record, null, 2) + "\n", "utf8");

    const loaded = await store.get("pluto.ops.runtime-pairing-state", "pairing-legacy");
    expect(loaded?.status).toBe("done");

    const persisted = await readFile(join(dir, "pairing-legacy.json"), "utf8");
    expect(persisted).toContain('"status": "done"');
  });

  it("rejects invalid records on write", async () => {
    const store = new UpgradeStore({ dataDir: workDir });

    await expect(store.put({
      schema: "pluto.ops.health-signal",
      schemaVersion: 0,
      id: "health-bad",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      signalKey: "runtime.smoke",
      status: "healthy",
      summary: "Missing evidence refs array",
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: ["health:signal-1"],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: [1],
      recordedAt: "2026-04-30T00:00:00.000Z",
    } as never)).rejects.toThrow("Invalid upgrade record: evidenceRefs must be an array of strings");
  });

  it("records local audit events for gates, rollback preparation, and run transitions", async () => {
    const store = new UpgradeStore({ dataDir: workDir });

    await store.put({
      schema: "pluto.ops.rollback-playbook",
      schemaVersion: 0,
      id: "rollback-playbook-1",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      triggerSummary: "Use when post-upgrade health checks fail.",
      steps: ["Stop runtime", "Restore backup"],
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: [],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:rollback-drill-1"],
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
    });

    await store.put({
      schema: "pluto.ops.upgrade-gate",
      schemaVersion: 0,
      id: "upgrade-run-1:health_check",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      upgradeRunId: "upgrade-run-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      gateKey: "health_check",
      status: "blocked",
      summary: "Healthy signal is missing.",
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: [],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:health-log-1"],
      checkedAt: "2026-04-30T00:01:00.000Z",
    });

    await store.put({
      schema: "pluto.ops.upgrade-run",
      schemaVersion: 0,
      id: "upgrade-run-1",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "approved",
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: [],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:ticket-1"],
      lastTransitionAt: "2026-04-30T00:02:00.000Z",
      lastTransitionKey: "approve-1",
      startedAt: "2026-04-30T00:02:00.000Z",
      finishedAt: null,
      failureReason: null,
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:02:00.000Z",
    });

    await store.put({
      schema: "pluto.ops.upgrade-run",
      schemaVersion: 0,
      id: "upgrade-run-1",
      workspaceId: "workspace-1",
      planId: "upgrade-plan-1",
      sourceRuntimeVersion: "opencode@1.0.0",
      targetRuntimeVersion: "opencode@1.1.0",
      status: "running",
      approvalRefs: ["approval:upgrade-1"],
      backupRefs: ["backup:manifest-1"],
      healthRefs: [],
      rollbackRefs: ["rollback:playbook-1"],
      evidenceRefs: ["evidence:ticket-1"],
      lastTransitionAt: "2026-04-30T00:03:00.000Z",
      lastTransitionKey: "run-1",
      startedAt: "2026-04-30T00:02:00.000Z",
      finishedAt: null,
      failureReason: null,
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:03:00.000Z",
    });

    expect((await store.listEvents()).map((event) => event.eventType)).toEqual([
      "rollback_prepared",
      "gate_evaluated",
      "execution_started",
    ]);
  });
});

async function findFileNamed(root: string, name: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === name) {
      return path;
    }

    if (entry.isDirectory()) {
      const nested = await findFileNamed(path, name).catch(() => null);
      if (nested !== null) {
        return nested;
      }
    }
  }

  throw new Error(`File not found: ${name}`);
}
