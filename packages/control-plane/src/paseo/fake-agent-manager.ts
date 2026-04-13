import { randomUUID } from "node:crypto"

import type {
  AgentManager,
  AgentManagerEvent,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentSubscriber,
  ManagedAgent,
  SubscribeOptions,
} from "./types.js"

export interface RunAgentCall {
  agentId: string
  prompt: AgentPromptInput
  options?: AgentRunOptions
}

export class FakeAgentManager implements AgentManager {
  private readonly subscribers = new Set<AgentSubscriber>()
  private readonly agents = new Map<string, ManagedAgent>()

  public readonly runAgentCalls: RunAgentCall[] = []
  public readonly killedAgentIds: string[] = []
  public shouldFailCreateAgent = false
  public shouldFailRunAgent = false
  public nextCreatedAgentPersistence: AgentPersistenceHandle | null = null

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
      persistence: this.nextCreatedAgentPersistence,
      createdAt: new Date(),
      updatedAt: new Date(),
      labels: options?.labels ?? {},
    }

    this.nextCreatedAgentPersistence = null

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

  async killAgent(agentId: string): Promise<void> {
    this.killedAgentIds.push(agentId)
    this.agents.delete(agentId)
  }

  emit(agentId: string, event: AgentStreamEvent, seq?: number, epoch?: string): void {
    const managerEvent: AgentManagerEvent = {
      type: "agent_stream",
      agentId,
      event,
      seq,
      epoch,
    }

    for (const subscriber of this.subscribers) {
      subscriber(managerEvent)
    }
  }

  emitAgentState(agent: ManagedAgent): void {
    for (const subscriber of this.subscribers) {
      subscriber({ type: "agent_state", agent })
    }
  }

  getAgent(agentId: string): ManagedAgent | undefined {
    return this.agents.get(agentId)
  }

  listAgents(): ManagedAgent[] {
    return Array.from(this.agents.values())
  }
}
