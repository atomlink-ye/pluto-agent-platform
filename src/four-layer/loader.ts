import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

import {
  FOUR_LAYER_DIRECTORY_NAMES,
  FOUR_LAYER_FILE_EXTENSIONS,
  FOUR_LAYER_SCHEMA_VERSION,
  SCENARIO_TASK_MODES,
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
  type RunProfileWorkspace,
  type Scenario,
  type ScenarioRoleOverlay,
  type ScenarioTaskMode,
  type StdoutContract,
  type StdoutLineRequirement,
} from "../contracts/four-layer.js";

export const FOUR_LAYER_KNOWLEDGE_MAX_REFS = 3;
export const FOUR_LAYER_KNOWLEDGE_MAX_TOTAL_BYTES = 8_000;
export const FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES = 4_000;

export interface FourLayerValidationError {
  ok: false;
  errors: string[];
}

export interface FourLayerValidationSuccess<T> {
  ok: true;
  value: T;
}

export type FourLayerValidationResult<T> = FourLayerValidationSuccess<T> | FourLayerValidationError;

export interface LoadedFourLayerObject<T> {
  path: string;
  value: T;
}

export interface FourLayerWorkspace {
  rootDir: string;
  agents: Map<string, LoadedFourLayerObject<Agent>>;
  playbooks: Map<string, LoadedFourLayerObject<Playbook>>;
  scenarios: Map<string, LoadedFourLayerObject<Scenario>>;
  runProfiles: Map<string, LoadedFourLayerObject<RunProfile>>;
}

export interface ResolvedTextRef {
  ref: string;
  path: string;
  content: string;
  bytes: number;
}

export interface ResolvedScenarioOverlay {
  roleName: string;
  prompt?: string;
  knowledge?: ResolvedTextRef[];
  rubric?: ResolvedTextRef;
}

export interface ResolvedFourLayerSelection {
  rootDir: string;
  playbook: LoadedFourLayerObject<Playbook>;
  scenario: LoadedFourLayerObject<Scenario>;
  runProfile?: LoadedFourLayerObject<RunProfile>;
  teamLead: LoadedFourLayerObject<Agent>;
  members: LoadedFourLayerObject<Agent>[];
  overlays: Record<string, ResolvedScenarioOverlay>;
}

export class FourLayerLoaderError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "FourLayerLoaderError";
    this.issues = issues;
  }
}

type YamlLine = { raw: string; indent: number; trimmed: string };

type MutableRecord = Record<string, unknown>;

export async function loadFourLayerWorkspace(rootDir: string): Promise<FourLayerWorkspace> {
  const [agents, playbooks, scenarios, runProfiles] = await Promise.all([
    loadKindDirectory(rootDir, "agent", validateAgent),
    loadKindDirectory(rootDir, "playbook", validatePlaybook),
    loadKindDirectory(rootDir, "scenario", validateScenario),
    loadKindDirectory(rootDir, "run_profile", validateRunProfile),
  ]);

  return { rootDir, agents, playbooks, scenarios, runProfiles };
}

export async function loadFourLayerFile<T>(
  filePath: string,
  expectedKind: FourLayerAuthoredObjectKind,
): Promise<LoadedFourLayerObject<T>> {
  const source = await readFile(filePath, "utf8");
  const parsed = parseYaml(source, filePath);
  const normalized = normalizeAuthoredObject(parsed, expectedKind, filePath);
  const validation = validateByKind(expectedKind, normalized);
  if (!validation.ok) {
    throw new FourLayerLoaderError(`invalid_${expectedKind}:${filePath}`, validation.errors);
  }
  return { path: filePath, value: validation.value as T };
}

export async function resolveFourLayerSelection(
  workspace: FourLayerWorkspace,
  selection: { scenario: string; runProfile?: string; playbook?: string },
): Promise<ResolvedFourLayerSelection> {
  const scenario = requireFromMap(workspace.scenarios, selection.scenario, "scenario");
  const playbookName = selection.playbook ?? scenario.value.playbook;
  if (selection.playbook && selection.playbook !== scenario.value.playbook) {
    throw new FourLayerLoaderError(`scenario_playbook_mismatch:${scenario.value.name}`, [
      `scenario ${scenario.value.name} references playbook ${scenario.value.playbook}, not ${selection.playbook}`,
    ]);
  }

  const playbook = requireFromMap(workspace.playbooks, playbookName, "playbook");
  const teamLead = requireFromMap(workspace.agents, playbook.value.teamLead, "agent");
  const members = playbook.value.members.map((memberName) => requireFromMap(workspace.agents, memberName, "agent"));
  const overlayNames = new Set([playbook.value.teamLead, ...playbook.value.members]);
  const overlays = await resolveScenarioOverlays(workspace.rootDir, scenario, overlayNames, members);

  const runProfile = selection.runProfile
    ? requireFromMap(workspace.runProfiles, selection.runProfile, "run_profile")
    : undefined;

  return {
    rootDir: workspace.rootDir,
    playbook,
    scenario,
    runProfile,
    teamLead,
    members,
    overlays,
  };
}

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

  return errors.length === 0
    ? { ok: true, value: record as unknown as RunProfile }
    : { ok: false, errors };
}

