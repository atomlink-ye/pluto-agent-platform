/**
 * Local Paseo-facing types.
 *
 * The control plane defines its own interfaces instead of importing Paseo
 * directly so runtime integration stays behind a stable boundary.
 */

export type AgentProvider = string

export interface AgentUsage {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  totalCostUsd?: number
  contextWindowMaxTokens?: number
  contextWindowUsedTokens?: number
}

export interface AgentPermissionRequest {
  id: string
  kind: string
  name: string
  description: string
  metadata?: Record<string, unknown>
}

export interface AgentPermissionResponse {
  allowed: boolean
  reason?: string
}

export interface AgentTimelineItem {
  type: string
  name?: string
  toolName?: string
  status?: string
  input?: Record<string, unknown>
  arguments?: Record<string, unknown>
  args?: Record<string, unknown>
  params?: Record<string, unknown>
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type AgentStreamEvent =
  | {
      type: "thread_started"
      sessionId: string
      provider: AgentProvider
    }
  | {
      type: "turn_started"
      provider: AgentProvider
      turnId?: string
      phase?: string
      stageId?: string
    }
  | {
      type: "turn_completed"
      provider: AgentProvider
      usage?: AgentUsage
      turnId?: string
      phase?: string
      stageId?: string
    }
  | {
      type: "turn_failed"
      provider: AgentProvider
      error: string
      code?: string
      diagnostic?: string
      turnId?: string
      phase?: string
      stageId?: string
      severity?: "stage" | "run" | "fatal"
    }
  | {
      type: "turn_canceled"
      provider: AgentProvider
      reason?: string
      turnId?: string
      phase?: string
      stageId?: string
    }
  | {
      type: "permission_requested"
      provider: AgentProvider
      request: AgentPermissionRequest
      turnId?: string
    }
  | {
      type: "permission_resolved"
      provider: AgentProvider
      requestId: string
      resolution: AgentPermissionResponse
      turnId?: string
    }
  | {
      type: "attention_required"
      provider: AgentProvider
      reason: "finished" | "error" | "permission"
      timestamp: string
      error?: string
    }
  | {
      type: "timeline"
      item: AgentTimelineItem
      provider: AgentProvider
      turnId?: string
    }

export type AgentManagerEvent =
  | { type: "agent_state"; agent: ManagedAgent }
  | {
      type: "agent_stream"
      agentId: string
      event: AgentStreamEvent
      seq?: number
      epoch?: string
    }

export type AgentSubscriber = (event: AgentManagerEvent) => void

export interface SubscribeOptions {
  agentId?: string
  replayState?: boolean
}

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface AgentSessionConfig {
  provider: AgentProvider
  cwd: string
  systemPrompt?: string
  modeId?: string
  model?: string
  mcpServers?: Record<string, McpServerConfig>
  thinkingOptionId?: string
  featureValues?: Record<string, unknown>
  title?: string | null
  approvalPolicy?: string
  sandboxMode?: string
  networkAccess?: boolean
  webSearch?: boolean
  internal?: boolean
}

export interface AgentPersistenceHandle {
  provider: AgentProvider
  sessionId: string
  nativeHandle?: string
  metadata?: Record<string, unknown>
}

export type AgentLifecycle = "initializing" | "idle" | "running" | "error" | "closed"

export interface ManagedAgent {
  id: string
  provider: AgentProvider
  cwd: string
  lifecycle: AgentLifecycle
  config: AgentSessionConfig
  persistence: AgentPersistenceHandle | null
  createdAt: Date
  updatedAt: Date
  lastError?: string
  labels: Record<string, string>
}

export type AgentPromptContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }

export type AgentPromptInput = string | AgentPromptContentBlock[]

export interface AgentRunOptions {
  outputSchema?: unknown
  resumeFrom?: AgentPersistenceHandle
  maxThinkingTokens?: number
}

export interface AgentRunResult {
  sessionId: string
  finalText: string
  usage?: AgentUsage
  timeline: AgentTimelineItem[]
  canceled?: boolean
}

export interface AgentManager {
  subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void
  createAgent(
    config: AgentSessionConfig,
    agentId?: string,
    options?: { labels?: Record<string, string> },
  ): Promise<ManagedAgent>
  runAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult>
  getAgent?(agentId: string): ManagedAgent | undefined
  listAgents?(): ManagedAgent[]
}
