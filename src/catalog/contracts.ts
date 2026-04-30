export type CatalogStatusV0 = "active" | "deprecated";

export type CatalogInspectionStateV0 = "active" | "blocked" | "deprecated";

type CatalogMetadataV0 = Record<string, string>;

interface CatalogObjectRefV0 {
  id: string;
  version: string;
}

interface CatalogVersionMetadataV0 {
  channel: "stable" | "preview" | "legacy";
  revision: number;
  updatedAt: string;
  supersedesVersion?: string;
}

interface EvidenceContractV0 {
  artifactType: "report" | "plan" | "patch" | "transcript" | "checklist";
  requiredFields: string[];
  citationPolicy: "none" | "local-only" | "local-or-runtime";
  retention: "ephemeral" | "session" | "durable";
}

interface TemplateVariableV0 {
  name: string;
  required: boolean;
  description: string;
}

interface PolicyExpectationV0 {
  level: "preferred" | "required";
  values: string[];
}

interface PolicyBudgetExpectationV0 {
  level: "preferred" | "required";
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxRuntimeSeconds?: number;
}

interface CatalogDeprecationV0 {
  status: "none" | "scheduled" | "deprecated";
  replacementEntryId?: string;
  sunsetAt?: string;
  note?: string;
}

interface CatalogVersionPolicyV0 {
  track: "pinned" | "minor" | "catalog-default";
  defaultVersion: string;
  autoUpdate: "manual" | "minor-only";
}

export interface WorkerRoleV0 {
  schema: "pluto.catalog.worker-role";
  schemaVersion: 0;
  id: string;
  version: string;
  status: CatalogStatusV0;
  name: string;
  responsibility: string;
  systemPrompt: string;
  allowedSkills: CatalogObjectRefV0[];
  expectedEvidence: EvidenceContractV0;
  versionMetadata: CatalogVersionMetadataV0;
  labels: string[];
  metadata?: CatalogMetadataV0;
}

export interface SkillDefinitionV0 {
  schema: "pluto.catalog.skill-definition";
  schemaVersion: 0;
  id: string;
  version: string;
  status: CatalogStatusV0;
  name: string;
  summary: string;
  instructions: string;
  requiredCapabilities: string[];
  toolRequirements: string[];
  secretRefs: string[];
  safetyNotes: string[];
  evidenceContract: EvidenceContractV0;
  versionMetadata: CatalogVersionMetadataV0;
  labels: string[];
  metadata?: CatalogMetadataV0;
}

export interface TemplateV0 {
  schema: "pluto.catalog.template";
  schemaVersion: 0;
  id: string;
  version: string;
  status: CatalogStatusV0;
  name: string;
  description: string;
  body: string;
  format: "markdown" | "json" | "text";
  targetKind: "artifact" | "instruction" | "team-default";
  variables: TemplateVariableV0[];
  versionMetadata: CatalogVersionMetadataV0;
  labels: string[];
  metadata?: CatalogMetadataV0;
}

export type PolicyPackV0 =
  | {
      schema: "pluto.catalog.policy-pack";
      schemaVersion: 0;
      id: string;
      version: string;
      status: "enabled";
      name: string;
      summary: string;
      posture: "advisory" | "enforced";
      runtimeExpectations: PolicyExpectationV0;
      toolExpectations: PolicyExpectationV0;
      sensitivityExpectations: PolicyExpectationV0;
      budgetExpectations: PolicyBudgetExpectationV0;
      approvalExpectations: PolicyExpectationV0;
      metadata?: CatalogMetadataV0;
    }
  | {
      schema: "pluto.catalog.policy-pack";
      schemaVersion: 0;
      id: string;
      version: string;
      status: "blocked";
      name: string;
      summary: string;
      reason: "conflict";
      conflicts: Array<{
        policyId: string;
        withPolicyId: string;
        message: string;
      }>;
      metadata?: CatalogMetadataV0;
    };

export interface SkillCatalogEntryV0 {
  schema: "pluto.catalog.skill-entry";
  schemaVersion: 0;
  id: string;
  version: string;
  status: CatalogStatusV0;
  summary: string;
  visibility: "internal" | "restricted" | "catalog";
  reviewStatus: "draft" | "submitted" | "reviewed" | "approved";
  trustTier: "experimental" | "trusted" | "restricted";
  deprecation: CatalogDeprecationV0;
  versionPolicy: CatalogVersionPolicyV0;
  workerRole: CatalogObjectRefV0;
  skill: CatalogObjectRefV0;
  template?: CatalogObjectRefV0;
  policyPack?: CatalogObjectRefV0;
  labels: string[];
  metadata?: CatalogMetadataV0;
}

export const CATALOG_KINDS = ["roles", "skills", "templates", "policy-packs", "entries"] as const;

export type CatalogRecordByKind = {
  roles: WorkerRoleV0;
  skills: SkillDefinitionV0;
  templates: TemplateV0;
  "policy-packs": PolicyPackV0;
  entries: SkillCatalogEntryV0;
};

export type CatalogKind = keyof CatalogRecordByKind;

export type CatalogRecord = CatalogRecordByKind[CatalogKind];

export interface CatalogListItemV0 {
  kind: CatalogKind;
  id: string;
  version: string;
  state: CatalogInspectionStateV0;
  status: string;
  name: string | null;
  summary: string | null;
  reviewStatus: SkillCatalogEntryV0["reviewStatus"] | null;
  visibility: SkillCatalogEntryV0["visibility"] | null;
  trustTier: SkillCatalogEntryV0["trustTier"] | null;
  labels: string[];
}

export interface CatalogListOutputV0 {
  schema: "pluto.catalog.list-output";
  schemaVersion: 0;
  items: CatalogListItemV0[];
}
