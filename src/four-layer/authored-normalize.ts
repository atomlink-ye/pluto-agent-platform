import {
  FOUR_LAYER_SCHEMA_VERSION,
  type Agent,
  type ArtifactContract,
  type ArtifactContractFileRequirement,
  type FourLayerAuthoredObjectKind,
  type Playbook,
  type PlaybookAuditPolicy,
  type RunProfile,
  type RunProfileAcceptanceCommand,
  type RunProfileCommandSpec,
  type RunProfileRequiredRead,
  type RunProfileRuntime,
  type RunProfileWorkspace,
  type Scenario,
  type ScenarioRoleOverlay,
  type ScenarioTaskMode,
  type StdoutContract,
  type StdoutLineRequirement,
} from "../contracts/four-layer.js";
import { FourLayerLoaderError, type MutableRecord } from "./loader-shared.js";
import { isRecord, toStringArray } from "./authored-validate.js";

export function normalizeAuthoredObject(value: unknown, kind: FourLayerAuthoredObjectKind, filePath: string): unknown {
  if (!isRecord(value)) {
    throw new FourLayerLoaderError(`invalid_${kind}:${filePath}`, ["authored file must be a mapping at the top level"]);
  }

  const record: MutableRecord = { ...value };
  const errors: string[] = [];
  if (record["kind"] !== undefined && record["kind"] !== kind) {
    errors.push(`kind must be ${kind}`);
  }
  if (record["schemaVersion"] !== undefined && record["schemaVersion"] !== FOUR_LAYER_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${FOUR_LAYER_SCHEMA_VERSION}`);
  }
  if (errors.length > 0) {
    throw new FourLayerLoaderError(`invalid_${kind}:${filePath}`, errors);
  }
  record["kind"] = kind;
  record["schemaVersion"] = record["schemaVersion"] ?? FOUR_LAYER_SCHEMA_VERSION;

  switch (kind) {
    case "agent":
      return normalizeAgent(record);
    case "playbook":
      return normalizePlaybook(record);
    case "scenario":
      return normalizeScenario(record);
    case "run_profile":
      return normalizeRunProfile(record);
  }
}

function normalizeAgent(record: MutableRecord): Agent {
  return {
    schemaVersion: FOUR_LAYER_SCHEMA_VERSION,
    kind: "agent",
    name: String(record["name"] ?? ""),
    ...(typeof record["description"] === "string" ? { description: record["description"] } : {}),
    model: String(record["model"] ?? ""),
    system: String(record["system"] ?? ""),
    ...(typeof record["provider"] === "string" ? { provider: record["provider"] } : {}),
    ...(typeof record["mode"] === "string" ? { mode: record["mode"] } : {}),
    ...(typeof record["thinking"] === "string" ? { thinking: record["thinking"] } : {}),
  };
}

function normalizePlaybook(record: MutableRecord): Playbook {
  const audit = isRecord(record["audit"]) ? record["audit"] : undefined;
  return {
    schemaVersion: FOUR_LAYER_SCHEMA_VERSION,
    kind: "playbook",
    name: String(record["name"] ?? ""),
    ...(typeof record["description"] === "string" ? { description: record["description"] } : {}),
    teamLead: String(record["teamLead"] ?? record["team_lead"] ?? ""),
    members: toStringArray(record["members"]),
    workflow: String(record["workflow"] ?? ""),
    ...(audit
      ? {
          audit: {
            ...(Array.isArray(audit["requiredRoles"]) || Array.isArray(audit["required_roles"])
              ? { requiredRoles: toStringArray(audit["requiredRoles"] ?? audit["required_roles"]) }
              : {}),
            ...((typeof audit["maxRevisionCycles"] === "number" || typeof audit["max_revision_cycles"] === "number")
              ? { maxRevisionCycles: Number(audit["maxRevisionCycles"] ?? audit["max_revision_cycles"]) }
              : {}),
            ...(Array.isArray(audit["finalReportSections"]) || Array.isArray(audit["final_report_sections"])
              ? { finalReportSections: toStringArray(audit["finalReportSections"] ?? audit["final_report_sections"]) }
              : {}),
          } satisfies PlaybookAuditPolicy,
        }
      : {}),
  };
}

function normalizeScenario(record: MutableRecord): Scenario {
  const overlays = isRecord(record["overlays"]) ? record["overlays"] : undefined;
  return {
    schemaVersion: FOUR_LAYER_SCHEMA_VERSION,
    kind: "scenario",
    name: String(record["name"] ?? ""),
    ...(typeof record["description"] === "string" ? { description: record["description"] } : {}),
    playbook: String(record["playbook"] ?? ""),
    ...(typeof record["task"] === "string" ? { task: record["task"] } : {}),
    ...(typeof record["taskMode"] === "string" || typeof record["task_mode"] === "string"
      ? { taskMode: String(record["taskMode"] ?? record["task_mode"]) as ScenarioTaskMode }
      : {}),
    ...(typeof record["allowTaskOverride"] === "boolean" || typeof record["allow_task_override"] === "boolean"
      ? { allowTaskOverride: Boolean(record["allowTaskOverride"] ?? record["allow_task_override"]) }
      : {}),
    ...(overlays
      ? {
          overlays: Object.fromEntries(
            Object.entries(overlays).map(([roleName, overlay]) => {
              const normalized = isRecord(overlay)
                ? {
                    ...(typeof overlay["prompt"] === "string" ? { prompt: overlay["prompt"] } : {}),
                    ...(Array.isArray(overlay["knowledgeRefs"]) || Array.isArray(overlay["knowledge_refs"])
                      ? { knowledgeRefs: toStringArray(overlay["knowledgeRefs"] ?? overlay["knowledge_refs"]) }
                      : {}),
                    ...(typeof overlay["rubricRef"] === "string" || typeof overlay["rubric_ref"] === "string"
                      ? { rubricRef: String(overlay["rubricRef"] ?? overlay["rubric_ref"]) }
                      : {}),
                  } satisfies ScenarioRoleOverlay
                : {};
              return [roleName, normalized];
            }),
          ),
        }
      : {}),
  };
}

function normalizeRunProfile(record: MutableRecord): RunProfile {
  const workspace = isRecord(record["workspace"]) ? record["workspace"] : {};
  const worktree = isRecord(workspace["worktree"]) ? workspace["worktree"] : undefined;
  const artifactContract = isRecord(record["artifactContract"] ?? record["artifact_contract"])
    ? (record["artifactContract"] ?? record["artifact_contract"]) as MutableRecord
    : undefined;
  const stdoutContract = isRecord(record["stdoutContract"] ?? record["stdout_contract"])
    ? (record["stdoutContract"] ?? record["stdout_contract"]) as MutableRecord
    : undefined;
  const concurrency = isRecord(record["concurrency"]) ? record["concurrency"] : undefined;
  const approvalGates = isRecord(record["approvalGates"] ?? record["approval_gates"])
    ? (record["approvalGates"] ?? record["approval_gates"]) as MutableRecord
    : undefined;
  const secrets = isRecord(record["secrets"]) ? record["secrets"] : undefined;
  const runtime = isRecord(record["runtime"]) ? record["runtime"] : undefined;
  const preLaunch = approvalGates && isRecord(approvalGates["preLaunch"] ?? approvalGates["pre_launch"])
    ? (approvalGates["preLaunch"] ?? approvalGates["pre_launch"]) as MutableRecord
    : undefined;

  return {
    schemaVersion: FOUR_LAYER_SCHEMA_VERSION,
    kind: "run_profile",
    name: String(record["name"] ?? ""),
    ...(typeof record["description"] === "string" ? { description: record["description"] } : {}),
    workspace: {
      cwd: String(workspace["cwd"] ?? ""),
      ...(worktree
        ? {
            worktree: {
              branch: String(worktree["branch"] ?? ""),
              path: String(worktree["path"] ?? ""),
              ...(typeof worktree["baseRef"] === "string" || typeof worktree["base_ref"] === "string"
                ? { baseRef: String(worktree["baseRef"] ?? worktree["base_ref"]) }
                : {}),
            },
          }
        : {}),
    } satisfies RunProfileWorkspace,
    ...(Array.isArray(record["requiredReads"]) || Array.isArray(record["required_reads"])
      ? { requiredReads: normalizeRequiredReads(record["requiredReads"] ?? record["required_reads"]) }
      : {}),
    ...(Array.isArray(record["acceptanceCommands"]) || Array.isArray(record["acceptance_commands"])
      ? { acceptanceCommands: normalizeAcceptanceCommands(record["acceptanceCommands"] ?? record["acceptance_commands"]) }
      : {}),
    ...(artifactContract
      ? {
          artifactContract: {
            requiredFiles: normalizeArtifactRequiredFiles(artifactContract["requiredFiles"] ?? artifactContract["required_files"]),
          } satisfies ArtifactContract,
        }
      : {}),
    ...(stdoutContract
      ? {
          stdoutContract: {
            requiredLines: normalizeStdoutRequiredLines(stdoutContract["requiredLines"] ?? stdoutContract["required_lines"]),
          } satisfies StdoutContract,
        }
      : {}),
    ...(concurrency && (typeof concurrency["maxActiveChildren"] === "number" || typeof concurrency["max_active_children"] === "number")
      ? { concurrency: { maxActiveChildren: Number(concurrency["maxActiveChildren"] ?? concurrency["max_active_children"]) } }
      : {}),
    ...(approvalGates
      ? {
          approvalGates: {
            ...(preLaunch
              ? {
                  preLaunch: {
                    enabled: Boolean(preLaunch["enabled"]),
                    ...(typeof preLaunch["prompt"] === "string"
                      ? { prompt: String(preLaunch["prompt"]) }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(secrets && (typeof secrets["redact"] === "boolean")
      ? { secrets: { redact: Boolean(secrets["redact"]) } }
      : {}),
    ...(runtime
      ? {
          runtime: {
            ...(typeof runtime["dispatchMode"] === "string" || typeof runtime["dispatch_mode"] === "string"
              ? { dispatchMode: String(runtime["dispatchMode"] ?? runtime["dispatch_mode"]) }
              : {}),
            ...((typeof runtime["lead_timeout_seconds"] === "number" || typeof runtime["leadTimeoutSeconds"] === "number")
              ? { lead_timeout_seconds: Number(runtime["lead_timeout_seconds"] ?? runtime["leadTimeoutSeconds"]) }
              : {}),
          } satisfies RunProfileRuntime,
        }
      : {}),
  };
}

function normalizeRequiredReads(value: unknown): RunProfileRequiredRead[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!isRecord(entry)) {
      return { kind: "" };
    }
    return {
      kind: String(entry["kind"] ?? ""),
      ...(typeof entry["path"] === "string" ? { path: entry["path"] } : {}),
      ...(typeof entry["documentId"] === "string" || typeof entry["doc"] === "string"
        ? { documentId: String(entry["documentId"] ?? entry["doc"]) }
        : {}),
      ...(typeof entry["optional"] === "boolean" ? { optional: entry["optional"] } : {}),
    };
  });
}

function normalizeAcceptanceCommands(value: unknown): RunProfileAcceptanceCommand[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }
    if (!isRecord(entry)) {
      return { cmd: "" };
    }
    return {
      cmd: String(entry["cmd"] ?? ""),
      ...(typeof entry["blockerOk"] === "boolean" || typeof entry["blocker_ok"] === "boolean"
        ? { blockerOk: Boolean(entry["blockerOk"] ?? entry["blocker_ok"]) }
        : {}),
    } satisfies RunProfileCommandSpec;
  });
}

function normalizeArtifactRequiredFiles(value: unknown): Array<string | ArtifactContractFileRequirement> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }
    if (!isRecord(entry)) {
      return { path: "" };
    }
    return {
      path: String(entry["path"] ?? ""),
      ...(Array.isArray(entry["requiredSections"]) || Array.isArray(entry["required_sections"])
        ? { requiredSections: toStringArray(entry["requiredSections"] ?? entry["required_sections"]) }
        : {}),
    } satisfies ArtifactContractFileRequirement;
  });
}

function normalizeStdoutRequiredLines(value: unknown): Array<string | StdoutLineRequirement> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }
    if (!isRecord(entry)) {
      return { pattern: "" };
    }
    return {
      pattern: String(entry["pattern"] ?? ""),
      ...(typeof entry["flags"] === "string" ? { flags: entry["flags"] } : {}),
    } satisfies StdoutLineRequirement;
  });
}
