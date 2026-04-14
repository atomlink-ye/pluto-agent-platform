import { z } from "zod";

import { AGENT_LIFECYCLE_STATUSES } from "./agent-lifecycle.js";
import type { LiteralUnion } from "./literal-union.js";
import { AgentProviderSchema } from "../server/agent/provider-manifest.js";
import type {
  AgentCapabilityFlags,
  AgentFeature,
  AgentModelDefinition,
  AgentMode,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentRuntimeInfo,
  AgentTimelineItem,
  AgentUsage,
  ProviderSnapshotEntry,
  ProviderStatus,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "../server/agent/agent-sdk-types.js";

export const MutableDaemonConfigSchema = z
  .object({
    mcp: z
      .object({
        injectIntoAgents: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .partial()
  .passthrough();

export const MutableDaemonConfigPatchSchema = MutableDaemonConfigSchema.partial();

export type MutableDaemonConfig = z.infer<typeof MutableDaemonConfigSchema>;
export type MutableDaemonConfigPatch = z.infer<typeof MutableDaemonConfigPatchSchema>;

export const AgentStatusSchema = z.enum(AGENT_LIFECYCLE_STATUSES);

const AgentModeSchema: z.ZodType<AgentMode> = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  colorTier: z.string().optional(),
});

const ProviderStatusSchema: z.ZodType<ProviderStatus> = z.enum([
  "ready",
  "loading",
  "error",
  "unavailable",
]);

const AgentSelectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const AgentFeatureToggleSchema = z.object({
  type: z.literal("toggle"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.boolean(),
});

export const AgentFeatureSelectSchema = z.object({
  type: z.literal("select"),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  tooltip: z.string().optional(),
  icon: z.string().optional(),
  value: z.string().nullable(),
  options: z.array(AgentSelectOptionSchema),
});

export const AgentFeatureSchema: z.ZodType<AgentFeature> = z.discriminatedUnion("type", [
  AgentFeatureToggleSchema,
  AgentFeatureSelectSchema,
]);

const AgentCapabilityFlagsSchema: z.ZodType<AgentCapabilityFlags> = z.object({
  supportsStreaming: z.boolean(),
  supportsSessionPersistence: z.boolean(),
  supportsDynamicModes: z.boolean(),
  supportsMcpServers: z.boolean(),
  supportsReasoningStream: z.boolean(),
  supportsToolInvocations: z.boolean(),
});

export const AgentUsageSchema: z.ZodType<AgentUsage> = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
  contextWindowMaxTokens: z.number().optional(),
  contextWindowUsedTokens: z.number().optional(),
});

const AgentModelDefinitionSchema: z.ZodType<AgentModelDefinition> = z.object({
  provider: AgentProviderSchema,
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
  thinkingOptions: z.array(AgentSelectOptionSchema).optional(),
  defaultThinkingOptionId: z.string().optional(),
});

const McpStdioServerConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

const McpHttpServerConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
});

const McpSseServerConfigSchema = z.object({
  type: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
});

const McpServerConfigSchema = z.discriminatedUnion("type", [
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSseServerConfigSchema,
]);

export const AgentSessionConfigSchema = z
  .object({
    provider: AgentProviderSchema,
    cwd: z.string(),
    systemPrompt: z.string().optional(),
    modeId: z.string().optional(),
    model: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    featureValues: z.record(z.unknown()).optional(),
    title: z.string().trim().min(1).max(200).optional().nullable(),
    approvalPolicy: z.string().optional(),
    sandboxMode: z.string().optional(),
    networkAccess: z.boolean().optional(),
    webSearch: z.boolean().optional(),
    extra: z.record(z.unknown()).optional(),
    mcpServers: z.record(McpServerConfigSchema).optional(),
    internal: z.boolean().optional(),
  })
  .passthrough();

const AgentPermissionActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  behavior: z.union([z.literal("allow"), z.literal("deny")]),
  variant: z.union([z.literal("primary"), z.literal("secondary"), z.literal("danger")]).optional(),
  intent: z
    .union([z.literal("implement"), z.literal("implement_resume"), z.literal("dismiss")])
    .optional(),
});

