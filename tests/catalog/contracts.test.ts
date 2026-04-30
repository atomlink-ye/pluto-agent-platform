import { describe, expect, it } from "vitest";

import type {
  PolicyPackV0,
  SkillCatalogEntryV0,
  SkillDefinitionV0,
  TemplateV0,
  WorkerRoleV0,
} from "@/catalog/contracts.js";

describe("catalog v0 contracts", () => {
  it("keeps worker, skill, template, policy, and entry contracts JSON-serializable", () => {
    const role: WorkerRoleV0 = {
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

    const skill: SkillDefinitionV0 = {
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

    const template: TemplateV0 = {
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
      variables: [
        {
          name: "summary",
          required: true,
          description: "High-level artifact summary.",
        },
      ],
      versionMetadata: {
        channel: "preview",
        revision: 2,
        updatedAt: "2026-04-30T00:00:00Z",
      },
      labels: ["artifact"],
      metadata: { format: "markdown" },
    };

    const policyPack: PolicyPackV0 = {
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

    const entry: SkillCatalogEntryV0 = {
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

    const parsed = JSON.parse(
      JSON.stringify({ role, skill, template, policyPack, entry }),
    );

    expect(parsed).toEqual({ role, skill, template, policyPack, entry });
    expect(entry.workerRole.version).toBe(role.version);
    expect(entry.skill.id).toBe(skill.id);
    expect(entry.status).toBe("active");
  });

  it("tolerates additive future fields without changing known contract fields", () => {
    const roleWithFutureFields = {
      schema: "pluto.catalog.worker-role",
      schemaVersion: 0,
      id: "planner",
      version: "0.0.2",
      status: "deprecated",
      name: "Planner",
      responsibility: "Break work into coherent subproblems.",
      systemPrompt: "Plan before generating.",
      allowedSkills: [{ id: "outline", version: "0.0.1" }],
      expectedEvidence: {
        artifactType: "plan",
        requiredFields: ["steps"],
        citationPolicy: "none",
        retention: "session",
      },
      versionMetadata: {
        channel: "legacy",
        revision: 2,
        updatedAt: "2026-04-30T00:00:00Z",
        supersedesVersion: "0.0.1",
      },
      labels: ["planning"],
      futureField: { source: "test" },
    } as WorkerRoleV0 & { futureField: { source: string } };

    const entryWithFutureFields = {
      schema: "pluto.catalog.skill-entry",
      schemaVersion: 0,
      id: "planner-legacy",
      version: "0.0.2",
      status: "deprecated",
      summary: "Legacy planner entry kept for compatibility.",
      visibility: "internal",
      reviewStatus: "reviewed",
      trustTier: "experimental",
      deprecation: {
        status: "deprecated",
        replacementEntryId: "generator-repo-synthesis",
        sunsetAt: "2026-06-01T00:00:00Z",
      },
      versionPolicy: {
        track: "pinned",
        defaultVersion: "0.0.2",
        autoUpdate: "manual",
      },
      workerRole: { id: "planner", version: "0.0.2" },
      skill: { id: "outline", version: "0.0.1" },
      labels: ["legacy"],
      futureField: ["allowed"],
    } as SkillCatalogEntryV0 & { futureField: string[] };

    expect(roleWithFutureFields.schemaVersion).toBe(0);
    expect(roleWithFutureFields.versionMetadata.revision).toBe(2);
    expect(roleWithFutureFields.futureField.source).toBe("test");
    expect(entryWithFutureFields.status).toBe("deprecated");
    expect(entryWithFutureFields.versionPolicy.defaultVersion).toBe("0.0.2");
    expect(entryWithFutureFields.futureField).toEqual(["allowed"]);
  });
});
