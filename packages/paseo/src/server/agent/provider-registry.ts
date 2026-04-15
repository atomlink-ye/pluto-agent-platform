import type { Logger } from "pino";

import type {
  AgentClient,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ListModelsOptions,
  ListModesOptions,
} from "./agent-sdk-types.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
  ProviderRuntimeSettings,
} from "./provider-launch-config.js";
import { ClaudeAgentClient } from "./providers/claude-agent.js";
import { OpenCodeAgentClient } from "./providers/opencode-agent.js";
import {
  AGENT_PROVIDER_DEFINITIONS,
  getAgentProviderDefinition,
  type AgentProviderDefinition,
} from "./provider-manifest.js";

export type { AgentProviderDefinition };
export { AGENT_PROVIDER_DEFINITIONS, getAgentProviderDefinition };

export interface ProviderDefinition extends AgentProviderDefinition {
  createClient: (logger: Logger) => AgentClient;
  fetchModels: (options?: ListModelsOptions) => Promise<AgentModelDefinition[]>;
  fetchModes: (options?: ListModesOptions) => Promise<AgentMode[]>;
}

export type BuildProviderRegistryOptions = {
  runtimeSettings?: AgentProviderRuntimeSettingsMap;
  providerOverrides?: Record<string, ProviderOverride>;
};

function toRuntimeSettings(override?: ProviderOverride): ProviderRuntimeSettings | undefined {
  if (!override?.command && !override?.env) {
    return undefined;
  }
  return {
    command: override.command ? { mode: "replace", argv: override.command } : undefined,
    env: override.env,
  };
}

function applyOverrideToDefinition(
  definition: AgentProviderDefinition,
  override?: ProviderOverride,
): AgentProviderDefinition {
  if (!override) return definition;
  return {
    ...definition,
    label: override.label ?? definition.label,
    description: override.description ?? definition.description,
  };
}

function mapModel(provider: AgentProvider, model: AgentModelDefinition): AgentModelDefinition {
  return { ...model, provider };
}

function createProviderClient(logger: Logger, runtimeSettings?: ProviderRuntimeSettings): AgentClient {
  return new ClaudeAgentClient({ logger, runtimeSettings });
}

function createOpenCodeProviderClient(): AgentClient | null {
  const baseUrl = process.env.OPENCODE_BASE_URL;
  if (!baseUrl) {
    return null;
  }

  return new OpenCodeAgentClient({
    baseUrl,
    defaultModelId: process.env.OPENCODE_MODEL ?? "opencode/minimax-m2.5-free",
  });
}

export function buildProviderRegistry(
  logger: Logger,
  options?: BuildProviderRegistryOptions,
): Record<AgentProvider, ProviderDefinition> {
  const definitions = Object.fromEntries(
    AGENT_PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]),
  ) as Record<string, AgentProviderDefinition>;
  const claudeOverride = options?.providerOverrides?.claude;
  const claudeDefinition = applyOverrideToDefinition(definitions.claude!, claudeOverride);
  const claudeRuntimeSettings = options?.runtimeSettings?.claude ?? toRuntimeSettings(claudeOverride);
  const registry: Record<string, ProviderDefinition> = {
    claude: {
      ...claudeDefinition,
      createClient: (providerLogger) => createProviderClient(providerLogger, claudeRuntimeSettings),
      fetchModels: async (modelOptions) =>
        (await createProviderClient(logger, claudeRuntimeSettings).listModels(modelOptions)).map((model) =>
          mapModel("claude", model),
        ),
      fetchModes: async (modeOptions) =>
        (await createProviderClient(logger, claudeRuntimeSettings).listModes?.(modeOptions)) ?? claudeDefinition.modes,
    },
  };

  const openCodeClient = createOpenCodeProviderClient();
  if (openCodeClient && definitions.opencode) {
    const openCodeDefinition = applyOverrideToDefinition(
      definitions.opencode,
      options?.providerOverrides?.opencode,
    );
    registry.opencode = {
      ...openCodeDefinition,
      createClient: () => createOpenCodeProviderClient() ?? openCodeClient,
      fetchModels: async () => (await openCodeClient.listModels()).map((model) => mapModel("opencode", model)),
      fetchModes: async () => (await openCodeClient.listModes?.()) ?? openCodeDefinition.modes,
    };
  }

  return registry as Record<AgentProvider, ProviderDefinition>;
}

export function getProviderIds(
  registry: Record<AgentProvider, ProviderDefinition>,
): AgentProvider[] {
  return Object.keys(registry);
}

export const PROVIDER_REGISTRY = {} as Record<AgentProvider, ProviderDefinition>;

export function createAllClients(
  logger: Logger,
  options?: BuildProviderRegistryOptions,
): Record<AgentProvider, AgentClient> {
  const registry = buildProviderRegistry(logger, options);
  return Object.fromEntries(
    Object.entries(registry).map(([provider, definition]) => [provider, definition.createClient(logger)]),
  ) as Record<AgentProvider, AgentClient>;
}

export async function shutdownProviders(): Promise<void> {
  return;
}
