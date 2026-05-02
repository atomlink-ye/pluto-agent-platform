import type {
  AgentEvent,
  AgentRoleConfig,
  AgentSession,
  CoordinationTranscriptRefV0,
  TeamConfig,
  TeamPlaybookV0,
  TeamTask,
} from "./types.js";

/**
 * The single seam between Pluto's orchestrator and any agent runtime
 * (fake adapter for tests, Paseo+OpenCode for live smoke).
 *
 * Implementations must keep all runtime-specific concepts (Paseo agent IDs,
 * OpenCode session handles, model names, CLI flags) inside `external` payloads.
 */
export interface PaseoTeamAdapter {
  /** Bootstrap any per-run state. Returns a stable adapter run handle. */
  startRun(input: {
    runId: string;
    task: TeamTask;
    team: TeamConfig;
    playbook?: TeamPlaybookV0;
    transcript?: CoordinationTranscriptRefV0;
  }): Promise<void>;

  /** Create the Team Lead session. Implementations subscribe to its events. */
  createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
    playbook?: TeamPlaybookV0;
    transcript?: CoordinationTranscriptRefV0;
  }): Promise<AgentSession>;

  /**
   * Create a worker session in response to a lead handoff. Implementations
   * MUST emit `worker_started` and (eventually) `worker_completed` events.
   */
  createWorkerSession(input: {
    runId: string;
    role: AgentRoleConfig;
    instructions: string;
  }): Promise<AgentSession>;

  /**
   * Optional TeamLead-direct teammate spawn seam.
   *
   * In iteration `pluto-regression-fix-20260501`, the shipped direct lane is a
   * Pluto-mediated bridge: when this hook is absent, or an implementation
   * explicitly reports that host spawning is unsupported, Pluto falls back to
   * `createWorkerSession()` while still enforcing the TeamLead-authored
   * playbook against the durable transcript.
   *
   * The fully agent-driven path arrives when an adapter can honor this hook by
   * delegating teammate creation to a runtime with shell/Paseo CLI access.
   */
  spawnTeammate?(input: {
    runId: string;
    stageId: string;
    role: AgentRoleConfig;
    instructions: string;
    dependencies: string[];
    transcript: CoordinationTranscriptRefV0;
  }): Promise<{ workerSessionId: string }>;

  /** Send a follow-up message into an existing session. */
  sendMessage(input: {
    runId: string;
    sessionId: string;
    message: string;
  }): Promise<void>;

  /** Deliver a non-summary message into an existing session. */
  sendSessionMessage(input: {
    runId: string;
    sessionId: string;
    message: string;
    wait?: boolean;
  }): Promise<void>;

  /** Resolve a role's active session for this run, then deliver a message. */
  sendRoleMessage(input: {
    runId: string;
    roleId: string;
    message: string;
    wait?: boolean;
  }): Promise<void>;

  /**
   * Pull the next batch of agent events. Implementations should buffer and
   * return events in arrival order, never replaying duplicates.
   */
  readEvents(input: { runId: string }): Promise<AgentEvent[]>;

  /**
   * Block until the team run reaches a terminal state, or `timeoutMs` elapses.
   * Returns the residual buffered events.
   */
  waitForCompletion(input: {
    runId: string;
    timeoutMs: number;
  }): Promise<AgentEvent[]>;

  /** Tear down sessions, processes, watchers. Idempotent. */
  endRun(input: { runId: string }): Promise<void>;
}

export interface PaseoTeamAdapterFactory {
  create(): PaseoTeamAdapter | Promise<PaseoTeamAdapter>;
}
