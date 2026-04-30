import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BootstrapFailureV0, BootstrapSessionV0, BootstrapStepV0 } from "@/bootstrap/index.js";
import { BootstrapStore } from "@/bootstrap/index.js";

let workDir: string;

const workspaceRef = {
  workspaceId: "workspace-1",
  kind: "workspace",
  id: "workspace-1",
} as const;

const otherWorkspaceRef = {
  workspaceId: "workspace-2",
  kind: "workspace",
  id: "workspace-2",
} as const;

const actorRef = {
  workspaceId: "workspace-1",
  kind: "user",
  principalId: "user-1",
} as const;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-bootstrap-boundary-test-"));
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
    status: "pending",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    startedAt: null,
    finishedAt: null,
    blockingReason: null,
    resolutionHint: null,
    stepIds: ["step-1"],
    createdObjectRefs: [],
    ...overrides,
  };
}

function makeStep(overrides: Partial<BootstrapStepV0> = {}): BootstrapStepV0 {
  return {
    schema: "pluto.bootstrap.step",
    schemaVersion: 0,
    id: "step-1",
    sessionId: "bootstrap-session-1",
    stableKey: "seed-document",
    title: "Seed document",
    workspaceRef,
    actorRefs: [actorRef],
    status: "pending",
    createdAt: "2026-04-30T00:00:02.000Z",
    updatedAt: "2026-04-30T00:00:03.000Z",
    startedAt: null,
    finishedAt: null,
    blockingReason: null,
    resolutionHint: null,
    dependsOnStepIds: [],
    createdObjectRefs: [],
    ...overrides,
  };
}

function makeFailure(overrides: Partial<BootstrapFailureV0> = {}): BootstrapFailureV0 {
  return {
    schema: "pluto.bootstrap.failure",
    schemaVersion: 0,
    id: "failure-1",
    sessionId: "bootstrap-session-1",
    stepId: "step-1",
    workspaceRef,
    actorRefs: [actorRef],
    status: "active",
    blockingReason: "runtime_timeout",
    resolutionHint: "Retry after reconnecting the worker.",
    createdObjectRefs: [],
    createdAt: "2026-04-30T00:00:04.000Z",
    updatedAt: "2026-04-30T00:00:05.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

describe("BootstrapStore boundaries", () => {
  it("fails closed when a step is written before its session exists", async () => {
    const store = new BootstrapStore({ dataDir: join(workDir, ".pluto") });

    await expect(store.putStep(makeStep())).rejects.toThrow("Bootstrap session not found");
  });

  it("scopes records by workspace and keeps missing reads null", async () => {
    const store = new BootstrapStore({ dataDir: join(workDir, ".pluto") });

    await store.putSession(makeSession());
    await store.putSession(makeSession({ id: "bootstrap-session-2", workspaceRef: otherWorkspaceRef, stepIds: [] }));

    expect(await store.listSessions("workspace-1")).toEqual([makeSession()]);
    expect(await store.listSessions("workspace-2")).toEqual([
      makeSession({ id: "bootstrap-session-2", workspaceRef: otherWorkspaceRef, stepIds: [] }),
    ]);
    await expect(store.getChecklist("workspace-2", "bootstrap-session-1")).resolves.toBeNull();
    await expect(store.getFailure("workspace-1", "bootstrap-session-1", "missing")).resolves.toBeNull();
  });

  it("requires failures to stay within the same session step boundary", async () => {
    const store = new BootstrapStore({ dataDir: join(workDir, ".pluto") });

    await store.putSession(makeSession());
    await store.putSession(makeSession({ id: "bootstrap-session-2", stepIds: ["step-2"] }));
    await store.putStep(makeStep());

    await expect(
      store.putFailure(makeFailure({ sessionId: "bootstrap-session-2", stepId: "step-1" })),
    ).rejects.toThrow("Bootstrap step not found");
  });
});
