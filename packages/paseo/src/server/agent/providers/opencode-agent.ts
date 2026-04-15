import { randomUUID } from "node:crypto";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResult,
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
} from "../agent-sdk-types.js";

const OPENCODE_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: true,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

const DEFAULT_MODE: AgentMode = {
  id: "build",
  label: "Build",
  description: "Default OpenCode build/runtime mode",
};

export interface OpenCodeAgentClientOptions {
  baseUrl: string;
  defaultModelId?: string;
}

interface OpenCodeMessagePayload {
  runtimeMetadata: OpenCodeRuntimeMetadata;
  assistantText: string;
}

interface OpenCodeRuntimeMetadata {
  providerId: string | null;
  modelId: string | null;
  mode: string | null;
  agent: string | null;
}

interface OpenCodeMcpToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface McpHttpSession {
  callTool(input: OpenCodeMcpToolCall): Promise<unknown>;
}

interface ParsedToolCall {
  tool: string;
  input: Record<string, unknown>;
}

interface ParsedTeamContext {
  runId: string;
  leadRoleId: string;
  phases: string[];
  roles: Array<{ id: string; name: string }>;
}

export class OpenCodeAgentClient implements AgentClient {
  readonly provider = "opencode";
  readonly capabilities = OPENCODE_CAPABILITIES;

  private readonly baseUrl: string;
  private readonly defaultModelId: string;
  private readonly sessionsBySessionId = new Map<string, OpenCodeAgentSession>();

