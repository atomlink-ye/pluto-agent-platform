export const FOUR_LAYER_SCHEMA_VERSION = 0 as const;

export const FOUR_LAYER_AUTHORED_OBJECT_KINDS = [
  "agent",
  "playbook",
  "scenario",
  "run_profile",
] as const;

export const FOUR_LAYER_RUNTIME_OBJECT_KINDS = [
  "run",
  "evidence_packet",
] as const;

export const FOUR_LAYER_OBJECT_KINDS = [
  ...FOUR_LAYER_AUTHORED_OBJECT_KINDS,
  ...FOUR_LAYER_RUNTIME_OBJECT_KINDS,
] as const;

export const FOUR_LAYER_DIRECTORY_NAMES = {
  agent: "agents",
  playbook: "playbooks",
  scenario: "scenarios",
  run_profile: "run-profiles",
} as const;

export const FOUR_LAYER_FILE_EXTENSIONS = [".yaml", ".yml"] as const;

export const SCENARIO_TASK_MODES = ["fixed", "template"] as const;

export const RUN_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "failed_audit",
  "cancelled",
] as const;

export const REQUIRED_READ_KINDS = ["repo", "external_document"] as const;

export const COORDINATION_CHANNEL_KINDS = ["shared_channel", "transcript"] as const;

export type FourLayerAuthoredObjectKind = typeof FOUR_LAYER_AUTHORED_OBJECT_KINDS[number];
export type FourLayerRuntimeObjectKind = typeof FOUR_LAYER_RUNTIME_OBJECT_KINDS[number];
export type FourLayerObjectKind = typeof FOUR_LAYER_OBJECT_KINDS[number];
export type ScenarioTaskMode = typeof SCENARIO_TASK_MODES[number];
export type RunStatus = typeof RUN_STATUSES[number];
export type RequiredReadKind = typeof REQUIRED_READ_KINDS[number];
export type CoordinationChannelKind = typeof COORDINATION_CHANNEL_KINDS[number];

export interface FourLayerSchemaHeader<TKind extends FourLayerObjectKind> {
  schemaVersion: typeof FOUR_LAYER_SCHEMA_VERSION;
  kind: TKind;
}

export interface AuthoredNamedObject<TKind extends FourLayerAuthoredObjectKind>
  extends FourLayerSchemaHeader<TKind> {
  name: string;
  description?: string;
}

export interface Agent extends AuthoredNamedObject<"agent"> {
  model: string;
  system: string;
  provider?: string;
  mode?: string;
  thinking?: string;
}

export interface PlaybookAuditPolicy {
  requiredRoles?: string[];
  maxRevisionCycles?: number;
  finalReportSections?: string[];
}

export interface Playbook extends AuthoredNamedObject<"playbook"> {
  teamLead: string;
  members: string[];
  workflow: string;
  audit?: PlaybookAuditPolicy;
}

export interface ScenarioRoleOverlay {
  prompt?: string;
  knowledgeRefs?: string[];
  rubricRef?: string;
}

export interface Scenario extends AuthoredNamedObject<"scenario"> {
  playbook: string;
  task?: string;
  taskMode?: ScenarioTaskMode;
  allowTaskOverride?: boolean;
  overlays?: Record<string, ScenarioRoleOverlay>;
}

export interface RunProfileWorktree {
  branch: string;
  path: string;
  baseRef?: string;
}

export interface RunProfileWorkspace {
  cwd: string;
  worktree?: RunProfileWorktree;
}

export interface RunProfileRequiredRead {
  kind: RequiredReadKind | string;
  path?: string;
  documentId?: string;
  optional?: boolean;
}

export interface RunProfileCommandSpec {
  cmd: string;
  blockerOk?: boolean;
}

export type RunProfileAcceptanceCommand = string | RunProfileCommandSpec;

export interface ArtifactContractFileRequirement {
  path: string;
  requiredSections?: string[];
}

export interface ArtifactContract {
  requiredFiles: Array<string | ArtifactContractFileRequirement>;
}

export interface StdoutLineRequirement {
  pattern: string;
  flags?: string;
}

export interface StdoutContract {
  requiredLines: Array<string | StdoutLineRequirement>;
}

export interface ConcurrencyPolicy {
  maxActiveChildren?: number;
}

export interface ApprovalGate {
  enabled: boolean;
  prompt?: string;
}

export interface ApprovalGates {
  preLaunch?: ApprovalGate;
}

export interface SecretHandlingPolicy {
  redact?: boolean;
}

export interface RunProfile extends AuthoredNamedObject<"run_profile"> {
  workspace: RunProfileWorkspace;
  requiredReads?: RunProfileRequiredRead[];
  acceptanceCommands?: RunProfileAcceptanceCommand[];
  artifactContract?: ArtifactContract;
  stdoutContract?: StdoutContract;
  concurrency?: ConcurrencyPolicy;
  approvalGates?: ApprovalGates;
  secrets?: SecretHandlingPolicy;
}

export interface CoordinationChannelRef {
  kind: CoordinationChannelKind;
  locator: string;
  path?: string;
}

export interface RunArtifactRef {
  path: string;
  label?: string;
}

export interface Run extends FourLayerSchemaHeader<"run"> {
  runId: string;
  playbook: string;
  scenario: string;
  runProfile: string;
  status: RunStatus;
  task?: string;
  workspace?: RunProfileWorkspace;
  coordinationChannel?: CoordinationChannelRef;
  artifacts?: RunArtifactRef[];
  startedAt?: string;
  finishedAt?: string;
}

export interface EvidenceCommandResult {
  cmd: string;
  exitCode: number;
  summary?: string;
  stdoutPath?: string;
  stderrPath?: string;
  blockerOk?: boolean;
  startedAt?: string;
  finishedAt?: string;
}

export interface EvidenceTransition {
  from: string;
  to: string;
  observedAt: string;
  note?: string;
  source?: string;
  citationPaths?: string[];
}

export interface EvidenceRoleCitation {
  role: string;
  artifactPath?: string;
  summary?: string;
  quote?: string;
  sourcePath?: string;
}

export interface EvidenceLineage {
  stdoutPath?: string;
  transcriptPath?: string;
  finalReportPath?: string;
  acceptanceOk?: boolean;
  auditOk?: boolean;
}

export interface EvidencePacket extends FourLayerSchemaHeader<"evidence_packet"> {
  runId: string;
  status: RunStatus;
  summary?: string;
  failureReason?: string | null;
  issues?: string[];
  coordinationChannel?: CoordinationChannelRef;
  artifactRefs?: RunArtifactRef[];
  commandResults?: EvidenceCommandResult[];
  transitions?: EvidenceTransition[];
  roleCitations?: EvidenceRoleCitation[];
  lineage?: EvidenceLineage;
  generatedAt: string;
}
