import {
  FOUR_LAYER_SCHEMA_VERSION,
  SCENARIO_TASK_MODES,
  type Agent,
  type FourLayerAuthoredObjectKind,
  type Playbook,
  type RunProfile,
  type Scenario,
} from "../contracts/four-layer.js";
import type { FourLayerValidationResult, MutableRecord } from "./loader-shared.js";

const SCENARIO_TASK_MODE_SET = new Set<string>(SCENARIO_TASK_MODES);

export function validateAgent(value: unknown): FourLayerValidationResult<Agent> {
  const base = validateNamedAuthoredRecord(value, "agent");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  requireString(record, "model", errors);
  requireString(record, "system", errors);
  optionalString(record, "provider", errors);
  optionalString(record, "mode", errors);
  optionalString(record, "thinking", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as Agent }
    : { ok: false, errors };
}

export function validatePlaybook(value: unknown): FourLayerValidationResult<Playbook> {
  const base = validateNamedAuthoredRecord(value, "playbook");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  requireString(record, "teamLead", errors);
  requireStringArray(record, "members", errors);
  requireString(record, "workflow", errors);

  const audit = record["audit"];
  if (audit !== undefined) {
    if (!isRecord(audit)) {
      errors.push("audit must be an object");
    } else {
      optionalStringArray(audit, "requiredRoles", errors, "audit.requiredRoles");
      optionalInteger(audit, "maxRevisionCycles", errors, "audit.maxRevisionCycles", 0);
      optionalStringArray(audit, "finalReportSections", errors, "audit.finalReportSections");
    }
  }

  if (typeof record["teamLead"] === "string" && Array.isArray(record["members"])) {
    const members = record["members"] as unknown[];
    if (members.includes(record["teamLead"])) {
      errors.push("members must not include teamLead");
    }
    const duplicates = findDuplicateStrings(members);
    if (duplicates.length > 0) {
      errors.push(`members contain duplicates: ${duplicates.join(", ")}`);
    }
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as Playbook }
    : { ok: false, errors };
}

export function validateScenario(value: unknown): FourLayerValidationResult<Scenario> {
  const base = validateNamedAuthoredRecord(value, "scenario");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  requireString(record, "playbook", errors);
  optionalString(record, "task", errors);
  optionalBoolean(record, "allowTaskOverride", errors);

  const taskMode = record["taskMode"];
  if (taskMode !== undefined) {
    if (typeof taskMode !== "string" || !SCENARIO_TASK_MODE_SET.has(taskMode)) {
      errors.push(`taskMode must be one of ${SCENARIO_TASK_MODES.join(", ")}`);
    }
  }

  if ((record["taskMode"] ?? "fixed") === "fixed" && typeof record["task"] !== "string") {
    errors.push("fixed scenarios require task");
  }

  const overlays = record["overlays"];
  if (overlays !== undefined) {
    if (!isRecord(overlays)) {
      errors.push("overlays must be an object");
    } else {
      for (const [roleName, overlay] of Object.entries(overlays)) {
        if (!isRecord(overlay)) {
          errors.push(`overlays.${roleName} must be an object`);
          continue;
        }
        optionalString(overlay, "prompt", errors, `overlays.${roleName}.prompt`);
        optionalStringArray(overlay, "knowledgeRefs", errors, `overlays.${roleName}.knowledgeRefs`);
        optionalString(overlay, "rubricRef", errors, `overlays.${roleName}.rubricRef`);
      }
    }
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as Scenario }
    : { ok: false, errors };
}

export function validateRunProfile(value: unknown): FourLayerValidationResult<RunProfile> {
  const base = validateNamedAuthoredRecord(value, "run_profile");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];

  const workspace = record["workspace"];
  if (!isRecord(workspace)) {
    errors.push("workspace must be an object");
  } else {
    requireString(workspace, "cwd", errors, "workspace.cwd");
    const worktree = workspace["worktree"];
    if (worktree !== undefined) {
      if (!isRecord(worktree)) {
        errors.push("workspace.worktree must be an object");
      } else {
        requireString(worktree, "branch", errors, "workspace.worktree.branch");
        requireString(worktree, "path", errors, "workspace.worktree.path");
        optionalString(worktree, "baseRef", errors, "workspace.worktree.baseRef");
      }
    }
  }

  validateRequiredReads(record["requiredReads"], errors);
  validateAcceptanceCommands(record["acceptanceCommands"], errors);
  validateArtifactContract(record["artifactContract"], errors);
  validateStdoutContract(record["stdoutContract"], errors);

  const concurrency = record["concurrency"];
  if (concurrency !== undefined) {
    if (!isRecord(concurrency)) {
      errors.push("concurrency must be an object");
    } else {
      optionalInteger(concurrency, "maxActiveChildren", errors, "concurrency.maxActiveChildren", 0);
    }
  }

  const approvalGates = record["approvalGates"];
  if (approvalGates !== undefined) {
    if (!isRecord(approvalGates)) {
      errors.push("approvalGates must be an object");
    } else {
      const preLaunch = approvalGates["preLaunch"];
      if (preLaunch !== undefined) {
        if (!isRecord(preLaunch)) {
          errors.push("approvalGates.preLaunch must be an object");
        } else {
          requireBoolean(preLaunch, "enabled", errors, "approvalGates.preLaunch.enabled");
          optionalString(preLaunch, "prompt", errors, "approvalGates.preLaunch.prompt");
        }
      }
    }
  }

  const secrets = record["secrets"];
  if (secrets !== undefined) {
    if (!isRecord(secrets)) {
      errors.push("secrets must be an object");
    } else {
      optionalBoolean(secrets, "redact", errors, "secrets.redact");
    }
  }

  const runtime = record["runtime"];
  if (runtime !== undefined) {
    if (!isRecord(runtime)) {
      errors.push("runtime must be an object");
    } else {
      optionalString(runtime, "dispatchMode", errors, "runtime.dispatchMode");
      optionalString(runtime, "dispatch_mode", errors, "runtime.dispatch_mode");
      optionalInteger(runtime, "lead_timeout_seconds", errors, "runtime.lead_timeout_seconds", 1);
    }
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as RunProfile }
    : { ok: false, errors };
}

