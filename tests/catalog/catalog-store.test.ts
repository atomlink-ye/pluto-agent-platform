import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  PolicyPackV0,
  SkillCatalogEntryV0,
  SkillDefinitionV0,
  TemplateV0,
  WorkerRoleV0,
} from "@/catalog/contracts.js";
import { CatalogStore } from "@/catalog/catalog-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-catalog-store-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeWorkerRole(): WorkerRoleV0 {
  return {
    schema: "pluto.catalog.worker-role",
    schemaVersion: 0,
    id: "generator",
    version: "0.0.1",
    status: "active",
    name: "Generator",
    responsibility: "Draft the implementation artifact.",
    systemPrompt: "Generate the requested artifact using repo context.",
    allowedSkills: [{ id: "repo-synthesis", version: "0.0.1" }],
    expectedEvidence: {
      artifactType: "patch",
      requiredFields: ["summary", "filesChanged", "verification"],
      citationPolicy: "local-only",
      retention: "durable",
    },
    versionMetadata: {
      channel: "stable",
      revision: 1,
      updatedAt: "2026-04-30T00:00:00Z",
    },
    labels: ["delivery", "codegen"],
    metadata: { owner: "pluto" },
  };
}

function makeSkill(): SkillDefinitionV0 {
  return {
    schema: "pluto.catalog.skill-definition",
    schemaVersion: 0,
    id: "repo-synthesis",
    version: "0.0.1",
    status: "active",
    name: "Repo synthesis",
    summary: "Summarize local repository context before acting.",
    instructions: "Inspect relevant files before writing code.",
    requiredCapabilities: ["repo-read", "code-synthesis"],
    toolRequirements: ["glob", "grep", "read"],
    secretRefs: ["runtime/github-token"],
    safetyNotes: ["Do not infer missing repository state.", "Never expose secrets."],
    evidenceContract: {
      artifactType: "report",
      requiredFields: ["filesInspected", "findings"],
      citationPolicy: "local-only",
      retention: "session",
    },
    versionMetadata: {
      channel: "stable",
      revision: 3,
      updatedAt: "2026-04-30T00:00:00Z",
      supersedesVersion: "0.0.0",
    },
    labels: ["analysis"],
    metadata: { lane: "r1" },
  };
}

function makeTemplate(): TemplateV0 {
  return {
    schema: "pluto.catalog.template",
    schemaVersion: 0,
    id: "artifact-template",
    version: "0.0.1",
    status: "active",
    name: "Artifact template",
    description: "Base output shape for generated artifacts.",
    body: "# Summary\n\n- Item 1",
    format: "markdown",
    targetKind: "artifact",
    variables: [{ name: "summary", required: true, description: "High-level artifact summary." }],
    versionMetadata: {
      channel: "preview",
      revision: 2,
      updatedAt: "2026-04-30T00:00:00Z",
    },
    labels: ["artifact"],
    metadata: { format: "markdown" },
  };
}

function makePolicyPack(): PolicyPackV0 {
  return {
    schema: "pluto.catalog.policy-pack",
    schemaVersion: 0,
    id: "default-guardrails",
    version: "0.0.1",
    status: "enabled",
    name: "Default guardrails",
    summary: "Baseline quality and safety requirements.",
    posture: "enforced",
    runtimeExpectations: {
      level: "required",
      values: ["workspace-write", "local-context"],
    },
    toolExpectations: {
      level: "required",
      values: ["read-before-write", "targeted-validation"],
    },
    sensitivityExpectations: {
      level: "required",
      values: ["no-secrets", "no-external-exfiltration"],
    },
    budgetExpectations: {
      level: "preferred",
      maxInputTokens: 24000,
      maxOutputTokens: 8000,
      maxRuntimeSeconds: 900,
    },
    approvalExpectations: {
      level: "required",
      values: ["no-force-push", "no-destructive-git"],
    },
    metadata: { audience: "workers" },
  };
}

function makeEntry(role: WorkerRoleV0, skill: SkillDefinitionV0, template: TemplateV0, policyPack: PolicyPackV0): SkillCatalogEntryV0 {
  return {
    schema: "pluto.catalog.skill-entry",
    schemaVersion: 0,
    id: "generator-repo-synthesis",
    version: "0.0.1",
    status: "active",
    summary: "Generator role with repo synthesis skill and artifact template.",
    visibility: "catalog",
    reviewStatus: "approved",
    trustTier: "trusted",
    deprecation: { status: "none" },
    versionPolicy: {
      track: "catalog-default",
      defaultVersion: "0.0.1",
      autoUpdate: "minor-only",
    },
    workerRole: { id: role.id, version: role.version },
    skill: { id: skill.id, version: skill.version },
    template: { id: template.id, version: template.version },
    policyPack: { id: policyPack.id, version: policyPack.version },
    labels: ["generator", "default"],
    metadata: { release: "alpha" },
  };
}

describe("CatalogStore", () => {
  it("round-trips catalog contract objects across supported kinds", async () => {
    const store = new CatalogStore({ dataDir: join(workDir, ".pluto") });
    const role = makeWorkerRole();
    const skill = makeSkill();
    const template = makeTemplate();
    const policyPack = makePolicyPack();
    const entry = makeEntry(role, skill, template, policyPack);

    await store.upsert("roles", role.id, role);
    await store.upsert("skills", skill.id, skill);
    await store.upsert("templates", template.id, template);
    await store.upsert("policy-packs", policyPack.id, policyPack);
    await store.upsert("entries", entry.id, entry);

    expect(await store.read("roles", role.id)).toEqual(role);
    expect(await store.read("skills", skill.id)).toEqual(skill);
    expect(await store.read("entries", entry.id)).toEqual(entry);

    expect(await store.list("roles")).toEqual([role]);
    expect(await store.list("policy-packs")).toEqual([policyPack]);

    const persisted = await readFile(join(workDir, ".pluto", "catalog", "roles", `${role.id}.json`), "utf8");
    expect(JSON.parse(persisted)).toEqual({
      schema: "pluto.catalog.version-envelope",
      schemaVersion: 0,
      id: role.id,
      versions: {
        [role.version]: role,
      },
    });
  });

  it("preserves multiple versions for the same logical id without overwrite", async () => {
    const store = new CatalogStore({ dataDir: join(workDir, ".pluto") });
    const roleV1 = makeWorkerRole();
    const roleV2: WorkerRoleV0 = {
      ...roleV1,
      version: "0.0.2",
      systemPrompt: "Generate the requested artifact using current repository context.",
      versionMetadata: {
        ...roleV1.versionMetadata,
        revision: 2,
        updatedAt: "2026-05-01T00:00:00Z",
        supersedesVersion: roleV1.version,
      },
    };

    await store.upsert("roles", roleV1.id, roleV1);
    await store.upsert("roles", roleV2.id, roleV2);

    await expect(store.read("roles", roleV1.id)).rejects.toThrow("Multiple catalog versions found for roles/generator; specify a version.");
    expect(await store.read("roles", roleV1.id, roleV1.version)).toEqual(roleV1);
    expect(await store.read("roles", roleV2.id, roleV2.version)).toEqual(roleV2);
    expect(await store.list("roles")).toEqual([roleV1, roleV2]);
  });

  it("tolerates missing files and directories", async () => {
    const store = new CatalogStore({ dataDir: join(workDir, ".pluto") });

    await expect(store.read("templates", "missing-template")).resolves.toBeNull();
    await expect(store.list("templates")).resolves.toEqual([]);
  });
});
