import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import { BootstrapStore, SampleInstallService } from "@/bootstrap/index.js";
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

describe("sample audit", () => {
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "pluto-sample-audit-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("emits privileged install, activate, and revoke audit events", async () => {
    const bootstrapStore = new BootstrapStore({ dataDir: workDir });
    const catalogStore = new CatalogStore({ dataDir: workDir });
    const governanceStore = new GovernanceStore({ dataDir: workDir });
    const securityStore = new SecurityStore({ dataDir: workDir });
    const auditStore = new GovernanceEventStore({ dataDir: workDir });
    const service = new SampleInstallService({
      dataDir: workDir,
      bootstrapStore,
      catalogStore,
      governanceStore,
      securityStore,
      auditStore,
    });

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

    const install = await service.installCuratedSampleWorkflow({
      workspaceRef,
      actorRefs: [actorRef],
      sessionId: "session-1",
      stepId: "step-sample-install",
      availableCapabilities: ["local-repo-read", "workspace-write"],
      now: "2026-04-30T00:01:00.000Z",
      sourceCommand: "bootstrap.install",
    });
    expect(install.ok).toBe(true);

    const revoke = await service.revokeCuratedSampleWorkflow({
      workspaceRef,
      actorRefs: [actorRef],
      sessionId: "session-1",
      stepId: "step-sample-install",
      now: "2026-04-30T00:02:00.000Z",
      sourceCommand: "bootstrap.revoke",
      reason: "Operator revoked the sample lifecycle decision.",
    });
    expect(revoke.ok).toBe(true);
    if (!revoke.ok) {
      throw new Error("expected revoke to succeed");
    }

    const events = await auditStore.list({ targetKind: "bootstrap_sample" });
    expect(events.map((event) => event.eventType)).toEqual([
      "bootstrap_sample_install_recorded",
      "bootstrap_sample_activation_recorded",
      "bootstrap_sample_revocation_recorded",
    ]);
    expect(events.map((event) => event.actor.principalId)).toEqual(["user-1", "user-1", "user-1"]);
    expect(events.map((event) => event.target.recordId)).toEqual([
      "sample-curated-default-workflow",
      "sample-curated-default-workflow",
      "sample-curated-default-workflow",
    ]);
    expect(events.map((event) => event.source.command)).toEqual([
      "bootstrap.install",
      "bootstrap.install",
      "bootstrap.revoke",
    ]);
    expect(revoke.record.lifecycleStatus).toBe("revoked");
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