export const AgentPermissionRequestPayloadSchema: z.ZodType<AgentPermissionRequest> = z
  .object({
    id: z.string(),
    provider: AgentProviderSchema,
    name: z.string(),
    kind: z.union([
      z.literal("tool"),
      z.literal("plan"),
      z.literal("question"),
      z.literal("mode"),
      z.literal("other"),
    ]),
    title: z.string().optional(),
    description: z.string().optional(),
    input: z.record(z.unknown()).optional(),
    detail: z.unknown().optional() as unknown as z.ZodType<ToolCallDetail | undefined>,
    suggestions: z.array(z.record(z.unknown())).optional(),
    actions: z.array(AgentPermissionActionSchema).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const AgentPermissionResponseSchema: z.ZodType<AgentPermissionResponse> = z.union([
  z.object({
    behavior: z.literal("allow"),
    selectedActionId: z.string().optional(),
    updatedInput: z.record(z.unknown()).optional(),
    updatedPermissions: z.array(z.record(z.unknown())).optional(),
  }),
  z.object({
    behavior: z.literal("deny"),
    selectedActionId: z.string().optional(),
    message: z.string().optional(),
    interrupt: z.boolean().optional(),
  }),
]);

const AgentPersistenceHandleSchema: z.ZodType<AgentPersistenceHandle> = z.object({
  provider: AgentProviderSchema,
  sessionId: z.string(),
  nativeHandle: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const AgentRuntimeInfoSchema: z.ZodType<AgentRuntimeInfo> = z.object({
  provider: AgentProviderSchema,
  sessionId: z.string().nullable(),
  model: z.string().nullable().optional(),
  thinkingOptionId: z.string().nullable().optional(),
  modeId: z.string().nullable().optional(),
  extra: z.record(z.unknown()).optional(),
});

const ProviderSnapshotEntrySchema: z.ZodType<ProviderSnapshotEntry> = z.object({
  provider: AgentProviderSchema,
  status: ProviderStatusSchema,
  error: z.string().optional(),
  models: z.array(AgentModelDefinitionSchema).optional(),
  modes: z.array(AgentModeSchema).optional(),
  fetchedAt: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  defaultModeId: z.string().nullable().optional(),
});

export const AgentSnapshotPayloadSchema = z
  .object({
    id: z.string(),
    provider: AgentProviderSchema,
    cwd: z.string(),
    lifecycle: AgentStatusSchema,
    config: AgentSessionConfigSchema,
    capabilities: AgentCapabilityFlagsSchema.optional(),
    runtimeInfo: AgentRuntimeInfoSchema.optional(),
    persistence: AgentPersistenceHandleSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastError: z.string().optional(),
    labels: z.record(z.string()).default({}),
    providers: z.array(ProviderSnapshotEntrySchema).optional(),
  })
  .passthrough();

export type AgentSnapshotPayload = z.infer<typeof AgentSnapshotPayloadSchema>;

export type AgentStreamEventPayload = {
  agentId: string;
  event: {
    type: string;
    provider?: string;
    [key: string]: unknown;
  };
  seq?: number;
  epoch?: string;
};

export const AgentStreamEventPayloadSchema: z.ZodType<AgentStreamEventPayload> = z
  .object({
    agentId: z.string(),
    event: z.object({ type: z.string(), provider: AgentProviderSchema.optional() }).passthrough(),
    seq: z.number().int().optional(),
    epoch: z.string().optional(),
  })
  .passthrough();

export const AgentStreamMessageSchema = z.union([
  z.object({ type: z.literal("agent_state"), agent: AgentSnapshotPayloadSchema }),
  z.object({ type: z.literal("agent_stream"), payload: AgentStreamEventPayloadSchema }),
]);

export type AgentStreamMessage = z.infer<typeof AgentStreamMessageSchema>;

export function serializeAgentSnapshot(input: {
  id: string;
  provider: string;
  cwd: string;
  lifecycle: z.infer<typeof AgentStatusSchema>;
  config: z.infer<typeof AgentSessionConfigSchema>;
  persistence: AgentPersistenceHandle | null;
  createdAt: Date;
  updatedAt: Date;
  capabilities?: AgentCapabilityFlags;
  runtimeInfo?: AgentRuntimeInfo;
  lastError?: string;
  labels?: Record<string, string>;
  providers?: ProviderSnapshotEntry[];
}): AgentSnapshotPayload {
  return {
    id: input.id,
    provider: input.provider,
    cwd: input.cwd,
    lifecycle: input.lifecycle,
    config: input.config,
    persistence: input.persistence,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
    ...(input.capabilities ? { capabilities: input.capabilities } : {}),
    ...(input.runtimeInfo ? { runtimeInfo: input.runtimeInfo } : {}),
    ...(input.lastError ? { lastError: input.lastError } : {}),
    labels: input.labels ?? {},
    ...(input.providers ? { providers: input.providers } : {}),
  };
}

export type ToolCallStatus = LiteralUnion<"running" | "completed" | "failed" | "canceled", string>;

export type ToolCallDisplayPayload = Pick<
  ToolCallTimelineItem,
  "name" | "status" | "error" | "metadata" | "detail"
>;

export type AgentTimelinePayload = {
  items: AgentTimelineItem[];
};
