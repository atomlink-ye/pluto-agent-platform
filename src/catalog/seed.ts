import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type {
  PolicyPackV0,
  SkillCatalogEntryV0,
  SkillDefinitionV0,
  TemplateV0,
  WorkerRoleV0,
} from "./contracts.js";

export type DefaultCatalogSeedSource = "curated-fallback" | "file-backed";

export interface DefaultCatalogSeed {
  source: DefaultCatalogSeedSource;
  workerRoles: WorkerRoleV0[];
  skills: SkillDefinitionV0[];
  templates: TemplateV0[];
  policyPacks: PolicyPackV0[];
  entries: SkillCatalogEntryV0[];
  fileBackedKeys: {
    workerRoles: ReadonlySet<string>;
    skills: ReadonlySet<string>;
    templates: ReadonlySet<string>;
    policyPacks: ReadonlySet<string>;
    entries: ReadonlySet<string>;
  };
}

export interface SeedDefaultCatalogOptions {
  catalogDir?: string;
}

const VERSION = "0.0.1";
const UPDATED_AT = "2026-04-30T00:00:00Z";

const CURATED_WORKER_ROLES: WorkerRoleV0[] = [
  {
    schema: "pluto.catalog.worker-role",
    schemaVersion: 0,
    id: "lead",
    version: VERSION,
    status: "active",
    name: "Team Lead",
    responsibility: "Orchestrate the workers and synthesize the final artifact.",
    systemPrompt: [
      "You are the Team Lead for a Pluto MVP-alpha team task.",
      "You MUST orchestrate work by dispatching at least two workers.",
      "Do not write the planner, generator, or evaluator outputs yourself.",
      "Always call planner first, then generator, then evaluator.",
      "After workers respond, summarize their contributions into the final artifact.",
      "The final artifact MUST cite each worker by role and include their findings.",
    ].join(" "),
    allowedSkills: [{ id: "lead-orchestrate", version: VERSION }],
    expectedEvidence: {
      artifactType: "report",
      requiredFields: ["leadSummary", "workerContributions"],
      citationPolicy: "local-or-runtime",
      retention: "durable",
    },
    versionMetadata: {
      channel: "stable",
      revision: 1,
      updatedAt: UPDATED_AT,
    },
    labels: ["default", "lead"],
    metadata: { lane: "r6" },
  },
  {
    schema: "pluto.catalog.worker-role",
    schemaVersion: 0,
    id: "planner",
    version: VERSION,
    status: "active",
    name: "Planner",
    responsibility: "Produce a concise implementation plan for the team goal.",
    systemPrompt: [
      "You are the Planner worker. Output a short bullet-list plan that satisfies the team's goal.",
      "Stop when you have produced the plan. Do not implement.",
    ].join(" "),
    allowedSkills: [{ id: "plan-artifact", version: VERSION }],
    expectedEvidence: {
      artifactType: "plan",
      requiredFields: ["steps"],
      citationPolicy: "none",
      retention: "session",
    },
    versionMetadata: {
      channel: "stable",
      revision: 1,
      updatedAt: UPDATED_AT,
    },
    labels: ["default", "planner"],
    metadata: { lane: "r6" },
  },
  {
    schema: "pluto.catalog.worker-role",
    schemaVersion: 0,
    id: "generator",
    version: VERSION,
    status: "active",
    name: "Generator",
    responsibility: "Generate the concrete artifact body for the team goal.",
    systemPrompt: [
      "You are the Generator worker. Given the team's goal and the planner's plan, produce the concrete artifact body.",
      "Keep output focused and limited to the goal.",
    ].join(" "),
    allowedSkills: [{ id: "generate-artifact", version: VERSION }],
    expectedEvidence: {
      artifactType: "patch",
      requiredFields: ["artifactBody"],
      citationPolicy: "local-only",
      retention: "durable",
    },
    versionMetadata: {
      channel: "stable",
      revision: 1,
      updatedAt: UPDATED_AT,
    },
    labels: ["default", "generator"],
    metadata: { lane: "r6" },
  },
  {
    schema: "pluto.catalog.worker-role",
    schemaVersion: 0,
    id: "evaluator",
    version: VERSION,
    status: "active",
    name: "Evaluator",
    responsibility: "Validate the generated artifact against the team goal.",
    systemPrompt: [
      "You are the Evaluator worker. Verify the generator's artifact against the team goal.",
      "Output a single line that begins with 'PASS:' or 'FAIL:' followed by a one-sentence rationale.",
    ].join(" "),
    allowedSkills: [{ id: "evaluate-artifact", version: VERSION }],
    expectedEvidence: {
      artifactType: "checklist",
      requiredFields: ["verdict"],
      citationPolicy: "local-or-runtime",
      retention: "session",
    },
    versionMetadata: {
      channel: "stable",
      revision: 1,
      updatedAt: UPDATED_AT,
    },
    labels: ["default", "evaluator"],
    metadata: { lane: "r6" },
  },
];

