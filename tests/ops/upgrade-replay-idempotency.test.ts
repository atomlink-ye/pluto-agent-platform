import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { approveUpgradeRunV0, completeUpgradeRunV0 } from "@/ops/upgrade-lifecycle.js";
import { createUpgradeLocalEventV0, toUpgradeRunRefV0, UpgradeStore } from "@/index.js";

describe("upgrade replay idempotency", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reuses the same transition for matching replay keys and records explicit replay/conflict audit events", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-upgrade-replay-"));
    const store = new UpgradeStore({ dataDir });

    const approved = approveUpgradeRunV0(baseRun(), "2026-04-30T00:01:00.000Z", "approve-1");
    const replayed = approveUpgradeRunV0(approved, "2026-04-30T00:09:00.000Z", "approve-1");
    expect(replayed).toBe(approved);

    const completed = completeUpgradeRunV0(
      { ...approved, status: "healthCheck", lastTransitionKey: "health-1", lastTransitionAt: "2026-04-30T00:05:00.000Z" },
      "2026-04-30T00:06:00.000Z",
      "complete-1",
    );
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "idempotent_replay_reused",
      workspaceId: approved.workspaceId,
      planId: approved.planId,
      upgradeRunId: approved.id,
      occurredAt: "2026-04-30T00:09:00.000Z",
      actorId: "operator-1",
      subjectRef: toUpgradeRunRefV0(approved),
      objectRef: toUpgradeRunRefV0(approved),
      details: { transitionKey: "approve-1" },
    }));
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "conflicting_terminal_outcome_rejected",
      workspaceId: completed.workspaceId,
      planId: completed.planId,
      upgradeRunId: completed.id,
      occurredAt: "2026-04-30T00:07:00.000Z",
      actorId: "operator-1",
      subjectRef: toUpgradeRunRefV0(completed),
      objectRef: toUpgradeRunRefV0(completed),
      details: { terminalStatus: completed.status, rejectedStatus: "failed" },
    }));

    expect((await store.listEvents()).map((event) => event.eventType)).toEqual([
      "idempotent_replay_reused",
      "conflicting_terminal_outcome_rejected",
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
    status: "planned",
    approvalRefs: ["approval:upgrade-1"],
    backupRefs: ["backup:manifest-1"],
    healthRefs: [],
    rollbackRefs: ["rollback:playbook-1"],
    evidenceRefs: ["evidence:ticket-1"],
    lastTransitionAt: "2026-04-30T00:00:00.000Z",
    lastTransitionKey: null,
    startedAt: null,
    finishedAt: null,
    failureReason: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
  };
}
