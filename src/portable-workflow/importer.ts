import { randomUUID } from "node:crypto";

import type { RuntimeCapabilityDescriptorV0, RuntimeRequirementsV0, TeamConfig } from "../contracts/types.js";
import {
  DEFAULT_TEAM,
  DEFAULT_TEAM_ARTIFACT_EXPECTATION_V0,
  DEFAULT_TEAM_LOGICAL_REFS_V0,
  DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0,
} from "../orchestrator/team-config.js";
import { evaluateCompatibility, type CompatibilityContextV0 } from "../versioning/index.js";
import type { CompatibilityImportTargetV0, SchemaVersionRefV0 } from "../versioning/contracts.js";
import type {
  PortableWorkflowBundleV0,
  PortableWorkflowImportRequestV0,
  PortableWorkflowImportResultV0,
  PortableWorkflowImportModeV0,
} from "./contracts.js";
import { assertPortableBundleSafe, sanitizePortableBundle, sanitizePortableImportSource } from "./sanitizer.js";
import { PortableWorkflowStore } from "./store.js";

const PORTABLE_WORKFLOW_SCHEMA_FAMILY = "portable-workflow";

const CURRENT_RUNTIME_CAPABILITY: RuntimeCapabilityDescriptorV0 = {
  schemaVersion: 0,
  runtimeId: "opencode-live",
  adapterId: "paseo-opencode",
  provider: "opencode",
  model: {
    id: "opencode/minimax-m2.5-free",
    family: "minimax",
    mode: "build",
    contextWindowTokens: 128_000,
  },
  tools: {
    shell: true,
  },
  files: {
    read: true,
    write: true,
    workspaceRootOnly: true,
  },
  callbacks: {
    followUpMessages: true,
    eventStream: true,
    backgroundSessions: true,
  },
  locality: "remote",
  posture: "workspace_write",
  limits: {
    maxExecutionMs: 180_000,
  },
};

export interface ImportPortableWorkflowOptions {
  store?: PortableWorkflowStore;
  idGen?: () => string;
  clock?: () => Date;
  team?: TeamConfig;
  supportedRuntimeRequirements?: RuntimeRequirementsV0;
  availableCapabilities?: RuntimeCapabilityDescriptorV0[];
}

export async function importPortableWorkflowBundle(
  request: PortableWorkflowImportRequestV0,
  options: ImportPortableWorkflowOptions = {},
): Promise<PortableWorkflowImportResultV0> {
  const store = options.store ?? new PortableWorkflowStore();
  const idGen = options.idGen ?? defaultDraftId;
  const clock = options.clock ?? (() => new Date());
  const supportedRuntimeRequirements =
    options.supportedRuntimeRequirements ?? DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0;
  const availableCapabilities = options.availableCapabilities ?? [CURRENT_RUNTIME_CAPABILITY];
  const importedAt = clock().toISOString();
  const draftId = idGen();
  const mode = normalizeMode(request.mode);
  const errors: string[] = [];
  const policyErrors: string[] = [];

  let bundle: PortableWorkflowBundleV0 | null = null;

  try {
    assertPortableBundleSafe(request.bundle);
    const sanitized = sanitizePortableBundle(request.bundle);
    const parsed = parsePortableWorkflowBundle(sanitized);
    validatePortableBundleShape(parsed);
    bundle = parsed;
  } catch (error) {
    errors.push(asErrorMessage(error));
  }

  if (bundle) {
    errors.push(...validateExecutableSurface(bundle, options.team ?? DEFAULT_TEAM));
  }

  if (request.mode !== undefined && request.mode !== "draft" && request.mode !== "fork") {
    policyErrors.push(`policy_denied: imports must materialize as draft or fork, received '${String(request.mode)}'`);
  }
  errors.push(...policyErrors);
  const existingWorkflow = bundle ? await detectStoredWorkflowCollision(store, bundle) : undefined;

  const compatibilityContext = buildCompatibilityContext(bundle, {
    mode,
    existingWorkflow,
    supportedRuntimeRequirements,
    availableCapabilities,
    policyAllowed: policyErrors.length === 0,
    policyReason: policyErrors.length === 0 ? undefined : policyErrors.join("; "),
  });
  const compatibility = evaluateCompatibility(compatibilityContext);
  const result: PortableWorkflowImportResultV0 = {
    schemaVersion: 0,
    draftId,
    importedAt,
    mode,
    status: errors.length === 0 && compatibility.status === "compatible" ? "ready" : "blocked",
    importable: errors.length === 0 && compatibility.status === "compatible",
    publishedStateMaterialized: false,
    runtimeStateMaterialized: false,
    errors,
    compatibility,
    conflicts: detectConflictsFromCompatibility(compatibility),
    bundle,
    source: sanitizePortableImportSource(request.source),
  };

  await store.writeImportResult(result);
  return result;
}