export function validateByKind(
  kind: FourLayerAuthoredObjectKind,
  value: unknown,
): FourLayerValidationResult<Agent | Playbook | Scenario | RunProfile> {
  switch (kind) {
    case "agent":
      return validateAgent(value);
    case "playbook":
      return validatePlaybook(value);
    case "scenario":
      return validateScenario(value);
    case "run_profile":
      return validateRunProfile(value);
  }
}

export function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function validateNamedAuthoredRecord(
  value: unknown,
  expectedKind: FourLayerAuthoredObjectKind,
): FourLayerValidationResult<MutableRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];
  if (value["schemaVersion"] !== FOUR_LAYER_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${FOUR_LAYER_SCHEMA_VERSION}`);
  }
  if (value["kind"] !== expectedKind) {
    errors.push(`kind must be ${expectedKind}`);
  }
  requireString(value, "name", errors);
  optionalString(value, "description", errors);
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

function validateRequiredReads(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("requiredReads must be an array");
    return;
  }
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`requiredReads[${index}] must be an object`);
      return;
    }
    requireString(entry, "kind", errors, `requiredReads[${index}].kind`);
    optionalString(entry, "path", errors, `requiredReads[${index}].path`);
    optionalString(entry, "documentId", errors, `requiredReads[${index}].documentId`);
    optionalBoolean(entry, "optional", errors, `requiredReads[${index}].optional`);
  });
}

function validateAcceptanceCommands(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("acceptanceCommands must be an array");
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry === "string") return;
    if (!isRecord(entry)) {
      errors.push(`acceptanceCommands[${index}] must be a string or object`);
      return;
    }
    requireString(entry, "cmd", errors, `acceptanceCommands[${index}].cmd`);
    optionalBoolean(entry, "blockerOk", errors, `acceptanceCommands[${index}].blockerOk`);
  });
}

function validateArtifactContract(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push("artifactContract must be an object");
    return;
  }
  const requiredFiles = value["requiredFiles"];
  if (!Array.isArray(requiredFiles)) {
    errors.push("artifactContract.requiredFiles must be an array");
    return;
  }
  requiredFiles.forEach((entry, index) => {
    if (typeof entry === "string") return;
    if (!isRecord(entry)) {
      errors.push(`artifactContract.requiredFiles[${index}] must be a string or object`);
      return;
    }
    requireString(entry, "path", errors, `artifactContract.requiredFiles[${index}].path`);
    optionalStringArray(entry, "requiredSections", errors, `artifactContract.requiredFiles[${index}].requiredSections`);
  });
}

function validateStdoutContract(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push("stdoutContract must be an object");
    return;
  }
  const requiredLines = value["requiredLines"];
  if (!Array.isArray(requiredLines)) {
    errors.push("stdoutContract.requiredLines must be an array");
    return;
  }
  requiredLines.forEach((entry, index) => {
    if (typeof entry === "string") return;
    if (!isRecord(entry)) {
      errors.push(`stdoutContract.requiredLines[${index}] must be a string or object`);
      return;
    }
    requireString(entry, "pattern", errors, `stdoutContract.requiredLines[${index}].pattern`);
    optionalString(entry, "flags", errors, `stdoutContract.requiredLines[${index}].flags`);
  });
}

function requireString(record: MutableRecord, field: string, errors: string[], label = field): void {
  if (typeof record[field] !== "string" || record[field].trim().length === 0) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function optionalString(record: MutableRecord, field: string, errors: string[], label = field): void {
  if (record[field] !== undefined && typeof record[field] !== "string") {
    errors.push(`${label} must be a string`);
  }
}

function requireBoolean(record: MutableRecord, field: string, errors: string[], label = field): void {
  if (typeof record[field] !== "boolean") {
    errors.push(`${label} must be a boolean`);
  }
}

function optionalBoolean(record: MutableRecord, field: string, errors: string[], label = field): void {
  if (record[field] !== undefined && typeof record[field] !== "boolean") {
    errors.push(`${label} must be a boolean`);
  }
}

function optionalInteger(record: MutableRecord, field: string, errors: string[], label = field, min = Number.NEGATIVE_INFINITY): void {
  if (record[field] === undefined) return;
  if (!Number.isInteger(record[field]) || Number(record[field]) < min) {
    errors.push(`${label} must be an integer >= ${min}`);
  }
}

function requireStringArray(record: MutableRecord, field: string, errors: string[], label = field): void {
  if (!Array.isArray(record[field]) || (record[field] as unknown[]).some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    errors.push(`${label} must be an array of non-empty strings`);
  }
}

function optionalStringArray(record: MutableRecord, field: string, errors: string[], label = field): void {
  if (record[field] === undefined) return;
  requireStringArray(record, field, errors, label);
}

function findDuplicateStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}
