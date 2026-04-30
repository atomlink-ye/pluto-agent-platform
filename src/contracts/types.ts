/**
 * Pluto MVP-alpha core domain types.
 *
 * The business layer (TeamRunService) depends only on this file and `adapter.ts`.
 * Concrete runtimes (fake, paseo+opencode) live behind the adapter and never
 * leak through these types.
 */

export type AgentRoleId = "lead" | "planner" | "generator" | "evaluator";

export type AgentRoleKind = "team_lead" | "worker";

export interface AgentRoleConfig {
  /** Stable identifier referenced by orchestrator + events. */
  id: AgentRoleId;
  /** Human-readable name (lead/planner/generator/evaluator). */
  name: string;
  kind: AgentRoleKind;
  /** Static description used to seed the agent prompt. */
  systemPrompt: string;
}

export interface TeamConfig {
  /** Stable team identifier. MVP uses a single static team. */
  id: string;
  name: string;
  /** Exactly one role with kind="team_lead". */
  leadRoleId: AgentRoleId;
  roles: AgentRoleConfig[];
}

export interface TeamTask {
  id: string;
  title: string;
  /** Operator-provided goal for the run. */
  prompt: string;
  /** Where worker artifacts may write under (host or container path). */
  workspacePath: string;
  /** Optional path the team should converge on for the final artifact. */
  artifactPath?: string;
  /** Hard floor on workers the lead must dispatch. MVP requires >= 2. */
  minWorkers: number;
}

/** Identifier of a Paseo agent session backing a role. */
export interface AgentSession {
  sessionId: string;
  role: AgentRoleConfig;
  /** Adapter-specific marker. Opaque to business layer. */
  external?: Record<string, unknown>;
}

export type AgentEventType =
  | "run_started"
  | "lead_started"
  | "worker_requested"
  | "worker_started"
  | "worker_completed"
  | "lead_message"
  | "worker_message"
  | "orchestrator_underdispatch_fallback"
  | "artifact_created"
  | "blocker"
  | "retry"
  | "run_completed"
  | "run_failed";

export interface AgentEvent {
  /** ULID-like monotonic id. */
  id: string;
  runId: string;
  /** ISO-8601 timestamp. */
  ts: string;
  type: AgentEventType;
  roleId?: AgentRoleId;
  sessionId?: string;
  /** Free-form structured payload. Adapters MUST keep this JSON-serializable. */
  payload: Record<string, unknown>;
  /**
   * In-memory-only fields that the orchestrator may use during the active run.
   * Persistence paths MUST drop this object entirely.
   */
  transient?: {
    rawPayload?: Record<string, unknown>;
  };
}

/** Persisted `AgentEvent.id` used for cross-event provenance. */
export type PersistedAgentEventId = string;

/**
 * Retry provenance must point to a real persisted failure/blocker event.
 *
 * Lane E will wire this to the exact `AgentEvent.id` of the blocker/failure
 * event that justified the retry. This is intentionally stricter than an
 * attempt label so downstream readers can resolve the provenance in the stored
 * event log.
 */
export interface RetryEventPayloadV0 {
  /** Next worker attempt number that the orchestrator is scheduling. */
  attempt: number;
  reason: BlockerReasonV0;
  /**
   * Persisted `AgentEvent.id` of the real blocker/failure event that triggered
   * this retry. Never use synthetic labels such as `worker-<role>-attempt-<n>`.
   */
  originalEventId: PersistedAgentEventId;
  delayMs: number;
  roleId: AgentRoleId;
}

export interface WorkerContribution {
  roleId: AgentRoleId;
  sessionId: string;
  /** Short text contribution that goes into the artifact. */
  output: string;
}

export interface FinalArtifact {
  runId: string;
  /** Markdown content saved to .pluto/runs/<runId>/artifact.md. */
  markdown: string;
  /** Lead's summary line. */
  leadSummary: string;
  contributions: WorkerContribution[];
}

export interface TeamRunResult {
  runId: string;
  status: "completed" | "failed";
  artifact?: FinalArtifact;
  events: AgentEvent[];
  /** Filled when status = failed. */
  failure?: { message: string; cause?: unknown };
  /** MVP-beta: classified blocker reason. null for successful runs. */
  blockerReason?: BlockerReasonV0 | null;
}

// ---------------------------------------------------------------------------
// MVP-beta v0 types (additive, non-exhaustive)
// ---------------------------------------------------------------------------

export type BlockerReasonV0 =
  | "provider_unavailable"
  | "credential_missing"
  | "quota_exceeded"
  | "capability_unavailable"
  | "runtime_permission_denied"
  | "runtime_timeout"
  | "empty_artifact"
  | "validation_failed"
  | "adapter_protocol_error"
  | "runtime_error"
  | "unknown";

export type EvidencePacketStatusV0 = "done" | "blocked" | "failed";

export interface EvidencePacketV0 {
  schemaVersion: 0;
  runId: string;
  taskTitle: string;
  status: EvidencePacketStatusV0;
  blockerReason: BlockerReasonV0 | null;
  startedAt: string;
  finishedAt: string;
  workspace: string | null;
  workers: Array<{
    role: string;
    sessionId: string | null;
    contributionSummary: string;
    tokenUsageApprox: number | null;
    durationMsApprox: number | null;
  }>;
  validation: {
    outcome: "pass" | "fail" | "na";
    reason: string | null;
  };
  citedInputs: {
    taskPrompt: string;
    workspaceMarkers: string[];
  };
  risks: string[];
  openQuestions: string[];
  classifierVersion: 0;
  generatedAt: string;
}

export interface RunsListItemV0 {
  schemaVersion: 0;
  runId: string;
  taskTitle: string;
  status: "queued" | "running" | "blocked" | "failed" | "done";
  blockerReason: BlockerReasonV0 | null;
  startedAt: string;
  finishedAt: string | null;
  parseWarnings: number;
  workerCount: number;
  artifactPresent: boolean;
  evidencePresent: boolean;
}

export interface RunsListOutputV0 {
  schemaVersion: 0;
  items: RunsListItemV0[];
}

export interface RunsShowOutputV0 {
  schemaVersion: 0;
  runId: string;
  taskTitle: string;
  status: "queued" | "running" | "blocked" | "failed" | "done";
  blockerReason: BlockerReasonV0 | null;
  startedAt: string;
  finishedAt: string | null;
  parseWarnings: number;
  workspace: string | null;
  workers: Array<{
    role: string;
    sessionId: string | null;
    status: "pending" | "running" | "done" | "failed" | "timed_out";
    contributionSummary: string | null;
  }>;
  artifactPath: string | null;
  evidencePath: string | null;
}

export interface RunsEventV0 {
  schemaVersion: 0;
  runId: string;
  eventId: string;
  occurredAt: string;
  role: string | null;
  kind: string;
  attempt: number;
  payload: unknown;
}
