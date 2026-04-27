import type {
  AgentEvent,
  AgentRoleConfig,
  AgentSession,
  TeamConfig,
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
  }): Promise<void>;

  /** Create the Team Lead session. Implementations subscribe to its events. */
  createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
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

  /** Send a follow-up message into an existing session. */
  sendMessage(input: {
    runId: string;
    sessionId: string;
    message: string;
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