export function parseYaml(source: string, filePath = "<inline>"): unknown {
  const lines = source.split(/\r?\n/).map<YamlLine>((raw) => ({
    raw,
    indent: raw.match(/^\s*/)?.[0].length ?? 0,
    trimmed: raw.trim(),
  }));

  const state = { lines, index: 0, filePath };
  skipIgnorable(state);
  if (state.index >= lines.length) {
    return {};
  }
  return parseBlock(state, lines[state.index]!.indent);
}

const SCENARIO_TASK_MODE_SET = new Set<string>(SCENARIO_TASK_MODES);

async function loadKindDirectory<T>(
  rootDir: string,
  kind: FourLayerAuthoredObjectKind,
  validate: (value: unknown) => FourLayerValidationResult<T>,
): Promise<Map<string, LoadedFourLayerObject<T>>> {
  const directoryPath = join(rootDir, FOUR_LAYER_DIRECTORY_NAMES[kind]);
  let entries: string[] = [];
  try {
    entries = await readdir(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const files = entries
    .filter((entry) => FOUR_LAYER_FILE_EXTENSIONS.includes(extname(entry) as typeof FOUR_LAYER_FILE_EXTENSIONS[number]))
    .sort();

  const loaded = await Promise.all(files.map(async (entry) => {
    const filePath = join(directoryPath, entry);
    const source = await readFile(filePath, "utf8");
    const parsed = parseYaml(source, filePath);
    const normalized = normalizeAuthoredObject(parsed, kind, filePath);
    const validation = validate(normalized);
    if (!validation.ok) {
      throw new FourLayerLoaderError(`invalid_${kind}:${filePath}`, validation.errors);
    }
    return { filePath, value: validation.value };
  }));

  const map = new Map<string, LoadedFourLayerObject<T>>();
  for (const item of loaded) {
    const name = (item.value as { name: string }).name;
    if (map.has(name)) {
      throw new FourLayerLoaderError(`duplicate_${kind}:${name}`, [
        `${kind} ${name} is defined more than once`,
      ]);
    }
    map.set(name, { path: item.filePath, value: item.value });
  }
  return map;
}

function validateByKind(
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

function normalizeAuthoredObject(value: unknown, kind: FourLayerAuthoredObjectKind, filePath: string): unknown {
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

async function resolveScenarioOverlays(
  rootDir: string,
  scenario: LoadedFourLayerObject<Scenario>,
  allowedRoles: Set<string>,
  members: LoadedFourLayerObject<Agent>[],
): Promise<Record<string, ResolvedScenarioOverlay>> {
  const overlays = scenario.value.overlays ?? {};
  const memberNames = new Set(members.map((member) => member.value.name));
  const resolved: Record<string, ResolvedScenarioOverlay> = {};

  for (const [roleName, overlay] of Object.entries(overlays)) {
    if (!allowedRoles.has(roleName)) {
      throw new FourLayerLoaderError(`unknown_overlay_role:${scenario.value.name}`, [
        `scenario ${scenario.value.name} overlay targets unknown role ${roleName}`,
      ]);
    }

    const knowledge = await resolveKnowledgeRefs(rootDir, scenario.path, scenario.value.name, roleName, overlay.knowledgeRefs ?? []);
    let rubric: ResolvedTextRef | undefined;
    if (overlay.rubricRef) {
      if (roleName !== "evaluator") {
        throw new FourLayerLoaderError(`invalid_rubric_role:${scenario.value.name}`, [
          `scenario ${scenario.value.name} can only attach rubricRef to evaluator, not ${roleName}`,
        ]);
      }
      if (!memberNames.has(roleName)) {
        throw new FourLayerLoaderError(`missing_rubric_role:${scenario.value.name}`, [
          `scenario ${scenario.value.name} references evaluator rubric but playbook has no evaluator member`,
        ]);
      }
      rubric = await resolveTextRef(rootDir, scenario.path, overlay.rubricRef, `scenario ${scenario.value.name} overlay ${roleName} rubricRef`);
    }

    resolved[roleName] = {
      roleName,
      ...(overlay.prompt ? { prompt: overlay.prompt } : {}),
      ...(knowledge.length > 0 ? { knowledge } : {}),
      ...(rubric ? { rubric } : {}),
    };
  }

  return resolved;
}

async function resolveKnowledgeRefs(
  rootDir: string,
  scenarioPath: string,
  scenarioName: string,
  roleName: string,
  refs: string[],
): Promise<ResolvedTextRef[]> {
  if (refs.length > FOUR_LAYER_KNOWLEDGE_MAX_REFS) {
    throw new FourLayerLoaderError(`knowledge_ref_limit_exceeded:${scenarioName}:${roleName}`, [
      `scenario ${scenarioName} overlay ${roleName} exceeds knowledge ref cap ${FOUR_LAYER_KNOWLEDGE_MAX_REFS}`,
    ]);
  }

  const resolved = await Promise.all(
    refs.map((ref) => resolveTextRef(rootDir, scenarioPath, ref, `scenario ${scenarioName} overlay ${roleName} knowledge ref`)),
  );

  let totalBytes = 0;
  for (const entry of resolved) {
    if (entry.bytes > FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES) {
      throw new FourLayerLoaderError(`knowledge_ref_too_large:${scenarioName}:${roleName}`, [
        `${entry.ref} exceeds per-ref cap ${FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES}`,
      ]);
    }
    totalBytes += entry.bytes;
  }

  if (totalBytes > FOUR_LAYER_KNOWLEDGE_MAX_TOTAL_BYTES) {
    throw new FourLayerLoaderError(`knowledge_total_too_large:${scenarioName}:${roleName}`, [
      `scenario ${scenarioName} overlay ${roleName} exceeds total knowledge cap ${FOUR_LAYER_KNOWLEDGE_MAX_TOTAL_BYTES}`,
    ]);
  }

  return resolved;
}

async function resolveTextRef(
  rootDir: string,
  scenarioPath: string,
  ref: string,
  label: string,
): Promise<ResolvedTextRef> {
  const candidatePaths = new Set<string>();
  if (isAbsolute(ref)) {
    candidatePaths.add(ref);
  } else {
    candidatePaths.add(resolve(rootDir, ref));
    candidatePaths.add(resolve(dirname(scenarioPath), ref));
  }

  for (const path of candidatePaths) {
    try {
      const content = await readFile(path, "utf8");
      return { ref, path, content, bytes: Buffer.byteLength(content, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new FourLayerLoaderError(`missing_ref:${ref}`, [`${label} not found: ${ref}`]);
}

function requireFromMap<T>(
  map: Map<string, LoadedFourLayerObject<T>>,
  name: string,
  kind: FourLayerAuthoredObjectKind,
): LoadedFourLayerObject<T> {
  const value = map.get(name);
  if (!value) {
    throw new FourLayerLoaderError(`missing_${kind}:${name}`, [`missing ${kind} reference: ${name}`]);
  }
  return value;
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

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
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

function skipIgnorable(state: { lines: YamlLine[]; index: number }): void {
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]!;
    if (line.trimmed === "" || line.trimmed.startsWith("#")) {
      state.index += 1;
      continue;
    }
    break;
  }
}

function parseBlock(state: { lines: YamlLine[]; index: number; filePath: string }, indent: number): unknown {
  const line = state.lines[state.index]!;
  if (line.trimmed.startsWith("- ")) {
    return parseSequence(state, indent);
  }
  return parseMapping(state, indent);
}

function parseMapping(state: { lines: YamlLine[]; index: number; filePath: string }, indent: number): MutableRecord {
  const result: MutableRecord = {};

  while (state.index < state.lines.length) {
    skipIgnorable(state);
    if (state.index >= state.lines.length) break;
    const line = state.lines[state.index]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new FourLayerLoaderError(`invalid_yaml:${state.filePath}`, [`unexpected indentation at line ${state.index + 1}`]);
    }
    if (line.trimmed.startsWith("- ")) break;

    const separatorIndex = findKeySeparator(line.trimmed);
    if (separatorIndex < 0) {
      throw new FourLayerLoaderError(`invalid_yaml:${state.filePath}`, [`expected key:value at line ${state.index + 1}`]);
    }

    const key = line.trimmed.slice(0, separatorIndex).trim();
    const rest = line.trimmed.slice(separatorIndex + 1).trim();
    state.index += 1;

    if (rest === "|" || rest === "|-") {
      result[key] = parseBlockScalar(state, indent + 2);
      continue;
    }

    if (rest.length === 0) {
      skipIgnorable(state);
      if (state.index < state.lines.length && state.lines[state.index]!.indent > indent) {
        result[key] = parseBlock(state, state.lines[state.index]!.indent);
      } else {
        result[key] = null;
      }
      continue;
    }

    result[key] = parseScalar(rest, state.filePath, state.index);
  }

  return result;
}

function parseSequence(state: { lines: YamlLine[]; index: number; filePath: string }, indent: number): unknown[] {
  const result: unknown[] = [];

  while (state.index < state.lines.length) {
    skipIgnorable(state);
    if (state.index >= state.lines.length) break;
    const line = state.lines[state.index]!;
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.trimmed.startsWith("- ")) break;

    const rest = line.trimmed.slice(2).trim();
    state.index += 1;

    if (rest === "|" || rest === "|-") {
      result.push(parseBlockScalar(state, indent + 2));
      continue;
    }

    if (rest.length === 0) {
      skipIgnorable(state);
      if (state.index < state.lines.length && state.lines[state.index]!.indent > indent) {
        result.push(parseBlock(state, state.lines[state.index]!.indent));
      } else {
        result.push(null);
      }
      continue;
    }

    const separatorIndex = findKeySeparator(rest);
    const nextSignificantLine = peekNextSignificantLine(state);
    if (
      separatorIndex > 0
      && !rest.startsWith("{")
      && !rest.startsWith("[")
      && (
        rest.slice(separatorIndex + 1).trim().length > 0
        || (nextSignificantLine !== null && nextSignificantLine.indent > indent)
      )
    ) {
      const key = rest.slice(0, separatorIndex).trim();
      const valueText = rest.slice(separatorIndex + 1).trim();
      const item: MutableRecord = {
        [key]: valueText === "" ? null : parseScalar(valueText, state.filePath, state.index),
      };
      skipIgnorable(state);
      if (state.index < state.lines.length && state.lines[state.index]!.indent > indent) {
        const nested = parseBlock(state, state.lines[state.index]!.indent);
        if (!isRecord(nested)) {
          throw new FourLayerLoaderError(`invalid_yaml:${state.filePath}`, [`sequence mapping item at line ${state.index} must continue with mapping content`]);
        }
        Object.assign(item, nested);
      }
      result.push(item);
      continue;
    }

    result.push(parseScalar(rest, state.filePath, state.index));
  }

  return result;
}

function peekNextSignificantLine(state: { lines: YamlLine[]; index: number }): YamlLine | null {
  let index = state.index;
  while (index < state.lines.length) {
    const line = state.lines[index]!;
    if (line.trimmed !== "" && !line.trimmed.startsWith("#")) {
      return line;
    }
    index += 1;
  }
  return null;
}

function parseBlockScalar(state: { lines: YamlLine[]; index: number }, indent: number): string {
  const lines: string[] = [];
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]!;
    if (line.trimmed !== "" && line.indent < indent) {
      break;
    }
    if (line.trimmed === "") {
      lines.push("");
      state.index += 1;
      continue;
    }
    lines.push(line.raw.slice(Math.min(indent, line.raw.length)));
    state.index += 1;
  }
  return lines.join("\n");
}

function parseScalar(value: string, filePath: string, lineNumber: number): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInline(value.slice(1, -1)).map((entry) => parseScalar(entry, filePath, lineNumber));
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const record: MutableRecord = {};
    for (const entry of splitInline(value.slice(1, -1))) {
      const separatorIndex = findKeySeparator(entry);
      if (separatorIndex < 0) {
        throw new FourLayerLoaderError(`invalid_yaml:${filePath}`, [`invalid inline mapping at line ${lineNumber}`]);
      }
      const key = entry.slice(0, separatorIndex).trim();
      record[key] = parseScalar(entry.slice(separatorIndex + 1).trim(), filePath, lineNumber);
    }
    return record;
  }
  return stripTrailingComment(value);
}

function stripTrailingComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble && index > 0 && /\s/.test(value[index - 1]!)) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function splitInline(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (const char of value) {
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (char === "[" || char === "{") depth += 1;
      if (char === "]" || char === "}") depth -= 1;
      if (char === "," && depth === 0) {
        if (current.trim().length > 0) result.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }

  if (current.trim().length > 0) result.push(current.trim());
  return result;
}

function findKeySeparator(value: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (char === "[" || char === "{") depth += 1;
      if (char === "]" || char === "}") depth -= 1;
      if (char === ":" && depth === 0) return index;
    }
  }
  return -1;
}