function defaultDraftId(): string {
  return `draft-${randomUUID()}`;
}

function normalizeMode(mode: PortableWorkflowImportModeV0 | undefined): PortableWorkflowImportModeV0 {
  return mode ?? "draft";
}

function parsePortableWorkflowBundle(value: unknown): PortableWorkflowBundleV0 {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid_bundle: expected object root");
  }
  return value as PortableWorkflowBundleV0;
}

function validatePortableBundleShape(bundle: PortableWorkflowBundleV0): void {
  if (bundle.schemaVersion !== 0) {
    throw new Error(`invalid_bundle: unsupported schemaVersion '${String(bundle.schemaVersion)}'`);
  }
  if (bundle.manifest?.kind !== "pluto-portable-workflow") {
    throw new Error("invalid_bundle: manifest.kind must be 'pluto-portable-workflow'");
  }
  if (bundle.manifest?.schemaVersion !== 0) {
    throw new Error(`invalid_bundle: unsupported manifest.schemaVersion '${String(bundle.manifest?.schemaVersion)}'`);
  }
  if (bundle.manifest?.executableSurface !== "team-config") {
    throw new Error(`invalid_bundle: unsupported executableSurface '${String(bundle.manifest?.executableSurface)}'`);
  }
  if (!bundle.manifest?.exportedAt || !bundle.manifest?.workflowId || !bundle.manifest?.workflowName) {
    throw new Error("invalid_bundle: manifest metadata is incomplete");
  }
  if (!Array.isArray(bundle.team?.roles) || bundle.team.roles.length === 0) {
    throw new Error("invalid_bundle: team roles are required");
  }
  if (!Array.isArray(bundle.manifest.runtime.envRefs?.required) || !Array.isArray(bundle.manifest.runtime.secretRefs?.required)) {
    throw new Error("invalid_bundle: runtime envRefs.required and secretRefs.required are required arrays");
  }
}

function validateExecutableSurface(bundle: PortableWorkflowBundleV0, team: TeamConfig): string[] {
  const errors: string[] = [];
  const roleIds = new Set(bundle.team.roles.map((role) => role.id));

  if (bundle.team.leadRoleId !== bundle.manifest.logicalRefs.leadRoleId) {
    errors.push("dependency_unresolved: leadRoleId must match manifest.logicalRefs.leadRoleId");
  }

  for (const roleId of bundle.manifest.logicalRefs.roleIds) {
    if (!roleIds.has(roleId)) {
      errors.push(`dependency_unresolved: manifest.logicalRefs.roleIds references missing team role '${roleId}'`);
    }
  }

  for (const roleId of bundle.manifest.artifact.contributionRoleOrder) {
    if (!roleIds.has(roleId)) {
      errors.push(`dependency_unresolved: artifact.contributionRoleOrder references missing team role '${roleId}'`);
    }
  }

  if (bundle.manifest.artifact.format !== DEFAULT_TEAM_ARTIFACT_EXPECTATION_V0.format) {
    errors.push(`dependency_unresolved: unsupported artifact format '${bundle.manifest.artifact.format}'`);
  }

  if (!bundle.manifest.artifact.required || !bundle.manifest.artifact.workspaceRelativeArtifactPathOnly) {
    errors.push("policy_denied: imported workflows must require workspace-relative markdown artifacts");
  }

  if (!bundle.manifest.artifact.leadSummaryRequired) {
    errors.push("policy_denied: imported workflows must require a lead summary");
  }

  if (bundle.manifest.logicalRefs.artifactRefs.some((ref) => !DEFAULT_TEAM_LOGICAL_REFS_V0.artifactRefs.includes(ref))) {
    errors.push("dependency_unresolved: artifactRefs include unsupported executable-surface references");
  }

  if (bundle.team.roles.some((role) => !team.roles.find((existing) => existing.id === role.id))) {
    errors.push("dependency_unresolved: imported workflow references roles outside today's executable team surface");
  }

  return errors;
}

