import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BootstrapFailureV0, BootstrapSessionV0, BootstrapStepV0 } from "@/bootstrap/index.js";
import { BootstrapStore, projectBootstrapChecklistV0 } from "@/bootstrap/index.js";

let workDir: string;

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

const documentObjectRef = {
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
  status: "succeeded",
  actorRefs: [actorRef],
  summary: "Seed document",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:10.000Z",
};

const reviewObjectRef = {
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

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-bootstrap-store-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeSession(overrides: Partial<BootstrapSessionV0> = {}): BootstrapSessionV0 {
  return {
    schema: "pluto.bootstrap.session",
    schemaVersion: 0,
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
    stepIds: ["step-seed", "step-review"],
    createdObjectRefs: [documentObjectRef],
    ...overrides,
  };
}

function makeStep(overrides: Partial<BootstrapStepV0> = {}): BootstrapStepV0 {
  return {
    schema: "pluto.bootstrap.step",
    schemaVersion: 0,
    id: "step-seed",
    sessionId: "bootstrap-session-1",
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
    createdObjectRefs: [documentObjectRef],
    ...overrides,
  };
}

function makeFailure(overrides: Partial<BootstrapFailureV0> = {}): BootstrapFailureV0 {
  return {
    schema: "pluto.bootstrap.failure",
    schemaVersion: 0,
    id: "failure-1",
    sessionId: "bootstrap-session-1",
    stepId: "step-review",
    workspaceRef,
    actorRefs: [actorRef],
    status: "active",
    blockingReason: "credential_missing",
    resolutionHint: "Connect publish credentials.",
    createdObjectRefs: [reviewObjectRef],
    createdAt: "2026-04-30T00:00:11.000Z",
    updatedAt: "2026-04-30T00:00:12.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

describe("BootstrapStore", () => {
  it("round-trips canonical bootstrap records and derives the checklist without leaking paths", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new BootstrapStore({ dataDir });
    const session = makeSession();
    const stepSeed = makeStep();
    const stepReview = makeStep({
      id: "step-review",
      stableKey: "request-review",
      title: "Request review",
      status: "blocked",
      createdAt: "2026-04-30T00:00:11.000Z",
      updatedAt: "2026-04-30T00:00:15.000Z",
      startedAt: "2026-04-30T00:00:11.000Z",
      finishedAt: null,
      blockingReason: "credential_missing",
      resolutionHint: "Connect publish credentials.",
      dependsOnStepIds: ["step-seed"],
      createdObjectRefs: [reviewObjectRef, documentObjectRef],
    });
    const failure = makeFailure();

    expect(await store.putSession(session)).toEqual(session);
    expect(await store.putStep(stepSeed)).toEqual(stepSeed);
    expect(await store.putStep(stepReview)).toEqual(stepReview);
    expect(await store.putFailure(failure)).toEqual(failure);

    expect(await store.getSession(workspaceRef.workspaceId, session.id)).toEqual(session);
    expect(await store.getStep(workspaceRef.workspaceId, session.id, stepSeed.id)).toEqual(stepSeed);
    expect(await store.getFailure(workspaceRef.workspaceId, session.id, failure.id)).toEqual(failure);
    expect(await store.listSessions(workspaceRef.workspaceId)).toEqual([session]);
    expect(await store.listSteps(workspaceRef.workspaceId, session.id)).toEqual([stepReview, stepSeed]);
    expect(await store.listFailures(workspaceRef.workspaceId, session.id)).toEqual([failure]);

    const checklist = await store.getChecklist(workspaceRef.workspaceId, session.id);
    expect(checklist).toEqual(projectBootstrapChecklistV0({ session, steps: [stepReview, stepSeed] }));
    expect(JSON.stringify(checklist)).not.toContain(dataDir);
    expect(JSON.stringify(checklist)).not.toContain(".json");

    const persistedSession = await readFile(
      join(dataDir, "bootstrap", "workspace-1", "sessions", "bootstrap-session-1", "session.json"),
      "utf8",
    );
    const persistedStep = await readFile(
      join(dataDir, "bootstrap", "workspace-1", "sessions", "bootstrap-session-1", "steps", "step-seed.json"),
      "utf8",
    );
    const persistedFailure = await readFile(
      join(dataDir, "bootstrap", "workspace-1", "sessions", "bootstrap-session-1", "failures", "failure-1.json"),
      "utf8",
    );

    expect(JSON.parse(persistedSession)).toEqual(session);
    expect(JSON.parse(persistedStep)).toEqual(stepSeed);
    expect(JSON.parse(persistedFailure)).toEqual(failure);
  });
});
