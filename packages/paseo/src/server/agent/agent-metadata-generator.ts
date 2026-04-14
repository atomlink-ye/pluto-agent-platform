import type { Logger } from "pino";

import type { AgentManager } from "./agent-manager.js";

export type AgentMetadataGenerationOptions = {
  agentManager: AgentManager;
  agentId: string;
  cwd: string;
  initialPrompt?: string | null;
  explicitTitle?: string | null;
  paseoHome?: string;
  logger: Logger;
};

function deriveTitle(prompt: string): string | null {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, 60).trim() || null;
}

export async function generateAndApplyAgentMetadata(
  options: AgentMetadataGenerationOptions,
): Promise<void> {
  if (options.explicitTitle?.trim()) return;
  const title = deriveTitle(options.initialPrompt ?? "");
  if (!title) return;

  try {
    await options.agentManager.setTitle(options.agentId, title);
  } catch (error) {
    options.logger.warn({ err: error, agentId: options.agentId }, "Failed to set generated title");
  }
}

export function scheduleAgentMetadataGeneration(options: AgentMetadataGenerationOptions): void {
  queueMicrotask(() => {
    void generateAndApplyAgentMetadata(options).catch((error) => {
      options.logger.error({ err: error, agentId: options.agentId }, "Agent metadata generation crashed");
    });
  });
}
