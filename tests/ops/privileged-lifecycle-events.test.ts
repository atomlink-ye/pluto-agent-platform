import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createUpgradeLocalEventV0,
  toUpgradePlanRefV0,
  UpgradeStore,
} from "@/index.js";

describe("privileged lifecycle events", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists install, activate, revoke, approval, decision, execution, phase, and completion event vocabulary locally", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-upgrade-events-"));
    const store = new UpgradeStore({ dataDir });
    const plan = basePlan();
    const planRef = toUpgradePlanRefV0(plan);

    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "install_recorded",
      workspaceId: plan.workspaceId,
      planId: plan.id,
      occurredAt: "2026-04-30T00:00:01.000Z",
      actorId: "operator-1",
      subjectRef: planRef,
      objectRef: planRef,
    }));
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "activation_recorded",
      workspaceId: plan.workspaceId,
      planId: plan.id,
      occurredAt: "2026-04-30T00:00:02.000Z",
      actorId: "operator-1",
      subjectRef: planRef,
      objectRef: planRef,
    }));
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "revocation_recorded",
      workspaceId: plan.workspaceId,
      planId: plan.id,
      occurredAt: "2026-04-30T00:00:03.000Z",
      actorId: "operator-1",
      subjectRef: planRef,
      objectRef: planRef,
    }));
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "approval_recorded",
      workspaceId: plan.workspaceId,
      planId: plan.id,
      occurredAt: "2026-04-30T00:00:04.000Z",
      actorId: "operator-1",
      subjectRef: planRef,
      objectRef: planRef,
      evidenceRefs: ["approval:upgrade-1"],
    }));
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "decision_recorded",
      workspaceId: plan.workspaceId,
      planId: plan.id,
      occurredAt: "2026-04-30T00:00:05.000Z",
      actorId: "operator-1",
      subjectRef: planRef,
      objectRef: planRef,
      details: { decision: "executable" },
    }));
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "execution_started",
      workspaceId: plan.workspaceId,
      planId: plan.id,
      occurredAt: "2026-04-30T00:00:06.000Z",
      actorId: "operator-1",
      subjectRef: planRef,
      objectRef: planRef,
    }));
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "phase_transition_recorded",
      workspaceId: plan.workspaceId,
      planId: plan.id,
      occurredAt: "2026-04-30T00:00:07.000Z",
      actorId: "operator-1",
      subjectRef: planRef,
      objectRef: planRef,
      details: { fromStatus: "approved", toStatus: "running" },
    }));
    await store.appendEvent(createUpgradeLocalEventV0({
      eventType: "completion_recorded",
      workspaceId: plan.workspaceId,
      planId: plan.id,
      occurredAt: "2026-04-30T00:00:08.000Z",
      actorId: "operator-1",
      subjectRef: planRef,
      objectRef: planRef,
    }));

    expect((await store.listEvents()).map((event) => event.eventType)).toEqual([
      "install_recorded",
      "activation_recorded",
      "revocation_recorded",
      "approval_recorded",
      "decision_recorded",
      "execution_started",
      "phase_transition_recorded",
      "completion_recorded",
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
