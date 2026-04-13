/**
 * Fake AgentManager for testing — implements the AgentManager interface
 * with controllable behavior for unit and integration tests.
 */
import { randomUUID } from "node:crypto"
import type {
  AgentManager,
  AgentManagerEvent,
  AgentStreamEvent,
  AgentSubscriber,
  AgentSessionConfig,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  ManagedAgent,
  SubscribeOptions,
} from "./types.js"

export interface RunAgentCall {
  agentId: string
  prompt: AgentPromptInput
  options?: AgentRunOptions
}

export class FakeAgentManager implements AgentManager {
  private subscribers: Set<AgentSubscriber> = new Set()
  private agents: Map<string, ManagedAgent> = new Map()
  public runAgentCalls: RunAgentCall[] = []
  public shouldFailCreateAgent = false
  public shouldFailRunAgent = false

  subscribe(callback: AgentSubscriber, _options?: SubscribeOptions): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  async createAgent(
    config: AgentSessionConfig,
    agentId?: string,
    options?: { labels?: Record<string, string> },
  ): Promise<ManagedAgent> {
    if (this.shouldFailCreateAgent) {
      throw new Error("Failed to create agent (simulated)")
    }

    const id = agentId ?? `agent_${randomUUID()}`
    const agent: ManagedAgent = {
      id,
      provider: config.provider,
      cwd: config.cwd,
      lifecycle: "idle",
      config,
      persistence: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      labels: options?.labels ?? {},
    }
    this.agents.set(id, agent)
    return agent
  }

  async runAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    if (this.shouldFailRunAgent) {
      throw new Error("Failed to run agent (simulated)")
    }

    this.runAgentCalls.push({ agentId, prompt, options })

    return {
      sessionId: `session_${randomUUID()}`,
      finalText: "Task completed",
      timeline: [],
    }
  }

  getAgent(agentId: string): ManagedAgent | undefined {
    return this.agents.get(agentId)
  }

  listAgents(): ManagedAgent[] {
    return Array.from(this.agents.values())
  }

  // -----------------------------------------------------------------------
  // Test helpers
  // -----------------------------------------------------------------------

  /** Emit an event to all subscribers */
  emit(
    agentId: string,
    event: AgentStreamEvent,
    seq?: number,
    epoch?: string,
  ): void {
    const managerEvent: AgentManagerEvent = {
      type: "agent_stream",
      agentId,
      event,
      seq,
      epoch,
    }
    for (const sub of this.subscribers) {
      sub(managerEvent)
    }
  }

  /** Emit an agent_state event */
  emitAgentState(agent: ManagedAgent): void {
    const event: AgentManagerEvent = { type: "agent_state", agent }
    for (const sub of this.subscribers) {
      sub(event)
    }
  }

  /** Reset all state */
  reset(): void {
    this.subscribers.clear()
    this.agents.clear()
    this.runAgentCalls = []
    this.shouldFailCreateAgent = false
    this.shouldFailRunAgent = false
  }
}