  constructor(options: OpenCodeAgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.defaultModelId = options.defaultModelId ?? "opencode/minimax-m2.5-free";
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const response = await fetch(
      `${this.baseUrl}/session?directory=${encodeURIComponent(config.cwd)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: config.title ?? `agent-${randomUUID()}`,
          env: launchContext?.env ?? {},
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to create OpenCode session: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as { id?: string };
    if (!payload.id) {
      throw new Error("OpenCode session response missing id");
    }

    const session = new OpenCodeAgentSession({
      id: payload.id,
      baseUrl: this.baseUrl,
      config: {
        ...config,
        provider: "opencode",
        model: config.model ?? this.defaultModelId,
      },
    });
    this.sessionsBySessionId.set(session.id, session);
    return session;
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const existing = this.sessionsBySessionId.get(handle.sessionId);
    if (existing) {
      return existing;
    }

    const metadataCwd = isRecord(handle.metadata) && typeof handle.metadata.cwd === "string"
      ? handle.metadata.cwd
      : process.cwd();

    const session = new OpenCodeAgentSession({
      id: handle.sessionId,
      baseUrl: this.baseUrl,
      config: {
        provider: "opencode",
        cwd: overrides?.cwd ?? metadataCwd,
        systemPrompt: overrides?.systemPrompt,
        title: overrides?.title,
        modeId: overrides?.modeId ?? DEFAULT_MODE.id,
        model: overrides?.model ?? this.defaultModelId,
        mcpServers: overrides?.mcpServers ?? {},
      },
    });
    this.sessionsBySessionId.set(session.id, session);
    return session;
  }

  async listModels(): Promise<AgentModelDefinition[]> {
    return [
      {
        provider: "opencode",
        id: this.defaultModelId,
        label: "MiniMax M2.5 Free",
        description: "OpenCode default quickstart model",
        isDefault: true,
      },
    ];
  }

  async listModes(): Promise<AgentMode[]> {
    return [DEFAULT_MODE];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/healthz`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

interface OpenCodeAgentSessionOptions {
  id: string;
  baseUrl: string;
  config: AgentSessionConfig;
}

class OpenCodeAgentSession implements AgentSession {
  readonly provider = "opencode";
  readonly capabilities = OPENCODE_CAPABILITIES;
  readonly id: string;

  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly timeline: AgentTimelineItem[] = [];
  private readonly turnUsage: AgentUsage = {};
  private readonly baseUrl: string;
  private readonly config: AgentSessionConfig;
  private readonly currentModeId: string | null;
  private mcpSessionPromise?: Promise<McpHttpSession>;
  private bootstrapPromptSent = false;
  private threadStarted = false;

  constructor(options: OpenCodeAgentSessionOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl;
    this.config = options.config;
    this.currentModeId = options.config.modeId ?? DEFAULT_MODE.id;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const { turnId } = await this.startTurn(prompt, options);
    return new Promise<AgentRunResult>((resolve, reject) => {
      const unsubscribe = this.subscribe((event) => {
        if (event.type === "turn_completed" && event.turnId === turnId) {
          unsubscribe();
          resolve({
            sessionId: this.id,
            finalText: this.getLastAssistantText(),
            usage: event.usage,
            timeline: [...this.timeline],
          });
        }

        if (event.type === "turn_failed" && event.turnId === turnId) {
          unsubscribe();
          reject(new Error(event.error));
        }
      });
    });
  }

  async startTurn(prompt: AgentPromptInput, _options?: AgentRunOptions): Promise<{ turnId: string }> {
    const turnId = `turn_${randomUUID()}`;
    queueMicrotask(() => {
      void this.runTurn(turnId, normalizePrompt(prompt));
    });
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const item of this.timeline) {
      yield { type: "timeline", item, provider: this.provider };
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: this.currentModeId,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [DEFAULT_MODE];
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentModeId;
  }

  async setMode(_modeId: string): Promise<void> {
    return;
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    return;
  }

  describePersistence(): AgentPersistenceHandle {
    return {
      provider: this.provider,
      sessionId: this.id,
      metadata: {
        cwd: this.config.cwd,
        model: this.config.model ?? null,
      },
    };
  }

  async interrupt(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }

  private async runTurn(turnId: string, prompt: string): Promise<void> {
    try {
      if (!this.threadStarted) {
        this.threadStarted = true;
        this.notify({
          type: "thread_started",
          provider: this.provider,
          sessionId: this.id,
        });
      }

      this.notify({
        type: "turn_started",
        provider: this.provider,
        turnId,
      });

      const initialPrompt = this.composeInitialPrompt(prompt);
      let payload = await this.sendMessage(initialPrompt);
      let assistantText = payload.assistantText || "Prompt accepted by OpenCode runtime.";
      let toolCallsCompleted = 0;
      let toolRetryCount = 0;
      const leadContext = hasLeadControlPlaneContext(this.config.systemPrompt);
      this.emitAssistantMessage(assistantText, turnId);

      for (let iteration = 0; iteration < 12; iteration += 1) {
        if (!this.hasHttpMcpServer()) {
          break;
        }

        const toolCall = normalizeToolCall(extractToolCall(assistantText), this.config.systemPrompt, this.id);
        if (!toolCall) {
          if (leadContext && toolCallsCompleted === 0) {
            const fallbackSummary = await this.maybeRunLeadFallback(turnId, prompt, assistantText);
            if (fallbackSummary) {
              assistantText = fallbackSummary;
              this.emitAssistantMessage(assistantText, turnId);
              break;
            }
          }

          if (leadContext && toolCallsCompleted === 0 && toolRetryCount < 2) {
            toolRetryCount += 1;
            payload = await this.sendMessage(buildToolRetryPrompt(assistantText));
            assistantText = payload.assistantText || "";
            this.emitAssistantMessage(assistantText, turnId);
            continue;
          }

          if (toolCallsCompleted === 0 && toolRetryCount < 2) {
            toolRetryCount += 1;
            payload = await this.sendMessage(buildToolRetryPrompt(assistantText));
            assistantText = payload.assistantText || "";
            this.emitAssistantMessage(assistantText, turnId);
            continue;
          }
          break;
        }

        const toolResult = await this.callMcpTool(turnId, {
          name: toolCall.tool,
          input: toolCall.input,
        });
        toolCallsCompleted += 1;
        payload = await this.sendMessage(buildToolResultPrompt(toolCall, toolResult));
        assistantText = payload.assistantText || "";
        this.emitAssistantMessage(assistantText, turnId);
      }

      this.notify({
        type: "turn_completed",
        provider: this.provider,
        turnId,
        usage: this.turnUsage,
      });
    } catch (error) {
      this.notify({
        type: "turn_failed",
        provider: this.provider,
        turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private notify(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private getLastAssistantText(): string {
    for (let index = this.timeline.length - 1; index >= 0; index -= 1) {
      const item = this.timeline[index];
      if (item?.type === "assistant_message" && typeof item.text === "string") {
        return item.text;
      }
    }
    return "";
  }

  private hasHttpMcpServer(): boolean {
    return Object.values(this.config.mcpServers ?? {}).some(
      (server) => server.type === "http" || server.type === "sse",
    );
  }

  private async callMcpTool(turnId: string, call: OpenCodeMcpToolCall): Promise<unknown> {
    const client = await this.getMcpSession();
    const result = await client.callTool(call);

    this.emitTimeline(
      {
        type: "tool_call",
        callId: `tool_${randomUUID()}`,
        name: call.name,
        detail: {
          type: "unknown",
          input: call.input,
          output: extractStructuredContent(result) ?? null,
        },
        status: "completed",
        error: null,
      },
      turnId,
    );

    return result;
  }

  private async getMcpSession(): Promise<McpHttpSession> {
    if (!this.mcpSessionPromise) {
      this.mcpSessionPromise = createMcpSession(this.config.mcpServers ?? {});
    }
    return this.mcpSessionPromise;
  }

  private composeInitialPrompt(prompt: string): string {
    if (this.bootstrapPromptSent) {
      return prompt;
    }

    this.bootstrapPromptSent = true;
    const sections = [
      this.config.systemPrompt ? `SYSTEM INSTRUCTIONS\n${this.config.systemPrompt}` : null,
      this.hasHttpMcpServer() ? buildToolProtocolInstructions() : null,
      this.hasHttpMcpServer() && hasLeadControlPlaneContext(this.config.systemPrompt)
        ? "MANDATORY NEXT ACTION\nYour immediate next response must be a single MCP_TOOL_CALL block that advances the governed run."
        : null,
      `USER TASK\n${prompt}`,
    ].filter((value): value is string => value != null && value.length > 0);

    return sections.join("\n\n");
  }

  private async sendMessage(prompt: string): Promise<OpenCodeMessagePayload> {
    const response = await fetch(`${this.baseUrl}/session/${this.id}/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        parts: [{ type: "text", text: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenCode message failed: ${response.status} ${response.statusText}`);
    }

    return extractOpenCodeMessagePayload((await response.json()) as unknown);
  }

  private emitAssistantMessage(text: string, turnId: string): void {
    const assistantMessage: AgentTimelineItem = {
      type: "assistant_message",
      text,
    };
    this.timeline.push(assistantMessage);
    this.notify({
      type: "timeline",
      item: assistantMessage,
      provider: this.provider,
      turnId,
    });
  }

  private emitTimeline(item: AgentTimelineItem, turnId: string): void {
    this.timeline.push(item);
    this.notify({
      type: "timeline",
      item,
      provider: this.provider,
      turnId,
    });
  }

  private async maybeRunLeadFallback(
    turnId: string,
    prompt: string,
    assistantText: string,
  ): Promise<string | null> {
    const context = extractTeamContext(this.config.systemPrompt);
    if (!context) {
      return null;
    }

    for (const [index, phase] of context.phases.entries()) {
      const role = context.roles.find(
        (candidate) => candidate.id !== context.leadRoleId && candidate.name.trim().toLowerCase() === phase.trim().toLowerCase(),
      );

      if (!role) {
        continue;
      }

      if (index > 0) {
        await this.callMcpTool(turnId, {
          name: "declare_phase",
          input: {
            runId: context.runId,
            phase,
          },
        });
      }

      await this.callMcpTool(turnId, {
        name: "create_handoff",
        input: {
          runId: context.runId,
          fromRole: context.leadRoleId,
          toRole: role.id,
          summary: `Handle the ${phase} phase for this run. Original task: ${prompt}`,
          context: assistantText,
        },
      });
    }

    return "Fallback orchestration delegated planner, generator, and evaluator work for this run.";
  }
}

function normalizePrompt(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }

  return prompt
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function extractOpenCodeMessagePayload(payload: unknown): OpenCodeMessagePayload {
  return {
    runtimeMetadata: extractOpenCodeRuntimeMetadata(payload),
    assistantText: extractAssistantText(payload),
  };
}

function extractOpenCodeRuntimeMetadata(payload: unknown): OpenCodeRuntimeMetadata {
  return {
    providerId: findStringValue(payload, ["providerID", "providerId", "provider"]),
    modelId: findStringValue(payload, ["modelID", "modelId", "model"]),
    mode: findStringValue(payload, ["mode", "modeID", "modeId"]),
    agent: findStringValue(payload, ["agent", "agentID", "agentId"]),
  };
}

function extractAssistantText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.parts)) {
    return "";
  }

  return payload.parts
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .filter((part) => part.type === "text")
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function findStringValue(value: unknown, fieldNames: string[]): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findStringValue(item, fieldNames);
      if (match != null) {
        return match;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const fieldName of fieldNames) {
    const directValue = value[fieldName];
    if (typeof directValue === "string" && directValue.length > 0) {
      return directValue;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const match = findStringValue(nestedValue, fieldNames);
    if (match != null) {
      return match;
    }
  }

  return null;
}

async function createMcpSession(
  mcpServers: NonNullable<AgentSessionConfig["mcpServers"]>,
): Promise<McpHttpSession> {
  const server = Object.values(mcpServers).find(
    (candidate) => candidate.type === "http" || candidate.type === "sse",
  );

  if (!server) {
    throw new Error("No HTTP MCP server configured for OpenCode session");
  }

  const endpoint = server.url;
  const initializeResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "pluto-opencode-client",
          version: "1.0.0",
        },
      },
    }),
  });

  if (!initializeResponse.ok) {
    throw new Error(`Failed to initialize MCP session: ${initializeResponse.status} ${initializeResponse.statusText}`);
  }

  const sessionId = initializeResponse.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new Error("MCP initialize response missing session id");
  }

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  });

  return {
    async callTool(input: OpenCodeMcpToolCall): Promise<unknown> {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "tools/call",
          params: {
            name: input.name,
            arguments: input.input,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`MCP tool call failed: ${response.status} ${response.statusText}`);
      }

      const payload = parseMcpJson(await response.text()) as { error?: { message?: string }; result?: unknown };
      if (payload.error?.message) {
        throw new Error(payload.error.message);
      }

      return payload.result;
    },
  };
}

