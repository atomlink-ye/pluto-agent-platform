import { describe, expect, it } from "vitest";

import { projectBootstrapChecklistV0 } from "@/bootstrap/checklist.js";

const workspaceRef = {
  workspaceId: "workspace-1",
  kind: "workspace",
  id: "workspace-1",
} as const;

const actorRef = {
  workspaceId: "workspace-1",
  kind: "user",
  principalId: "user-1",
} as const;

const docRef = {
  schema: "pluto.bootstrap.object-ref" as const,
  schemaVersion: 0 as const,
  id: "bootstrap-object-doc",
  workspaceRef,
  objectRef: {
    workspaceId: "workspace-1",
    kind: "document",
    id: "doc-1",
  },
  objectType: "document",
  status: "active",
  actorRefs: [actorRef],
  summary: "Seed document",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:10.000Z",
};

const reviewRef = {
  schema: "pluto.bootstrap.object-ref" as const,
  schemaVersion: 0 as const,
  id: "bootstrap-object-review",
  workspaceRef,
  objectRef: {
    workspaceId: "workspace-1",
    kind: "review",
    id: "review-1",
  },
  objectType: "review",
  status: "queued",
  actorRefs: [actorRef],
  summary: "Review request created",
  createdAt: "2026-04-30T00:00:11.000Z",
  updatedAt: "2026-04-30T00:00:12.000Z",
};

describe("bootstrap checklist projection", () => {
  it("projects checklist state from session and step records", () => {
    const session = {
      schema: "pluto.bootstrap.session" as const,
      schemaVersion: 0 as const,
      id: "bootstrap-session-1",
      workspaceRef,
      actorRefs: [actorRef],
      status: "running",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:20.000Z",
      startedAt: "2026-04-30T00:00:01.000Z",
      finishedAt: null,
      blockingReason: null,
      resolutionHint: null,
      stepIds: ["step-seed", "step-review", "step-publish"],
      createdObjectRefs: [docRef],
    };
    const steps = [
      {
        schema: "pluto.bootstrap.step" as const,
        schemaVersion: 0 as const,
        id: "step-publish",
        sessionId: session.id,
        stableKey: "publish",
        title: "Publish package",
        workspaceRef,
        actorRefs: [actorRef],
        status: "blocked",
        createdAt: "2026-04-30T00:00:20.000Z",
        updatedAt: "2026-04-30T00:00:30.000Z",
        startedAt: "2026-04-30T00:00:20.000Z",
        finishedAt: null,
        blockingReason: "credential_missing",
        resolutionHint: "Connect publish credentials.",
        dependsOnStepIds: ["step-review"],
        createdObjectRefs: [],
      },
      {
        schema: "pluto.bootstrap.step" as const,
        schemaVersion: 0 as const,
        id: "step-seed",
        sessionId: session.id,
        stableKey: "seed-document",
        title: "Seed document",
        workspaceRef,
        actorRefs: [actorRef],
        status: "done",
        createdAt: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:10.000Z",
        startedAt: "2026-04-30T00:00:02.000Z",
        finishedAt: "2026-04-30T00:00:10.000Z",
        blockingReason: null,
        resolutionHint: null,
        dependsOnStepIds: [],
        createdObjectRefs: [docRef],
      },
      {
        schema: "pluto.bootstrap.step" as const,
        schemaVersion: 0 as const,
        id: "step-review",
        sessionId: session.id,
        stableKey: "request-review",
        title: "Request review",
        workspaceRef,
        actorRefs: [actorRef],
        status: "succeeded",
        createdAt: "2026-04-30T00:00:11.000Z",
        updatedAt: "2026-04-30T00:00:15.000Z",
        startedAt: "2026-04-30T00:00:11.000Z",
        finishedAt: "2026-04-30T00:00:15.000Z",
        blockingReason: null,
        resolutionHint: null,
        dependsOnStepIds: ["step-seed"],
        createdObjectRefs: [reviewRef, docRef],
      },
    ];

    const checklist = projectBootstrapChecklistV0({ session, steps });

    expect(checklist).toMatchObject({
      schema: "pluto.bootstrap.checklist",
      schemaVersion: 0,
      id: "bootstrap-session-1:checklist",
      sessionId: session.id,
      status: "blocked",
      totalStepCount: 3,
      completedStepCount: 2,
      blockingReason: "credential_missing",
      resolutionHint: "Connect publish credentials.",
      createdAt: session.createdAt,
      updatedAt: "2026-04-30T00:00:30.000Z",
    });
    expect(checklist.items.map((item) => item.stepId)).toEqual([
      "step-seed",
      "step-review",
      "step-publish",
    ]);
    expect(checklist.items.map((item) => item.status)).toEqual([
      "succeeded",
      "succeeded",
      "blocked",
    ]);
    expect(checklist.createdObjectRefs.map((item) => item.id)).toEqual([
      "bootstrap-object-doc",
      "bootstrap-object-review",
    ]);
  });

  it("marks the checklist succeeded when every step is complete even for legacy done session status", () => {
    const session = {
      schema: "pluto.bootstrap.session" as const,
      schemaVersion: 0 as const,
      id: "bootstrap-session-2",
      workspaceRef,
      actorRefs: [actorRef],
      status: "done",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:05.000Z",
      startedAt: "2026-04-30T00:00:01.000Z",
      finishedAt: "2026-04-30T00:00:05.000Z",
      blockingReason: null,
      resolutionHint: null,
      stepIds: ["step-seed"],
      createdObjectRefs: [docRef],
    };
    const steps = [{
      schema: "pluto.bootstrap.step" as const,
      schemaVersion: 0 as const,
      id: "step-seed",
      sessionId: session.id,
      stableKey: "seed-document",
      title: "Seed document",
      workspaceRef,
      actorRefs: [actorRef],
      status: "done",
      createdAt: "2026-04-30T00:00:02.000Z",
      updatedAt: "2026-04-30T00:00:05.000Z",
      startedAt: "2026-04-30T00:00:02.000Z",
      finishedAt: "2026-04-30T00:00:05.000Z",
      blockingReason: null,
      resolutionHint: null,
      dependsOnStepIds: [],
      createdObjectRefs: [docRef],
    }];

    const checklist = projectBootstrapChecklistV0({ session, steps });

    expect(checklist.status).toBe("succeeded");
    expect(checklist.completedStepCount).toBe(1);
  });
});
