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

describe("sample install", () => {
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "pluto-sample-install-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("installs and activates the curated local-v0 sample with seeded asset refs", async () => {
    const bootstrapStore = new BootstrapStore({ dataDir: workDir });
    const catalogStore = new CatalogStore({ dataDir: workDir });
    const governanceStore = new GovernanceStore({ dataDir: workDir });
    const securityStore = new SecurityStore({ dataDir: workDir });
    const service = new SampleInstallService({ dataDir: workDir, bootstrapStore, catalogStore, governanceStore, securityStore });

    await seedCatalog(catalogStore);
    await seedDefaultGovernanceFixtures(governanceStore, { workspaceId: workspaceRef.workspaceId, ownerId: actorRef.principalId });
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
    await bootstrapStore.putSession(makeSession());
    await bootstrapStore.putStep(makeStep());

    const result = await service.installCuratedSampleWorkflow({
      workspaceRef,
      actorRefs: [actorRef],
      sessionId: "session-1",
      stepId: "step-sample-install",
      availableCapabilities: ["local-repo-read", "workspace-write"],
      now: "2026-04-30T00:01:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected install to succeed");
    }

    expect(result.decision).toBe("installed");
    expect(result.record.lifecycleStatus).toBe("active");
    expect(result.record.definition).toEqual(CURATED_SAMPLE_WORKFLOW_V0);
    expect(result.record.definition.expectedArtifacts.map((artifact) => artifact.artifactType)).toEqual([
      "report",
      "plan",
      "patch",
      "checklist",
    ]);
    expect(result.record.definition.evidenceContractRefs).toContain("catalog:skills/lead-orchestrate@0.0.1#evidenceContract");
    expect(result.auditEvents.map((event) => event.eventType)).toEqual([
      "bootstrap_sample_install_recorded",
      "bootstrap_sample_activation_recorded",
    ]);

    const stored = await service.getInstalledSample(workspaceRef.workspaceId);
    expect(stored).toEqual(result.record);

    const step = await bootstrapStore.getStep(workspaceRef.workspaceId, "session-1", "step-sample-install");
    const session = await bootstrapStore.getSession(workspaceRef.workspaceId, "session-1");
    expect(step?.status).toBe("succeeded");
    expect(session?.status).toBe("succeeded");
    expect(step?.createdObjectRefs[0]?.objectRef.kind).toBe("sample_workflow");
    expect(step?.createdObjectRefs[0]?.objectRef.id).toBe(CURATED_SAMPLE_WORKFLOW_V0.sampleId);
    expect(await bootstrapStore.listFailures(workspaceRef.workspaceId, "session-1")).toEqual([]);
  });
});

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
