import type { AgentRuntimeInfo, AgentSessionConfig } from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { SerializableAgentConfig, StoredAgentRecord } from "./agent-storage.js";

function toSerializableConfig(config: AgentSessionConfig): SerializableAgentConfig {
  return {
    title: config.title ?? null,
    modeId: config.modeId ?? undefined,
    model: config.model ?? undefined,
    thinkingOptionId: config.thinkingOptionId ?? undefined,
    featureValues: config.featureValues ?? undefined,
    extra: config.extra ?? undefined,
    systemPrompt: config.systemPrompt ?? undefined,
    mcpServers: config.mcpServers ?? undefined,
  };
}

function toRuntimeInfo(runtimeInfo: AgentRuntimeInfo | undefined) {
  if (!runtimeInfo) {
    return undefined;
  }

  return {
    provider: runtimeInfo.provider,
    sessionId: runtimeInfo.sessionId ?? null,
    model: runtimeInfo.model ?? null,
    thinkingOptionId: runtimeInfo.thinkingOptionId ?? null,
    modeId: runtimeInfo.modeId ?? null,
    extra: runtimeInfo.extra,
  };
}

export function toStoredAgentRecord(
  agent: ManagedAgent,
  options?: {
    title?: string | null;
    createdAt?: string;
    internal?: boolean;
  },
): StoredAgentRecord {
  const createdAt = options?.createdAt ?? agent.createdAt.toISOString();
  const updatedAt = agent.updatedAt.toISOString();
  const requiresAttention = agent.attention.requiresAttention;

  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    createdAt,
    updatedAt,
    lastActivityAt: updatedAt,
    lastUserMessageAt: agent.lastUserMessageAt?.toISOString() ?? null,
    title: options?.title ?? agent.config.title ?? null,
    labels: { ...agent.labels },
    lastStatus: agent.lifecycle,
    lastModeId: agent.currentModeId ?? agent.config.modeId ?? null,
    config: toSerializableConfig(agent.config),
    runtimeInfo: toRuntimeInfo(agent.runtimeInfo),
    features: agent.features,
    persistence: agent.persistence ?? null,
    requiresAttention,
    attentionReason: requiresAttention ? agent.attention.attentionReason : null,
    attentionTimestamp: requiresAttention
      ? agent.attention.attentionTimestamp.toISOString()
      : null,
    internal: options?.internal ?? agent.internal ?? false,
  };
}