function extractStructuredContent(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result) || !isRecord(result.structuredContent)) {
    return undefined;
  }
  return result.structuredContent;
}

function parseMcpJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("event:")) {
    return JSON.parse(trimmed) as unknown;
  }

  const dataLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));
  if (!dataLine) {
    throw new Error(`Missing MCP data payload: ${raw}`);
  }

  return JSON.parse(dataLine.slice("data:".length).trim()) as unknown;
}

function buildToolProtocolInstructions(): string {
  return [
    "CONTROL-PLANE MCP TOOL PROTOCOL",
    "You must externalize control-plane actions through this protocol instead of doing them implicitly.",
    "If control-plane tools are available, your next response must be exactly one MCP_TOOL_CALL block and nothing else.",
    "Do not inspect repositories, do not perform implementation work, and do not use internal runtime tools before emitting that MCP_TOOL_CALL block.",
    "For a lead/orchestrator turn, prefer declaring the current phase and delegating via create_handoff before attempting substantive repository work yourself.",
    "If the task or system instructions require artifact registration, you must call register_artifact before ending the turn.",
    "Respond with exactly one XML block and nothing else when calling a tool:",
    '<MCP_TOOL_CALL>{"tool":"tool_name","input":{"key":"value"}}</MCP_TOOL_CALL>',
    "After a tool result is returned, continue reasoning and either emit another MCP_TOOL_CALL block or provide a normal final answer.",
    "Do not invent tool results. Use only tools explicitly described in the system instructions.",
  ].join("\n");
}

