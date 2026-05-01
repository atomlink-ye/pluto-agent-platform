import { basename, isAbsolute, win32 } from "node:path";
import type {
  PortableNameRefSetV0,
  PortableWorkflowArtifactExpectationV0,
  PortableWorkflowBundleV0,
  PortableWorkflowExportInputV0,
  PortableWorkflowImportRequestV0,
  PortableWorkflowLogicalRefsV0,
  PortableWorkflowManifestV0,
  PortableWorkflowRuntimeV0,
} from "./contracts.js";
import type { AgentRoleConfig, RuntimeRequirementsV0, TeamConfig } from "../contracts/types.js";
import {
  DEFAULT_TEAM,
  DEFAULT_TEAM_ARTIFACT_EXPECTATION_V0,
  DEFAULT_TEAM_ENV_REFS_V0,
  DEFAULT_TEAM_LOGICAL_REFS_V0,
  DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0,
  DEFAULT_TEAM_SECRET_REFS_V0,
} from "../orchestrator/team-config.js";
import { DEFAULT_TEAM_PLAYBOOK_ID } from "../orchestrator/team-playbook.js";
import { redactString } from "../orchestrator/redactor.js";

const FORBIDDEN_KEY_RE = /^(?:document|documents|publishedWorkflow|publishedWorkflows|review|reviews|approval|approvals|publishPackage|publishPackages|runHistory|runHistories|history|events|eventLog|credentials|credential|rawCredentials|workspaceBinding|workspaceBindings|tenantBinding|tenantBindings|workspacePath|workspaceRoot|workspaceId|tenantId|tenantSlug|hostedEndpoint|hostedEndpoints|endpoint|endpoints|baseUrl|queueId|queueIds|providerSession|providerSessions|sessionId|sessionIds|agentId|agentIds|paseoAgentId|cwd|privatePath|privatePaths)$/i;
const SECRET_LIKE_KEY_RE = /(?:token|secret|apiKey|password|credential|authorization|authHeader)$/i;

function sanitizeRole(role: AgentRoleConfig): AgentRoleConfig {
  return {
    id: role.id,
    name: redactString(role.name),
    kind: role.kind,
    systemPrompt: sanitizePortableString(role.systemPrompt),
  };
}

function sanitizeTeam(team: TeamConfig): TeamConfig {
  return {
    ...team,
    id: redactString(team.id),
    name: redactString(team.name),
    leadRoleId: team.leadRoleId,
    roles: team.roles.map(sanitizeRole),
  };
}

function sanitizeStringArray(values: string[] | undefined): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }
  return Array.from(new Set(values.map((value) => redactString(value))));
}

function sanitizeNameRefSet(refs: PortableNameRefSetV0 | undefined): PortableNameRefSetV0 | undefined {
  if (!refs) {
    return undefined;
  }

  return {
    required: sanitizeStringArray(refs.required) ?? [],
    optional: sanitizeStringArray(refs.optional),
  };
}

function sanitizeRuntimeRequirements(
  requirements: RuntimeRequirementsV0,
): RuntimeRequirementsV0 {
  return {
    runtimeIds: sanitizeStringArray(requirements.runtimeIds),
    adapterIds: sanitizeStringArray(requirements.adapterIds),
    providers: sanitizeStringArray(requirements.providers),
    model: requirements.model
      ? {
          ids: sanitizeStringArray(requirements.model.ids),
          families: sanitizeStringArray(requirements.model.families),
          modes: sanitizeStringArray(requirements.model.modes),
          minContextWindowTokens: requirements.model.minContextWindowTokens,
          minMaxOutputTokens: requirements.model.minMaxOutputTokens,
          structuredOutput: requirements.model.structuredOutput,
        }
      : undefined,
    tools: requirements.tools ? { ...requirements.tools } : undefined,
    files: requirements.files ? { ...requirements.files } : undefined,
    callbacks: requirements.callbacks ? { ...requirements.callbacks } : undefined,
    locality: requirements.locality ? [...requirements.locality] : undefined,
    posture: requirements.posture ? [...requirements.posture] : undefined,
    limits: requirements.limits ? { ...requirements.limits } : undefined,
  };
}

function sanitizeRuntime(runtime: PortableWorkflowRuntimeV0): PortableWorkflowRuntimeV0 {
  return {
    requirements: sanitizeRuntimeRequirements(runtime.requirements),
    envRefs: sanitizeNameRefSet(runtime.envRefs),
    secretRefs: sanitizeNameRefSet(runtime.secretRefs),
  };
}

function sanitizeArtifact(
  artifact: PortableWorkflowArtifactExpectationV0,
): PortableWorkflowArtifactExpectationV0 {
  return {
    format: artifact.format,
    required: artifact.required,
    workspaceRelativeArtifactPathOnly: artifact.workspaceRelativeArtifactPathOnly,
    leadSummaryRequired: artifact.leadSummaryRequired,
    contributionRoleOrder: [...artifact.contributionRoleOrder],
  };
}

function sanitizeLogicalRefs(
  refs: PortableWorkflowLogicalRefsV0,
): PortableWorkflowLogicalRefsV0 {
  return {
    teamId: redactString(refs.teamId),
    leadRoleId: refs.leadRoleId,
    roleIds: [...refs.roleIds],
    runtimeIds: sanitizeStringArray(refs.runtimeIds) ?? [],
    adapterIds: sanitizeStringArray(refs.adapterIds) ?? [],
    providers: sanitizeStringArray(refs.providers) ?? [],
    artifactRefs: sanitizeStringArray(refs.artifactRefs) ?? [],
  };
}

