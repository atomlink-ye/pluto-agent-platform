import { describe, expect, it } from "vitest";

import {
  parseBootstrapFailureStatusV0,
  validateBootstrapChecklistV0,
  validateBootstrapFailureV0,
  validateBootstrapObjectRefV0,
  validateBootstrapSessionV0,
  validateBootstrapStepV0,
} from "@/bootstrap/contracts.js";

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

const objectRef = {
  schema: "pluto.bootstrap.object-ref" as const,
  schemaVersion: 0 as const,
  id: "bootstrap-object-1",
  workspaceRef,
  objectRef: {
    workspaceId: "workspace-1",
    kind: "document",
    id: "doc-1",
  },
  objectType: "document",
  status: "active",
  actorRefs: [actorRef],
  summary: "Draft document created by the bootstrap flow.",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:10.000Z",
};

describe("bootstrap contracts", () => {
  it("accepts additive object ref fields while enforcing the required shape", () => {
    expect(validateBootstrapObjectRefV0({
      ...objectRef,
      futureField: { additive: true },
    }).ok).toBe(true);
  });

  it("validates session, step, failure, and checklist records", () => {
    const session = {
      schema: "pluto.bootstrap.session" as const,
      schemaVersion: 0 as const,
      id: "bootstrap-session-1",
      workspaceRef,
      actorRefs: [actorRef],
      status: "future_status",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:20.000Z",
      startedAt: "2026-04-30T00:00:01.000Z",
      finishedAt: null,
      blockingReason: null,
      resolutionHint: null,
      stepIds: ["bootstrap-step-1"],
      createdObjectRefs: [objectRef],
    };
    const step = {
      schema: "pluto.bootstrap.step" as const,
      schemaVersion: 0 as const,
      id: "bootstrap-step-1",
      sessionId: session.id,
      stableKey: "seed-document",
      title: "Seed the first document",
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
      createdObjectRefs: [objectRef],
    };
    const failure = {
      schema: "pluto.bootstrap.failure" as const,
      schemaVersion: 0 as const,
      id: "bootstrap-failure-1",
      sessionId: session.id,
      stepId: step.id,
      workspaceRef,
      actorRefs: [actorRef],
      status: "active",
      blockingReason: "credential_missing",
      resolutionHint: "Connect the workspace credential before retrying.",
      createdObjectRefs: [objectRef],
      createdAt: "2026-04-30T00:00:11.000Z",
      updatedAt: "2026-04-30T00:00:12.000Z",
      resolvedAt: null,
    };
    const checklist = {
      schema: "pluto.bootstrap.checklist" as const,
      schemaVersion: 0 as const,
      id: `${session.id}:checklist`,
      sessionId: session.id,
      workspaceRef,
      actorRefs: [actorRef],
      status: "running",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      blockingReason: null,
      resolutionHint: null,
      totalStepCount: 1,
      completedStepCount: 1,
      createdObjectRefs: [objectRef],
      items: [{
        stepId: step.id,
        stableKey: step.stableKey,
        title: step.title,
        status: "succeeded",
        blockingReason: null,
        resolutionHint: null,
        dependsOnStepIds: [],
        createdObjectRefs: [objectRef],
      }],
    };

    expect(validateBootstrapSessionV0(session).ok).toBe(true);
    expect(validateBootstrapStepV0(step).ok).toBe(true);
    expect(validateBootstrapFailureV0(failure).ok).toBe(true);
    expect(validateBootstrapChecklistV0(checklist).ok).toBe(true);
    expect(parseBootstrapFailureStatusV0("future_failure_state")).toBe("future_failure_state");
  });

  it("rejects records that omit required arrays", () => {
    const result = validateBootstrapSessionV0({
      schema: "pluto.bootstrap.session",
      schemaVersion: 0,
      id: "bootstrap-session-bad",
      workspaceRef,
      actorRefs: [actorRef],
      status: "running",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:20.000Z",
      startedAt: null,
      finishedAt: null,
      blockingReason: null,
      resolutionHint: null,
      stepIds: "not-an-array",
      createdObjectRefs: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("stepIds must be an array");
    }
  });
});
