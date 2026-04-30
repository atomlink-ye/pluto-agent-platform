import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BootstrapStore, CURATED_SAMPLE_WORKFLOW_V0, SampleInstallService } from "@/bootstrap/index.js";
import { CatalogStore } from "@/catalog/catalog-store.js";
import { getCuratedDefaultCatalogSeed } from "@/catalog/seed.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import { seedDefaultGovernanceFixtures } from "@/governance/seed.js";
import { SecurityStore } from "@/security/security-store.js";

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

describe("sample capability gate", () => {
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "pluto-sample-gate-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("fails closed when a required capability is unavailable", async () => {
    const context = await createContext({ withSecret: true });

    const result = await context.service.installCuratedSampleWorkflow({
      workspaceRef,
      actorRefs: [actorRef],
      sessionId: "session-1",
      stepId: "step-sample-install",
      availableCapabilities: ["local-repo-read"],
      now: "2026-04-30T00:02:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected capability gate to fail");
    }

    expect(result.failure.blockingReason).toBe("unsupported_capability");
    expect(result.failure.resolutionHint).toContain("workspace-write");
    await expectBlockedState(context.bootstrapStore, result.failure);
  });

  it("fails closed for a retired sample definition", async () => {
    const context = await createContext({ withSecret: true });

    const result = await context.service.installCuratedSampleWorkflow({
      workspaceRef,
      actorRefs: [actorRef],
      sessionId: "session-1",
      stepId: "step-sample-install",
      availableCapabilities: ["local-repo-read", "workspace-write"],
      sample: { ...CURATED_SAMPLE_WORKFLOW_V0, status: "retired" },
      now: "2026-04-30T00:03:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected retired sample to fail");
    }

    expect(result.failure.blockingReason).toBe("sample_retired");
    expect(result.failure.resolutionHint).toContain("active curated sample");
    await expectBlockedState(context.bootstrapStore, result.failure);
  });

  it("fails closed when policy blocks activation", async () => {
    const context = await createContext({ withSecret: true });

    const result = await context.service.installCuratedSampleWorkflow({
      workspaceRef,
      actorRefs: [actorRef],
      sessionId: "session-1",
      stepId: "step-sample-install",
      availableCapabilities: ["local-repo-read", "workspace-write"],
      policyBlocks: [{ reason: "approval_missing", resolutionHint: "Record the operator approval before activating the sample." }],
      now: "2026-04-30T00:04:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected policy block to fail");
    }

    expect(result.failure.blockingReason).toBe("policy_blocked");
    expect(result.failure.resolutionHint).toBe("Record the operator approval before activating the sample.");
    await expectBlockedState(context.bootstrapStore, result.failure);
  });

  it("fails closed when required secret refs are missing", async () => {
    const context = await createContext({ withSecret: false });

    const result = await context.service.installCuratedSampleWorkflow({
      workspaceRef,
      actorRefs: [actorRef],
      sessionId: "session-1",
      stepId: "step-sample-install",
      availableCapabilities: ["local-repo-read", "workspace-write"],
      now: "2026-04-30T00:05:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected secret ref gate to fail");
    }

    expect(result.failure.blockingReason).toBe("missing_secret_ref");
    expect(result.failure.resolutionHint).toContain("OPENCODE_API_KEY");
    await expectBlockedState(context.bootstrapStore, result.failure);
  });

  it("fails closed for an invalid sample definition", async () => {
    const context = await createContext({ withSecret: true });

    const result = await context.service.installCuratedSampleWorkflow({
      workspaceRef,
      actorRefs: [actorRef],
      sessionId: "session-1",
      stepId: "step-sample-install",
      availableCapabilities: ["local-repo-read", "workspace-write"],
      sample: {
        ...CURATED_SAMPLE_WORKFLOW_V0,
        templateRef: { id: "missing-template", version: "0.0.1" },
      },
      now: "2026-04-30T00:06:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected invalid sample to fail");
    }

    expect(result.failure.blockingReason).toBe("sample_invalid");
    expect(result.failure.resolutionHint).toContain("curated catalog assets");
    await expectBlockedState(context.bootstrapStore, result.failure);
  });
});

async function createContext(input: { withSecret: boolean }) {
  const bootstrapStore = new BootstrapStore({ dataDir: workDir });
  const catalogStore = new CatalogStore({ dataDir: workDir });
  const governanceStore = new GovernanceStore({ dataDir: workDir });
  const securityStore = new SecurityStore({ dataDir: workDir });
  const service = new SampleInstallService({ dataDir: workDir, bootstrapStore, catalogStore, governanceStore, securityStore });

  await seedCatalog(catalogStore);
  await seedDefaultGovernanceFixtures(governanceStore, { workspaceId: workspaceRef.workspaceId, ownerId: actorRef.principalId });
  if (input.withSecret) {
    await securityStore.putSecretRef({
      schemaVersion: 0,
      kind: "secret_ref",
      workspaceId: workspaceRef.workspaceId,
      name: "OPENCODE_API_KEY",
      ref: "opencode://secrets/OPENCODE_API_KEY",
      displayLabel: "OpenCode API key",
      status: "active",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:00.000Z",
      actorRefs: [actorRef],
      providerType: "local_v0",
    });
  }
  await bootstrapStore.putSession(makeSession());
  await bootstrapStore.putStep(makeStep());

  return { bootstrapStore, service };
}

async function expectBlockedState(bootstrapStore: BootstrapStore, failure: { blockingReason: string; resolutionHint: string | null }) {
  const session = await bootstrapStore.getSession(workspaceRef.workspaceId, "session-1");
  const step = await bootstrapStore.getStep(workspaceRef.workspaceId, "session-1", "step-sample-install");
  const failures = await bootstrapStore.listFailures(workspaceRef.workspaceId, "session-1");

  expect(session?.status).toBe("blocked");
  expect(step?.status).toBe("blocked");
  expect(step?.blockingReason).toBe(failure.blockingReason);
  expect(step?.resolutionHint).toBe(failure.resolutionHint);
  expect(failures).toHaveLength(1);
  expect(failures[0]?.blockingReason).toBe(failure.blockingReason);
}

function makeSession() {
  return {
    schema: "pluto.bootstrap.session" as const,
    schemaVersion: 0 as const,
    id: "session-1",
    workspaceRef,
    actorRefs: [actorRef],
    status: "running",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: null,
    blockingReason: null,
    resolutionHint: null,
    stepIds: ["step-sample-install"],
    createdObjectRefs: [],
  };
}

function makeStep() {
  return {
    schema: "pluto.bootstrap.step" as const,
    schemaVersion: 0 as const,
    id: "step-sample-install",
    sessionId: "session-1",
    stableKey: "install-curated-sample",
    title: "Install curated sample",
    workspaceRef,
    actorRefs: [actorRef],
    status: "running",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: null,
    blockingReason: null,
    resolutionHint: null,
    dependsOnStepIds: [],
    createdObjectRefs: [],
  };
}

async function seedCatalog(store: CatalogStore): Promise<void> {
  const seed = getCuratedDefaultCatalogSeed();
  for (const role of seed.workerRoles) {
    await store.upsert("roles", role.id, role);
  }
  for (const skill of seed.skills) {
    await store.upsert("skills", skill.id, skill);
  }
  for (const template of seed.templates) {
    await store.upsert("templates", template.id, template);
  }
  for (const policyPack of seed.policyPacks) {
    await store.upsert("policy-packs", policyPack.id, policyPack);
  }
  for (const entry of seed.entries) {
    await store.upsert("entries", entry.id, entry);
  }
}
