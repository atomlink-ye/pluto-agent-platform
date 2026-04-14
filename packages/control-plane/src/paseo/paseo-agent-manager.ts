import type {
  AgentManager as ControlPlaneAgentManager,
  AgentManagerEvent as ControlPlaneAgentManagerEvent,
  AgentPromptInput as ControlPlaneAgentPromptInput,
  AgentRunOptions as ControlPlaneAgentRunOptions,
  AgentRunResult as ControlPlaneAgentRunResult,
  AgentSessionConfig as ControlPlaneAgentSessionConfig,
  AgentStreamEvent as ControlPlaneAgentStreamEvent,
  AgentSubscriber,
  ManagedAgent as ControlPlaneManagedAgent,
  McpServerConfig as ControlPlaneMcpServerConfig,
  SubscribeOptions,
} from "./types.js"
import type {
  AgentManager as PaseoKernelAgentManager,
  AgentManagerEvent as PaseoAgentManagerEvent,
  AgentRunResult as PaseoAgentRunResult,
  AgentSessionConfig as PaseoAgentSessionConfig,
  AgentStreamEvent as PaseoAgentStreamEvent,
  ManagedAgent as PaseoManagedAgent,
  McpServerConfig as PaseoMcpServerConfig,
} from "@pluto-agent-platform/paseo"

function mapMcpServerConfig(config: ControlPlaneMcpServerConfig): PaseoMcpServerConfig {
  return {
    type: "stdio",
    command: config.command,
    args: config.args,
    env: config.env,
  }
}

function mapSessionConfigToPaseo(
  config: ControlPlaneAgentSessionConfig,
): PaseoAgentSessionConfig {
  return {
    provider: config.provider,
    cwd: config.cwd,
    systemPrompt: config.systemPrompt,
    modeId: config.modeId,
    model: config.model,
    thinkingOptionId: config.thinkingOptionId,
    featureValues: config.featureValues,
    title: config.title,
    approvalPolicy: config.approvalPolicy,
    sandboxMode: config.sandboxMode,
    networkAccess: config.networkAccess,
    webSearch: config.webSearch,
    internal: config.internal,
    mcpServers: config.mcpServers
      ? Object.fromEntries(
          Object.entries(config.mcpServers).map(([name, serverConfig]) => [
            name,
            mapMcpServerConfig(serverConfig),
          ]),
        )
      : undefined,
  }
}

function mapSessionConfigFromPaseo(
  config: PaseoAgentSessionConfig,
): ControlPlaneAgentSessionConfig {
  const paseoMcpServers = config.mcpServers as Record<string, PaseoMcpServerConfig> | undefined
  const mcpServers = config.mcpServers
    ? Object.fromEntries(
        Object.entries(paseoMcpServers ?? {}).flatMap(([name, serverConfig]) =>
          serverConfig.type === "stdio"
            ? [
                [
                  name,
                  {
                    command: serverConfig.command,
                    args: serverConfig.args,
                    env: serverConfig.env,
                  },
                ],
              ]
            : [],
        ),
      )
    : undefined

  return {
    provider: config.provider,
    cwd: config.cwd,
    systemPrompt: config.systemPrompt,
    modeId: config.modeId,
    model: config.model,
    thinkingOptionId: config.thinkingOptionId,
    featureValues: config.featureValues,
    title: config.title,
    approvalPolicy: config.approvalPolicy,
    sandboxMode: config.sandboxMode,
    networkAccess: config.networkAccess,
    webSearch: config.webSearch,
    internal: config.internal,
    mcpServers,
  }
}

function mapManagedAgent(agent: PaseoManagedAgent): ControlPlaneManagedAgent {
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    lifecycle: agent.lifecycle,
    config: mapSessionConfigFromPaseo(agent.config),
    persistence: agent.persistence,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    labels: agent.labels,
    ...(agent.lastError ? { lastError: agent.lastError } : {}),
  }
}

function mapStreamEvent(event: PaseoAgentStreamEvent): ControlPlaneAgentStreamEvent {
  switch (event.type) {
    case "thread_started":
      return { ...event }
    case "turn_started":
    case "turn_completed":
    case "usage_updated":
    case "turn_failed":
    case "turn_canceled":
    case "attention_required":
    case "timeline":
      return { ...event }
    case "permission_requested":
      return {
        type: "permission_requested",
        provider: event.provider,
        request: {
          id: event.request.id,
          kind: event.request.kind,
          name: event.request.name,
          description: event.request.description ?? event.request.title ?? event.request.name,
          metadata: event.request.metadata,
        },
        turnId: event.turnId,
      }
    case "permission_resolved":
      return {
        type: "permission_resolved",
        provider: event.provider,
        requestId: event.requestId,
        resolution: {
          allowed: event.resolution.behavior === "allow",
          reason: event.resolution.behavior === "deny" ? event.resolution.message : undefined,
        },
        turnId: event.turnId,
      }
  }
}

function mapRunResult(result: PaseoAgentRunResult): ControlPlaneAgentRunResult {
  return { ...result } as ControlPlaneAgentRunResult
}

function mapManagerEvent(event: PaseoAgentManagerEvent): ControlPlaneAgentManagerEvent {
  if (event.type === "agent_state") {
    return {
      type: "agent_state",
      agent: mapManagedAgent(event.agent),
    }
  }

  return {
    type: "agent_stream",
    agentId: event.agentId,
    event: mapStreamEvent(event.event),
    seq: event.seq,
    epoch: event.epoch,
  }
}

export class PaseoAgentManager implements ControlPlaneAgentManager {
  constructor(private readonly manager: PaseoKernelAgentManager) {}

  subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void {
    return this.manager.subscribe(
      (event: PaseoAgentManagerEvent) => callback(mapManagerEvent(event)),
      options,
    )
  }

  async createAgent(
    config: ControlPlaneAgentSessionConfig,
    agentId?: string,
    options?: { labels?: Record<string, string> },
  ): Promise<ControlPlaneManagedAgent> {
    const agent = await this.manager.createAgent(mapSessionConfigToPaseo(config), agentId, options)
    return mapManagedAgent(agent)
  }

  async runAgent(
    agentId: string,
    prompt: ControlPlaneAgentPromptInput,
    options?: ControlPlaneAgentRunOptions,
  ): Promise<ControlPlaneAgentRunResult> {
    const result = await this.manager.runAgent(agentId, prompt, options)
    return mapRunResult(result)
  }

  async killAgent(agentId: string): Promise<void> {
    await this.manager.closeAgent(agentId)
  }

  getAgent(agentId: string): ControlPlaneManagedAgent | undefined {
    const agent = this.manager.getAgent(agentId)
    return agent ? mapManagedAgent(agent) : undefined
  }

  listAgents(): ControlPlaneManagedAgent[] {
    return this.manager.listAgents().map(mapManagedAgent)
  }
}