function sanitizeManifest(
  manifest: PortableWorkflowManifestV0,
): PortableWorkflowManifestV0 {
  return {
    kind: manifest.kind,
    schemaVersion: 0,
    exportedAt: manifest.exportedAt,
    workflowId: redactString(manifest.workflowId),
    workflowName: sanitizePortableString(manifest.workflowName),
    executableSurface: manifest.executableSurface,
    logicalRefs: sanitizeLogicalRefs(manifest.logicalRefs),
    runtime: sanitizeRuntime(manifest.runtime),
    artifact: sanitizeArtifact(manifest.artifact),
  };
}

function sanitizePortableString(value: string): string {
  const redacted = redactString(value);
  if (looksLikeUrl(redacted)) {
    return "[REDACTED:endpoint]";
  }
  if (isAbsolutePath(redacted)) {
    return "[REDACTED:path]";
  }
  return redacted;
}

function sanitizeUnknown(value: unknown, parentKey?: string): unknown {
  if (typeof value === "string") {
    if (parentKey && SECRET_LIKE_KEY_RE.test(parentKey)) {
      return "[REDACTED]";
    }
    return sanitizePortableString(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeUnknown(entry, parentKey))
      .filter((entry) => entry !== undefined);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !FORBIDDEN_KEY_RE.test(key) && !SECRET_LIKE_KEY_RE.test(key))
        .map(([key, entry]) => [key, sanitizeUnknown(entry, key)])
        .filter(([, entry]) => entry !== undefined),
    );
  }

  return value;
}

function collectSafetyIssues(value: unknown, path: string, issues: string[]): void {
  if (typeof value === "string") {
    const redacted = redactString(value);
    if (redacted !== value) {
      issues.push(`${path} contains secret material`);
    }
    if (looksLikeUrl(value)) {
      issues.push(`${path} contains a hosted endpoint`);
    }
    if (isAbsolutePath(value)) {
      issues.push(`${path} contains a private path`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectSafetyIssues(entry, `${path}[${index}]`, issues));
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEY_RE.test(key)) {
        issues.push(`${path}.${key} is forbidden platform state`);
        continue;
      }
      if (SECRET_LIKE_KEY_RE.test(key)) {
        issues.push(`${path}.${key} is forbidden secret material`);
        continue;
      }
      collectSafetyIssues(entry, `${path}.${key}`, issues);
    }
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isAbsolutePath(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value);
}

export function sanitizePortableBundle(value: unknown): unknown {
  return sanitizeUnknown(value);
}

export function assertPortableBundleSafe(value: unknown): asserts value is PortableWorkflowBundleV0 {
  const issues: string[] = [];
  collectSafetyIssues(value, "bundle", issues);
  if (issues.length > 0) {
    throw new Error(`portable_bundle_unsafe:${issues.join("; ")}`);
  }
}

export function sanitizePortableImportSource(
  source: PortableWorkflowImportRequestV0["source"],
): PortableWorkflowImportRequestV0["source"] {
  if (!source) {
    return undefined;
  }

  const path = source.path ? sanitizePortableImportSourcePath(source.path) : undefined;
  if (!path) {
    return undefined;
  }

  return { path };
}

function sanitizePortableImportSourcePath(path: string): string {
  const redacted = redactString(path);
  const redactedPrefixMatch = /^\[REDACTED:(?:workspace-)?path\][\\/](.+)$/i.exec(redacted);
  if (redactedPrefixMatch) {
    return basename(redactedPrefixMatch[1]!);
  }
  if (looksLikeUrl(redacted)) {
    return "[REDACTED:endpoint]";
  }
  if (win32.isAbsolute(redacted)) {
    return win32.basename(redacted);
  }
  if (isAbsolute(redacted)) {
    return basename(redacted);
  }
  return redacted;
}

export function exportPortableWorkflowBundle(
  input: PortableWorkflowExportInputV0 = {},
): PortableWorkflowBundleV0 {
  const sourceTeam = input.team ?? DEFAULT_TEAM;
  if ((sourceTeam.defaultPlaybookId ?? DEFAULT_TEAM_PLAYBOOK_ID) !== DEFAULT_TEAM_PLAYBOOK_ID) {
    // TODO(S2/D3): expand portable workflow export once non-default playbook
    // logical refs and artifact expectations are versioned explicitly.
    throw new Error(
      `portable_workflow_non_default_playbook_export_deferred:${sourceTeam.defaultPlaybookId}`,
    );
  }
  const team = sanitizeTeam(sourceTeam);
  const logicalRefs = sanitizeLogicalRefs(DEFAULT_TEAM_LOGICAL_REFS_V0);
  const runtime = sanitizeRuntime({
    requirements: DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0,
    envRefs: DEFAULT_TEAM_ENV_REFS_V0,
    secretRefs: DEFAULT_TEAM_SECRET_REFS_V0,
  });

  const bundle: PortableWorkflowBundleV0 = {
    schemaVersion: 0,
    manifest: sanitizeManifest({
      kind: "pluto-portable-workflow",
      schemaVersion: 0,
      exportedAt: input.exportedAt ?? new Date().toISOString(),
      workflowId: team.id,
      workflowName: team.name,
      executableSurface: "team-config",
      logicalRefs,
      runtime,
      artifact: DEFAULT_TEAM_ARTIFACT_EXPECTATION_V0,
    }),
    team,
  };

  const sanitized = sanitizePortableBundle(bundle) as PortableWorkflowBundleV0;
  assertPortableBundleSafe(sanitized);
  return sanitized;
}
