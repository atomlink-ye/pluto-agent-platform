import { z } from "zod";
import type { Logger } from "pino";

import type { AgentPromptInput, AgentPermissionRequest } from "./agent-sdk-types.js";
import type { AgentManager, ManagedAgent, WaitForAgentResult } from "./agent-manager.js";
import { curateAgentActivity } from "./activity-curator.js";
import type { AgentStorage } from "./agent-storage.js";
import { serializeAgentSnapshot } from "../messages.js";

export const AgentProviderEnum = z.string();
export const AgentStatusEnum = z.enum(["initializing", "idle", "running", "error", "closed"]);

export const ProviderModeSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  colorTier: z.string().optional(),
});

export const ProviderSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  modes: z.array(ProviderModeSchema),
});

export const AgentSelectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AgentModelSchema = z.object({
  provider: z.string(),
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  thinkingOptions: z.array(AgentSelectOptionSchema).optional(),
  defaultThinkingOptionId: z.string().optional(),
});

export const AGENT_WAIT_TIMEOUT_MS = 30000;

export type StartAgentRunOptions = { replaceRunning?: boolean };

export async function waitForAgentWithTimeout(
  agentManager: AgentManager,
  agentId: string,
  options?: { signal?: AbortSignal; waitForActive?: boolean },
): Promise<WaitForAgentResult> {
  const timeoutController = new AbortController();
  const combinedController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new Error("wait timeout"));
  }, AGENT_WAIT_TIMEOUT_MS);

  const forwardAbort = (reason: unknown) => {
    if (!combinedController.signal.aborted) combinedController.abort(reason);
  };

  if (options?.signal) {
    if (options.signal.aborted) {
      forwardAbort(options.signal.reason);
    } else {
      options.signal.addEventListener("abort", () => forwardAbort(options.signal!.reason), { once: true });
    }
  }

  timeoutController.signal.addEventListener("abort", () => forwardAbort(timeoutController.signal.reason), {
    once: true,
  });

  try {
    return await agentManager.waitForAgentEvent(agentId, {
      signal: combinedController.signal,
      waitForActive: options?.waitForActive,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "wait timeout") {
      const snapshot = agentManager.getAgent(agentId);
      const timeline = agentManager.getTimeline(agentId);
      const recentActivity = curateAgentActivity(timeline.slice(-5));
      return {
        status: snapshot?.lifecycle ?? "idle",
        permission: null,
        lastMessage: `Awaiting the agent timed out after 30s. This does not mean the agent failed - call wait_for_agent again to continue waiting.\n\nRecent activity:\n${recentActivity}`,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function startAgentRun(
  agentManager: AgentManager,
  agentId: string,
  prompt: AgentPromptInput,
  logger: Logger,
  options?: StartAgentRunOptions,
): void {
  const iterator = options?.replaceRunning && agentManager.hasInFlightRun(agentId)
    ? agentManager.replaceAgentRun(agentId, prompt)
    : agentManager.streamAgent(agentId, prompt);
  void (async () => {
    try {
      for await (const _ of iterator) {
      }
    } catch (error) {
      logger.error({ err: error, agentId }, "Agent stream failed");
    }
  })();
}

export function sanitizePermissionRequest(
  permission: AgentPermissionRequest | null | undefined,
): AgentPermissionRequest | null {
  if (!permission) return null;
  const sanitized: AgentPermissionRequest = { ...permission };
  if (sanitized.title === undefined) delete sanitized.title;
  if (sanitized.description === undefined) delete sanitized.description;
  if (sanitized.input === undefined) delete sanitized.input;
  if (sanitized.suggestions === undefined) delete sanitized.suggestions;
  if (sanitized.actions === undefined) delete sanitized.actions;
  if (sanitized.metadata === undefined) delete sanitized.metadata;
  return sanitized;
}

export async function serializeSnapshotWithMetadata(
  agentStorage: AgentStorage,
  snapshot: ManagedAgent,
  logger: Logger,
) {
  try {
    const record = await agentStorage.get(snapshot.id);
    return serializeAgentSnapshot(snapshot);
  } catch (error) {
    logger.error({ err: error, agentId: snapshot.id }, "Failed to load agent title");
    return serializeAgentSnapshot(snapshot);
  }
}