const CURATED_SKILLS: SkillDefinitionV0[] = [
  buildSkill("lead-orchestrate", "Lead orchestration", "Inspect worker outputs and synthesize the final markdown artifact."),
  buildSkill("plan-artifact", "Artifact planning", "Break the task into concise, ordered implementation steps."),
  buildSkill("generate-artifact", "Artifact generation", "Produce the concrete artifact body that satisfies the plan and task goal."),
  buildSkill("evaluate-artifact", "Artifact evaluation", "Validate the generated artifact and return a PASS/FAIL line with rationale."),
];

const CURATED_TEMPLATES: TemplateV0[] = [
  buildTemplate("lead-summary", "Lead summary", "# Summary\n\n{{summary}}", "artifact"),
  buildTemplate("planner-plan", "Planner plan", "- Step 1\n- Step 2", "instruction"),
  buildTemplate("generator-body", "Generator body", "{{artifactBody}}", "artifact"),
  buildTemplate("evaluator-verdict", "Evaluator verdict", "PASS: {{rationale}}", "instruction"),
];

const CURATED_POLICY_PACKS: PolicyPackV0[] = [
  {
    schema: "pluto.catalog.policy-pack",
    schemaVersion: 0,
    id: "default-guardrails",
    version: VERSION,
    status: "enabled",
    name: "Default guardrails",
    summary: "Baseline safety and verification expectations for the default Pluto team.",
    posture: "enforced",
    runtimeExpectations: { level: "required", values: ["workspace-write", "local-context"] },
    toolExpectations: { level: "required", values: ["read-before-write", "targeted-validation"] },
    sensitivityExpectations: { level: "required", values: ["no-secrets", "no-external-exfiltration"] },
    budgetExpectations: { level: "preferred", maxRuntimeSeconds: 900 },
    approvalExpectations: { level: "required", values: ["no-force-push", "no-destructive-git"] },
    metadata: { lane: "r6" },
  },
];

const CURATED_ENTRIES: SkillCatalogEntryV0[] = [
  buildEntry("default-lead", "lead", "lead-orchestrate", "lead-summary"),
  buildEntry("default-planner", "planner", "plan-artifact", "planner-plan"),
  buildEntry("default-generator", "generator", "generate-artifact", "generator-body"),
  buildEntry("default-evaluator", "evaluator", "evaluate-artifact", "evaluator-verdict"),
];

const CURATED_SEED: DefaultCatalogSeed = {
  source: "curated-fallback",
  workerRoles: CURATED_WORKER_ROLES,
  skills: CURATED_SKILLS,
  templates: CURATED_TEMPLATES,
  policyPacks: CURATED_POLICY_PACKS,
  entries: CURATED_ENTRIES,
  fileBackedKeys: {
    workerRoles: new Set(),
    skills: new Set(),
    templates: new Set(),
    policyPacks: new Set(),
    entries: new Set(),
  },
};

export function getCuratedDefaultCatalogSeed(): DefaultCatalogSeed {
  return cloneSeed(CURATED_SEED);
}

