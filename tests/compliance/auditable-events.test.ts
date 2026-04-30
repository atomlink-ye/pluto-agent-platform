import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComplianceStore } from "@/compliance/compliance-store.js";
import { recordPrivilegedLifecycleEvent } from "@/compliance/events.js";

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-compliance-events-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("compliance auditable events", () => {
  it("emits durable privileged lifecycle events for install, activate, revoke, approval, and decision actions", async () => {
    const store = new ComplianceStore({ dataDir: join(workDir, ".pluto") });

    const actions = [
      {
        eventId: "event-install-1",
        action: "install",
        beforeStatus: null,
        afterStatus: "draft",
        sourceRef: "policy-1",
      },
      {
        eventId: "event-activate-1",
        action: "activate",
        beforeStatus: "draft",
        afterStatus: "active",
        sourceRef: "policy-1",
      },
      {
        eventId: "event-revoke-1",
        action: "revoke",
        beforeStatus: "active",
        afterStatus: "revoked",
        sourceRef: "hold-1",
      },
      {
        eventId: "event-approval-1",
        action: "approval",
        beforeStatus: "under_review",
        afterStatus: "approved",
        sourceRef: "manifest-1",
      },
      {
        eventId: "event-decision-1",
        action: "decision",
        beforeStatus: "under_review",
        afterStatus: "blocked",
        sourceRef: "delete-1",
      },
    ] as const;

    for (const entry of actions) {
      await recordPrivilegedLifecycleEvent(store, {
        ...entry,
        actorId: "compliance-officer-1",
        roleLabels: ["compliance", "approver", "compliance"],
        target: {
          kind: entry.action === "decision" ? "deletion_attempt" : "retention_policy",
          recordId: entry.sourceRef,
          workspaceId: "workspace-1",
          summary: `Target for ${entry.action}`,
        },
        createdAt: `2026-04-30T00:0${actions.indexOf(entry)}:00.000Z`,
        sourceCommand: "compliance.events.test",
        evidenceRefs: ["sealed:evidence-1", "sealed:evidence-1"],
        reason: entry.action === "decision" ? "Deletion remains blocked by active hold." : null,
      });
    }

    const events = await store.listEvents({ actorId: "compliance-officer-1" });

    expect(events).toHaveLength(5);
    expect(events.map((event) => event.action)).toEqual([
      "install",
      "activate",
      "revoke",
      "approval",
      "decision",
    ]);
    expect(events.map((event) => event.eventType)).toEqual([
      "compliance.install",
      "compliance.activate",
      "compliance.revoke",
      "compliance.approval",
      "compliance.decision",
    ]);
    expect(events[0]?.actor.roleLabels).toEqual(["compliance", "approver"]);
    expect(events[4]).toMatchObject({
      action: "decision",
      reason: "Deletion remains blocked by active hold.",
      source: {
        command: "compliance.events.test",
        ref: "delete-1",
      },
      status: {
        before: "under_review",
        after: "blocked",
      },
      evidenceRefs: ["sealed:evidence-1"],
    });
  });
});
