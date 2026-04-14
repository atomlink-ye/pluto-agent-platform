import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { z } from "zod";

import { ensureValidJson } from "../json-utils.js";
import type { AgentProvider } from "./agent-sdk-types.js";
import type { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { scheduleAgentMetadataGeneration } from "./agent-metadata-generator.js";
import type { ProviderDefinition } from "./provider-registry.js";
import {
  AgentModelSchema,
  AgentProviderEnum,
  AgentStatusEnum,
  ProviderSummarySchema,
  sanitizePermissionRequest,
  serializeSnapshotWithMetadata,
  startAgentRun,
  waitForAgentWithTimeout,
} from "./mcp-shared.js";
import {
  AgentPermissionRequestPayloadSchema,
  AgentPermissionResponseSchema,
  AgentSnapshotPayloadSchema,
} from "../messages.js";

export interface AgentMcpServerOptions {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerRegistry?: Record<AgentProvider, ProviderDefinition> | null;
  paseoHome?: string;
  callerAgentId?: string;
  logger: Logger;
}

function response(structuredContent: Record<string, unknown>) {
  return {
    content: [],
    structuredContent: ensureValidJson(structuredContent) as Record<string, unknown>,
  };
}

export async function createAgentMcpServer(options: AgentMcpServerOptions): Promise<McpServer> {
  const { agentManager, agentStorage, providerRegistry, logger } = options;
  const childLogger = logger.child({ module: "agent", component: "mcp-server" });
  const server = new McpServer({ name: "agent-mcp", version: "2.0.0" });

  server.registerTool(
    "create_agent",
    {
      title: "Create agent",
      description: "Create a new Claude agent and optionally start it immediately.",
      inputSchema: {
        cwd: z.string(),
        title: z.string().trim().min(1).max(60),
        initialPrompt: z.string().trim().min(1),
        provider: AgentProviderEnum.optional(),
        model: z.string().optional(),
        thinking: z.string().optional(),
        mode: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional(),
        background: z.boolean().optional().default(false),
      },
      outputSchema: {
        agentId: z.string(),
        type: AgentProviderEnum,
        status: AgentStatusEnum,
        cwd: z.string(),
        currentModeId: z.string().nullable(),
        availableModes: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().nullable().optional() })),
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
      },
    },
    async ({ cwd, title, initialPrompt, provider = "claude", model, thinking, mode, labels, background = false }) => {
      const snapshot = await agentManager.createAgent(
        {
          provider,
          cwd,
          title,
          model,
          thinkingOptionId: thinking,
          modeId: mode,
        },
        undefined,
        labels ? { labels } : undefined,
      );

      scheduleAgentMetadataGeneration({
        agentManager,
        agentId: snapshot.id,
        cwd: snapshot.cwd,
        initialPrompt,
        explicitTitle: snapshot.config.title,
        paseoHome: options.paseoHome,
        logger: childLogger,
      });

      try {
        agentManager.recordUserMessage(snapshot.id, initialPrompt, { emitState: false });
      } catch (error) {
        childLogger.error({ err: error, agentId: snapshot.id }, "Failed to record initial prompt");
      }

      startAgentRun(agentManager, snapshot.id, initialPrompt, childLogger);

      if (!background) {
        const result = await waitForAgentWithTimeout(agentManager, snapshot.id, { waitForActive: true });
        return response({
          agentId: snapshot.id,
          type: snapshot.provider,
          status: result.status,
          cwd: snapshot.cwd,
          currentModeId: snapshot.currentModeId,
          availableModes: snapshot.availableModes,
          lastMessage: result.lastMessage,
          permission: sanitizePermissionRequest(result.permission),
        });
      }

      return response({
        agentId: snapshot.id,
        type: snapshot.provider,
        status: snapshot.lifecycle,
        cwd: snapshot.cwd,
        currentModeId: snapshot.currentModeId,
        availableModes: snapshot.availableModes,
        lastMessage: null,
        permission: null,
      });
    },
  );

  server.registerTool(
    "wait_for_agent",
    {
      title: "Wait for agent",
      description: "Wait for the current agent run to finish or request permission.",
      inputSchema: { agentId: z.string() },
      outputSchema: {
        agentId: z.string(),
        status: AgentStatusEnum,
        permission: AgentPermissionRequestPayloadSchema.nullable(),
        lastMessage: z.string().nullable(),
      },
    },
    async ({ agentId }, { signal }) => {
      const result = await waitForAgentWithTimeout(agentManager, agentId, { signal });
      return response({
        agentId,
        status: result.status,
        permission: sanitizePermissionRequest(result.permission),
        lastMessage: result.lastMessage,
      });
    },
  );

  server.registerTool(
    "send_agent_prompt",
    {
      title: "Send agent prompt",
      description: "Send a new prompt to an existing agent.",
      inputSchema: {
        agentId: z.string(),
        prompt: z.string(),
        sessionMode: z.string().optional(),
        background: z.boolean().optional().default(false),
      },
      outputSchema: {
        success: z.boolean(),
        status: AgentStatusEnum,
        lastMessage: z.string().nullable().optional(),
        permission: AgentPermissionRequestPayloadSchema.nullable().optional(),
      },
    },
    async ({ agentId, prompt, sessionMode, background = false }) => {
      if (sessionMode) {
        await agentManager.setAgentMode(agentId, sessionMode);
      }
      try {
        agentManager.recordUserMessage(agentId, prompt, { emitState: false });
      } catch (error) {
        childLogger.error({ err: error, agentId }, "Failed to record user message");
      }
      startAgentRun(agentManager, agentId, prompt, childLogger, { replaceRunning: true });
      if (!background) {
        const result = await waitForAgentWithTimeout(agentManager, agentId, { waitForActive: true });
        return response({
          success: true,
          status: result.status,
          lastMessage: result.lastMessage,
          permission: sanitizePermissionRequest(result.permission),
        });
      }
      return response({ success: true, status: agentManager.getAgent(agentId)?.lifecycle ?? "idle", lastMessage: null, permission: null });
    },
  );

  server.registerTool(
    "respond_to_permission",
    {
      title: "Respond to permission",
      description: "Allow or deny a pending permission request for an agent.",
      inputSchema: {
        agentId: z.string(),
        requestId: z.string(),
        response: AgentPermissionResponseSchema,
      },
      outputSchema: { success: z.boolean() },
    },
    async ({ agentId, requestId, response: permissionResponse }) => {
      await agentManager.respondToPermission(agentId, requestId, permissionResponse);
      return response({ success: true });
    },
  );

  server.registerTool(
    "get_agent_status",
    {
      title: "Get agent status",
      description: "Return the latest snapshot for an agent.",
      inputSchema: { agentId: z.string() },
      outputSchema: { status: AgentStatusEnum, snapshot: AgentSnapshotPayloadSchema },
    },
    async ({ agentId }) => {
      const snapshot = agentManager.getAgent(agentId);
      if (!snapshot) throw new Error(`Agent ${agentId} not found`);
      return response({
        status: snapshot.lifecycle,
        snapshot: await serializeSnapshotWithMetadata(agentStorage, snapshot, childLogger),
      });
    },
  );

  server.registerTool(
    "list_agents",
    {
      title: "List agents",
      description: "List all live agents managed by the server.",
      inputSchema: {},
      outputSchema: { agents: z.array(AgentSnapshotPayloadSchema) },
    },
    async () => {
      const snapshots = agentManager.listAgents();
      const agents = await Promise.all(
        snapshots.map((snapshot) => serializeSnapshotWithMetadata(agentStorage, snapshot, childLogger)),
      );
      return response({ agents });
    },
  );

  server.registerTool(
    "cancel_agent",
    {
      title: "Cancel agent run",
      description: "Abort the current run but keep the agent alive.",
      inputSchema: { agentId: z.string() },
      outputSchema: { success: z.boolean() },
    },
    async ({ agentId }) => response({ success: await agentManager.cancelAgentRun(agentId) }),
  );

  server.registerTool(
    "kill_agent",
    {
      title: "Kill agent",
      description: "Terminate an agent session permanently.",
      inputSchema: { agentId: z.string() },
      outputSchema: { success: z.boolean() },
    },
    async ({ agentId }) => {
      await agentManager.closeAgent(agentId);
      return response({ success: true });
    },
  );

  server.registerTool(
    "list_providers",
    {
      title: "List providers",
      description: "List available agent providers and their modes.",
      inputSchema: {},
      outputSchema: { providers: z.array(ProviderSummarySchema) },
    },
    async () =>
      response({
        providers: Object.values(providerRegistry ?? {}).map((provider) => ({
          id: provider.id,
          label: provider.label,
          modes: provider.modes.map((mode) => ({
            id: mode.id,
            label: mode.label,
            ...(mode.description ? { description: mode.description } : {}),
          })),
        })),
      }),
  );

  server.registerTool(
    "list_models",
    {
      title: "List models",
      description: "List models for an agent provider.",
      inputSchema: { provider: AgentProviderEnum },
      outputSchema: { provider: z.string(), models: z.array(AgentModelSchema) },
    },
    async ({ provider }) => {
      if (!providerRegistry) throw new Error("Provider registry is not configured");
      const definition = providerRegistry[provider];
      if (!definition) throw new Error(`Provider ${provider} is not configured`);
      return response({ provider, models: await definition.fetchModels() });
    },
  );

  return server;
}
