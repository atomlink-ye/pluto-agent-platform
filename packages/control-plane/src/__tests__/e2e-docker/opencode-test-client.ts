import { randomUUID } from "node:crypto"

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
  AgentUsage,
} from "@pluto-agent-platform/paseo"

const OPENCODE_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
}

const DEFAULT_MODE: AgentMode = {
  id: "default",
  label: "Default",
}

const DEFAULT_MODELS: AgentModelDefinition[] = [
  {
    provider: "opencode",
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    isDefault: true,
  },
  {
    provider: "opencode",
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
  },
]

export interface OpenCodeDeliveredPrompt {
  agentId: string
  opencodeSessionId: string
  prompt: string
}

export class OpenCodeTestAgentClient implements AgentClient {
  readonly provider = "opencode"
  readonly capabilities = OPENCODE_CAPABILITIES

  readonly deliveredPrompts: OpenCodeDeliveredPrompt[] = []

  private readonly sessionsByAgentId = new Map<string, OpenCodeTestSession>()
  private readonly sessionsByOpencodeSessionId = new Map<string, OpenCodeTestSession>()

  constructor(private readonly baseUrl: string) {}

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const agentId = launchContext?.env?.PASEO_AGENT_ID ?? `agent_${randomUUID()}`
    const directory = config.cwd
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/session?directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: config.title ?? `agent-${agentId}`,
        env: launchContext?.env ?? {},
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create OpenCode session: ${response.status} ${response.statusText}`)
    }

    const payload = (await response.json()) as { id?: string }
    if (!payload.id) {
      throw new Error("OpenCode session response missing id")
    }

    const session = new OpenCodeTestSession({
      agentId,
      opencodeSessionId: payload.id,
      baseUrl: this.baseUrl,
      config,
      onDeliveredPrompt: (prompt) => this.deliveredPrompts.push(prompt),
    })

    this.sessionsByAgentId.set(agentId, session)
    this.sessionsByOpencodeSessionId.set(payload.id, session)
    return session
  }

  async resumeSession(handle: AgentPersistenceHandle): Promise<AgentSession> {
    const existing = this.sessionsByOpencodeSessionId.get(handle.sessionId)
    if (existing) {
      return existing
    }

    const session = new OpenCodeTestSession({
      agentId: `agent_${randomUUID()}`,
      opencodeSessionId: handle.sessionId,
      baseUrl: this.baseUrl,
      config: {
        provider: "opencode",
        cwd: process.cwd(),
      },
      onDeliveredPrompt: (prompt) => this.deliveredPrompts.push(prompt),
    })

    this.sessionsByOpencodeSessionId.set(handle.sessionId, session)
    return session
  }

  async listModels(): Promise<AgentModelDefinition[]> {
    return DEFAULT_MODELS
  }

  async listModes(): Promise<AgentMode[]> {
    return [DEFAULT_MODE]
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/healthz`)
      return response.ok
    } catch {
      return false
    }
  }

  getSessionByAgentId(agentId: string): OpenCodeTestSession | undefined {
    return this.sessionsByAgentId.get(agentId)
  }
}

interface OpenCodeTestSessionOptions {
  agentId: string
  opencodeSessionId: string
  baseUrl: string
  config: AgentSessionConfig
  onDeliveredPrompt: (prompt: OpenCodeDeliveredPrompt) => void
}

export class OpenCodeTestSession implements AgentSession {
  readonly provider = "opencode"
  readonly capabilities = OPENCODE_CAPABILITIES
  readonly id: string

  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>()
  private readonly timeline: AgentTimelineItem[] = []
  private readonly turnUsage: AgentUsage = {}
  private readonly currentModeId: string | null = DEFAULT_MODE.id
  private readonly baseUrl: string
  private readonly config: AgentSessionConfig
  private readonly agentId: string
  private readonly onDeliveredPrompt: OpenCodeTestSessionOptions["onDeliveredPrompt"]
  private threadStarted = false

  constructor(options: OpenCodeTestSessionOptions) {
    this.id = options.opencodeSessionId
    this.baseUrl = options.baseUrl
    this.config = options.config
    this.agentId = options.agentId
    this.onDeliveredPrompt = options.onDeliveredPrompt
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const { turnId } = await this.startTurn(prompt, options)
    return new Promise<AgentRunResult>((resolve, reject) => {
      const unsubscribe = this.subscribe((event) => {
        if (event.type === "turn_completed" && event.turnId === turnId) {
          unsubscribe()
          resolve({
            sessionId: this.id,
            finalText: this.getLastAssistantText(),
            usage: event.usage,
            timeline: [...this.timeline],
          })
        }

        if (event.type === "turn_failed") {
          unsubscribe()
          reject(new Error(event.error))
        }
      })
    })
  }

  async startTurn(prompt: AgentPromptInput, _options?: AgentRunOptions): Promise<{ turnId: string }> {
    const turnId = `turn_${randomUUID()}`
    queueMicrotask(() => {
      void this.runTurn(turnId, normalizePrompt(prompt))
    })
    return { turnId }
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const item of this.timeline) {
      yield { type: "timeline", item, provider: this.provider }
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? DEFAULT_MODELS[0]?.id ?? null,
      modeId: this.currentModeId,
    }
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [DEFAULT_MODE]
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentModeId
  }

  async setMode(_modeId: string): Promise<void> {}

  getPendingPermissions() {
    return []
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return {
      provider: this.provider,
      sessionId: this.id,
      metadata: {
        cwd: this.config.cwd,
      },
    }
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}

  emitTimeline(item: AgentTimelineItem & Record<string, unknown>, turnId?: string): void {
    this.timeline.push(item)
    this.notify({
      type: "timeline",
      item,
      provider: this.provider,
      turnId,
    })
  }

  emitAttentionRequired(reason: "finished" | "error" | "permission", error?: string): void {
    this.notify({
      type: "attention_required",
      provider: this.provider,
      reason,
      timestamp: new Date().toISOString(),
    })

    if (error) {
      this.emitTimeline({
        type: "error",
        message: error,
      })
    }
  }

  private async runTurn(turnId: string, prompt: string): Promise<void> {
    try {
      if (!this.threadStarted) {
        this.threadStarted = true
        this.notify({
          type: "thread_started",
          provider: this.provider,
          sessionId: this.id,
        })
      }

      this.notify({
        type: "turn_started",
        provider: this.provider,
        turnId,
      })

      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/session/${this.id}/message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          parts: [{ type: "text", text: prompt }],
        }),
      })

      if (!response.ok) {
        throw new Error(`OpenCode message failed: ${response.status} ${response.statusText}`)
      }

      this.onDeliveredPrompt({
        agentId: this.agentId,
        opencodeSessionId: this.id,
        prompt,
      })

      const assistantMessage: AgentTimelineItem = {
        type: "assistant_message",
        text: "Prompt accepted by OpenCode runtime.",
      }
      this.timeline.push(assistantMessage)
      this.notify({
        type: "timeline",
        item: assistantMessage,
        provider: this.provider,
        turnId,
      })

      this.notify({
        type: "turn_completed",
        provider: this.provider,
        turnId,
        usage: this.turnUsage,
      })
    } catch (error) {
      this.notify({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private notify(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event)
    }
  }

  private getLastAssistantText(): string {
    for (let index = this.timeline.length - 1; index >= 0; index -= 1) {
      const item = this.timeline[index]
      if (item?.type === "assistant_message" && typeof item.text === "string") {
        return item.text
      }
    }

    return ""
  }
}

function normalizePrompt(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt
  }

  return prompt
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
}