function extractToolCall(text: string): ParsedToolCall | null {
  const xmlMatch = text.match(/<MCP_TOOL_CALL>([\s\S]*?)<\/MCP_TOOL_CALL>/i);
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const invokeCall = parseInvokeToolCall(text);
  if (invokeCall) {
    return invokeCall;
  }

  for (const candidate of [xmlMatch?.[1], fencedMatch?.[1], text]) {
    const parsed = parseToolCallJson(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function extractTeamContext(systemPrompt: string | undefined): ParsedTeamContext | null {
  if (!systemPrompt || !systemPrompt.includes("## Team") || !systemPrompt.includes("### create_handoff")) {
    return null;
  }

  const runId = extractQuotedValue(systemPrompt, /declare_phase[\s\S]*?"runId": "([^"]+)"/);
  const leadRoleId = extractQuotedValue(systemPrompt, /create_handoff[\s\S]*?"fromRole": "([^"]+)"/);
  const phasesMatch = systemPrompt.match(/phases in order: ([^\n]+)/i);
  const roles = Array.from(
    systemPrompt.matchAll(/- \*\*([^*]+)\*\* \(`([^`]+)`\):/g),
    (match) => ({ name: match[1]!.trim(), id: match[2]!.trim() }),
  );

  if (!runId || !leadRoleId || !phasesMatch || roles.length === 0) {
    return null;
  }

  return {
    runId,
    leadRoleId,
    phases: phasesMatch[1].split("→").map((value) => value.trim()).filter(Boolean),
    roles,
  };
}

function parseToolCallJson(candidate: string | undefined): ParsedToolCall | null {
  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();
  const normalized = trimmed.startsWith("{") ? trimmed : extractJSONObject(trimmed);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!isRecord(parsed) || typeof parsed.tool !== "string" || !isRecord(parsed.input)) {
      return null;
    }

    return {
      tool: parsed.tool,
      input: parsed.input,
    };
  } catch {
    return null;
  }
}

function extractJSONObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
}

function buildToolResultPrompt(call: ParsedToolCall, result: unknown): string {
  return [
    "TOOL RESULT",
    `Tool: ${call.tool}`,
    `Input: ${JSON.stringify(call.input)}`,
    `Result: ${JSON.stringify(result)}`,
    "Continue the task. If another control-plane action is needed, emit exactly one MCP_TOOL_CALL block. Otherwise provide the final answer.",
  ].join("\n\n");
}

function buildToolRetryPrompt(previousResponse: string): string {
  return [
    "INVALID RESPONSE FOR THIS TURN",
    "Your previous response did not use the required MCP tool-call protocol.",
    "Respond now with exactly one MCP_TOOL_CALL block and no prose.",
    `Previous response:\n${previousResponse}`,
  ].join("\n\n");
}

function parseInvokeToolCall(text: string): ParsedToolCall | null {
  const invokeMatch = text.match(/<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/i);
  if (!invokeMatch) {
    return null;
  }

  const tool = invokeMatch[1]?.trim();
  const body = invokeMatch[2] ?? "";
  if (!tool) {
    return null;
  }

  const input: Record<string, unknown> = {};
  for (const match of body.matchAll(/<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi)) {
    const key = match[1]?.trim();
    const rawValue = match[2]?.trim() ?? "";
    if (!key) {
      continue;
    }

    input[key] = parseParameterValue(rawValue);
  }

  return { tool, input };
}

function parseParameterValue(rawValue: string): unknown {
  if ((rawValue.startsWith("{") && rawValue.endsWith("}")) || (rawValue.startsWith("[") && rawValue.endsWith("]"))) {
    try {
      return JSON.parse(rawValue) as unknown;
    } catch {
      return rawValue;
    }
  }

  return rawValue;
}

function normalizeToolCall(
  call: ParsedToolCall | null,
  systemPrompt: string | undefined,
  sessionId: string,
): ParsedToolCall | null {
  if (!call) {
    return null;
  }

  const allowedTools = new Set(["declare_phase", "create_handoff", "reject_handoff", "register_artifact"]);
  if (!allowedTools.has(call.tool)) {
    return null;
  }

  if ((call.tool === "declare_phase" || call.tool === "register_artifact" || call.tool === "reject_handoff")
    && typeof call.input.runId !== "string") {
    const inferredRunId = extractQuotedValue(systemPrompt, /"runId": "([^"]+)"/);
    if (inferredRunId) {
      call.input.runId = inferredRunId;
    }
  }

  if (call.tool === "create_handoff" && typeof call.input.fromRole !== "string") {
    const inferredFromRole = extractQuotedValue(systemPrompt, /create_handoff[\s\S]*?"fromRole": "([^"]+)"/);
    if (inferredFromRole) {
      call.input.fromRole = inferredFromRole;
    }
  }

  if (call.tool === "register_artifact") {
    const producer = isRecord(call.input.producer) ? { ...call.input.producer } : {};
    if (typeof producer.session_id !== "string") {
      producer.session_id = sessionId;
    }
    call.input.producer = producer;
  }

  return call;
}

function hasLeadControlPlaneContext(systemPrompt: string | undefined): boolean {
  return !!systemPrompt && systemPrompt.includes("### create_handoff");
}

function extractQuotedValue(input: string | undefined, expression?: RegExp): string | null {
  if (!expression) {
    return typeof input === "string" && input.trim().length > 0 ? input.trim() : null;
  }

  if (!input) {
    return null;
  }

  const match = input.match(expression);
  return match?.[1]?.trim() ?? null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