export function seedDefaultCatalog(
  opts: SeedDefaultCatalogOptions = {},
): DefaultCatalogSeed {
  const catalogDir = opts.catalogDir ?? resolve(process.cwd(), ".pluto", "catalog");
  const fileObjects = readCatalogObjects(catalogDir);
  const workerRoles = fileObjects.filter(isWorkerRole);
  const skills = fileObjects.filter(isSkillDefinition);
  const templates = fileObjects.filter(isTemplate);
  const policyPacks = fileObjects.filter(isPolicyPack);
  const entries = fileObjects.filter(isSkillCatalogEntry);
  const validCatalogObjectCount =
    workerRoles.length + skills.length + templates.length + policyPacks.length + entries.length;
  if (validCatalogObjectCount === 0) {
    return cloneSeed(CURATED_SEED);
  }

  return {
    source: "file-backed",
    workerRoles: mergeCatalogObjects(CURATED_WORKER_ROLES, workerRoles),
    skills: mergeCatalogObjects(CURATED_SKILLS, skills),
    templates: mergeCatalogObjects(CURATED_TEMPLATES, templates),
    policyPacks: mergeCatalogObjects(CURATED_POLICY_PACKS, policyPacks),
    entries: mergeCatalogObjects(CURATED_ENTRIES, entries),
    fileBackedKeys: {
      workerRoles: new Set(workerRoles.map(catalogKey)),
      skills: new Set(skills.map(catalogKey)),
      templates: new Set(templates.map(catalogKey)),
      policyPacks: new Set(policyPacks.map(catalogKey)),
      entries: new Set(entries.map(catalogKey)),
    },
  };
}

function buildSkill(id: string, name: string, instructions: string): SkillDefinitionV0 {
  return {
    schema: "pluto.catalog.skill-definition",
    schemaVersion: 0,
    id,
    version: VERSION,
    status: "active",
    name,
    summary: instructions,
    instructions,
    requiredCapabilities: ["local-repo-read"],
    toolRequirements: ["glob", "grep", "read"],
    secretRefs: [],
    safetyNotes: ["Read local context before acting.", "Do not expose secrets."],
    evidenceContract: {
      artifactType: "report",
      requiredFields: ["summary"],
      citationPolicy: "local-only",
      retention: "session",
    },
    versionMetadata: {
      channel: "stable",
      revision: 1,
      updatedAt: UPDATED_AT,
    },
    labels: ["default", id],
    metadata: { lane: "r6" },
  };
}

function buildTemplate(
  id: string,
  name: string,
  body: string,
  targetKind: TemplateV0["targetKind"],
): TemplateV0 {
  return {
    schema: "pluto.catalog.template",
    schemaVersion: 0,
    id,
    version: VERSION,
    status: "active",
    name,
    description: `${name} template for the curated default team.`,
    body,
    format: "markdown",
    targetKind,
    variables: [],
    versionMetadata: {
      channel: "stable",
      revision: 1,
      updatedAt: UPDATED_AT,
    },
    labels: ["default", id],
    metadata: { lane: "r6" },
  };
}

function buildEntry(
  id: string,
  roleId: WorkerRoleV0["id"],
  skillId: SkillDefinitionV0["id"],
  templateId: TemplateV0["id"],
): SkillCatalogEntryV0 {
  return {
    schema: "pluto.catalog.skill-entry",
    schemaVersion: 0,
    id,
    version: VERSION,
    status: "active",
    summary: `Curated default entry for the ${roleId} role.`,
    visibility: "catalog",
    reviewStatus: "approved",
    trustTier: "trusted",
    deprecation: { status: "none" },
    versionPolicy: {
      track: "catalog-default",
      defaultVersion: VERSION,
      autoUpdate: "minor-only",
    },
    workerRole: { id: roleId, version: VERSION },
    skill: { id: skillId, version: VERSION },
    template: { id: templateId, version: VERSION },
    policyPack: { id: "default-guardrails", version: VERSION },
    labels: ["default", roleId],
    metadata: { lane: "r6" },
  };
}