function buildCompatibilityContext(
  bundle: PortableWorkflowBundleV0 | null,
  input: {
    mode: PortableWorkflowImportModeV0;
    existingWorkflow?: ExistingWorkflowCompatibilityContext;
    supportedRuntimeRequirements: RuntimeRequirementsV0;
    availableCapabilities: RuntimeCapabilityDescriptorV0[];
    policyAllowed: boolean;
    policyReason?: string;
  },
): CompatibilityContextV0 {
  const subjectVersion = bundle?.manifest.schemaVersion ?? -1;
  const operation = input.mode === "fork" ? "fork" : "import";

  return {
    operation,
    subject: {
      family: PORTABLE_WORKFLOW_SCHEMA_FAMILY,
      version: subjectVersion,
      writtenAt: bundle?.manifest.exportedAt ?? new Date(0).toISOString(),
    },
    against: {
      family: PORTABLE_WORKFLOW_SCHEMA_FAMILY,
      version: input.existingWorkflow?.against.version ?? 0,
      writtenAt: input.existingWorkflow?.against.writtenAt ?? new Date(0).toISOString(),
    },
    incoming: bundle
      ? {
          logicalId: bundle.manifest.workflowId,
          name: bundle.manifest.workflowName,
        }
      : undefined,
    existing: input.existingWorkflow?.target,
    supported: {
      schemaFamilies: [PORTABLE_WORKFLOW_SCHEMA_FAMILY],
      schemaVersions: [0],
    },
    dependencies: buildDependencyChecks(bundle, input.supportedRuntimeRequirements),
    capabilities: bundle
      ? {
          required: bundle.manifest.runtime.requirements,
          available: input.availableCapabilities,
        }
      : undefined,
    policy: {
      allowed: input.policyAllowed,
      reason: input.policyReason,
    },
    packageVersion: {
      name: "pluto-agent-platform",
      version: "0.1.0-alpha.0",
    },
    againstPackageVersion: {
      name: "pluto-agent-platform",
      version: "0.1.0-alpha.0",
    },
  };
}

function buildDependencyChecks(
  bundle: PortableWorkflowBundleV0 | null,
  supportedRuntimeRequirements: RuntimeRequirementsV0,
) {
  if (!bundle) {
    return [{ id: "bundle", resolved: false }];
  }

  const supportedRuntimeIds = new Set(supportedRuntimeRequirements.runtimeIds ?? []);
  const supportedAdapterIds = new Set(supportedRuntimeRequirements.adapterIds ?? []);
  const supportedProviders = new Set(supportedRuntimeRequirements.providers ?? []);
  const dependencies = [
    ...(bundle.manifest.runtime.requirements.runtimeIds ?? []).map((id) => ({
      id: `runtime:${id}`,
      resolved: supportedRuntimeIds.has(id),
    })),
    ...(bundle.manifest.runtime.requirements.adapterIds ?? []).map((id) => ({
      id: `adapter:${id}`,
      resolved: supportedAdapterIds.has(id),
    })),
    ...(bundle.manifest.runtime.requirements.providers ?? []).map((id) => ({
      id: `provider:${id}`,
      resolved: supportedProviders.has(id),
    })),
  ];

  return dependencies.length > 0 ? dependencies : [{ id: "runtime-surface", resolved: true }];
}

interface ExistingWorkflowCompatibilityContext {
  target: CompatibilityImportTargetV0;
  against: SchemaVersionRefV0;
}

async function detectStoredWorkflowCollision(
  store: PortableWorkflowStore,
  bundle: PortableWorkflowBundleV0,
): Promise<ExistingWorkflowCompatibilityContext | undefined> {
  const drafts = await store.listImportResults();
  const logicalIdMatch = drafts.find((draft) => draft.bundle?.manifest.workflowId === bundle.manifest.workflowId);
  const nameMatch = drafts.find((draft) => draft.bundle?.manifest.workflowName === bundle.manifest.workflowName);

  if (!logicalIdMatch && !nameMatch) {
    return undefined;
  }

  const matchedDraft = logicalIdMatch ?? nameMatch;
  if (!matchedDraft?.bundle) {
    return undefined;
  }

  return {
    target: {
      logicalId: logicalIdMatch ? bundle.manifest.workflowId : undefined,
      name: nameMatch ? bundle.manifest.workflowName : undefined,
    },
    against: {
      family: PORTABLE_WORKFLOW_SCHEMA_FAMILY,
      version: matchedDraft.bundle.manifest.schemaVersion,
      writtenAt: matchedDraft.bundle.manifest.exportedAt,
    },
  };
}

function detectConflictsFromCompatibility(
  compatibility: PortableWorkflowImportResultV0["compatibility"],
) {
  const blockers = compatibility.blockers;
  const codes = new Set(blockers.map((blocker) => blocker.split(":", 1)[0] ?? ""));
  const conflicts = [] as PortableWorkflowImportResultV0["conflicts"];
  for (const code of codes) {
    if (
      code === "logical_id_collision" ||
      code === "name_collision" ||
      code === "unsupported_schema" ||
      code === "missing_dependency" ||
      code === "capability_unavailable" ||
      code === "policy_denied" ||
      code === "package_version_conflict" ||
      code === "ancestry_diverged" ||
      code === "external_ref_unresolved"
    ) {
      conflicts.push({
        code,
        message: blockers.find((blocker) => blocker.startsWith(`${code}:`))?.slice(code.length + 2) ?? code,
        incoming: compatibility.checkedAgainst.subject,
        existing: compatibility.checkedAgainst.against,
      });
    }
  }
  return conflicts;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
