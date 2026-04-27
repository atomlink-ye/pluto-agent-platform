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
  | "artifact_created"
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
}