function readCatalogObjects(catalogDir: string): unknown[] {
  if (!existsSync(catalogDir)) {
    return [];
  }
  let dirStat;
  try {
    dirStat = statSync(catalogDir);
  } catch {
    return [];
  }
  if (!dirStat.isDirectory()) {
    return [];
  }

  const objects: unknown[] = [];
  for (const filePath of walkJsonFiles(catalogDir)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));
      objects.push(parsed);
    } catch {
      // Corrupt files are ignored so curated in-code assets remain sufficient.
    }
  }
  return objects;
}

function walkJsonFiles(rootDir: string): string[] {
  const discovered: string[] = [];
  const entries = readdirSync(rootDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      discovered.push(...walkJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      discovered.push(fullPath);
    }
  }
  return discovered;
}

function mergeCatalogObjects<T extends { id: string; version: string }>(
  curated: readonly T[],
  fileBacked: readonly T[],
): T[] {
  const merged = new Map<string, T>();
  for (const item of curated) {
    merged.set(catalogKey(item), structuredClone(item));
  }
  for (const item of fileBacked) {
    merged.set(catalogKey(item), structuredClone(item));
  }
  return Array.from(merged.values()).sort((a, b) => catalogKey(a).localeCompare(catalogKey(b)));
}

function catalogKey(item: { id: string; version: string }) {
  return `${item.id}@${item.version}`;
}

function cloneSeed(seed: DefaultCatalogSeed): DefaultCatalogSeed {
  return {
    source: seed.source,
    workerRoles: structuredClone(seed.workerRoles),
    skills: structuredClone(seed.skills),
    templates: structuredClone(seed.templates),
    policyPacks: structuredClone(seed.policyPacks),
    entries: structuredClone(seed.entries),
    fileBackedKeys: {
      workerRoles: new Set(seed.fileBackedKeys.workerRoles),
      skills: new Set(seed.fileBackedKeys.skills),
      templates: new Set(seed.fileBackedKeys.templates),
      policyPacks: new Set(seed.fileBackedKeys.policyPacks),
      entries: new Set(seed.fileBackedKeys.entries),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkerRole(value: unknown): value is WorkerRoleV0 {
  return isRecord(value)
    && value["schema"] === "pluto.catalog.worker-role"
    && typeof value["id"] === "string"
    && typeof value["version"] === "string"
    && typeof value["systemPrompt"] === "string"
    && typeof value["name"] === "string"
    && Array.isArray(value["allowedSkills"]);
}

function isSkillDefinition(value: unknown): value is SkillDefinitionV0 {
  return isRecord(value)
    && value["schema"] === "pluto.catalog.skill-definition"
    && typeof value["id"] === "string"
    && typeof value["version"] === "string"
    && typeof value["instructions"] === "string"
    && typeof value["name"] === "string";
}

function isTemplate(value: unknown): value is TemplateV0 {
  return isRecord(value)
    && value["schema"] === "pluto.catalog.template"
    && typeof value["id"] === "string"
    && typeof value["version"] === "string"
    && typeof value["body"] === "string"
    && typeof value["name"] === "string";
}

function isPolicyPack(value: unknown): value is PolicyPackV0 {
  return isRecord(value)
    && value["schema"] === "pluto.catalog.policy-pack"
    && typeof value["id"] === "string"
    && typeof value["version"] === "string"
    && typeof value["status"] === "string"
    && typeof value["name"] === "string";
}

function isSkillCatalogEntry(value: unknown): value is SkillCatalogEntryV0 {
  return isRecord(value)
    && value["schema"] === "pluto.catalog.skill-entry"
    && typeof value["id"] === "string"
    && typeof value["version"] === "string"
    && isRecord(value["workerRole"])
    && typeof value["workerRole"]["id"] === "string"
    && typeof value["workerRole"]["version"] === "string"
    && isRecord(value["skill"])
    && typeof value["skill"]["id"] === "string"
    && typeof value["skill"]["version"] === "string";
}
