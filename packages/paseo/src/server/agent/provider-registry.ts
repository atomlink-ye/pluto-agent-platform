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

export function buildProviderRegistry(
  logger: Logger,
  options?: BuildProviderRegistryOptions,
): Record<AgentProvider, ProviderDefinition> {
  const baseDefinition = AGENT_PROVIDER_DEFINITIONS[0]!;
  const override = options?.providerOverrides?.claude;
  const definition = applyOverrideToDefinition(baseDefinition, override);
  const runtimeSettings = options?.runtimeSettings?.claude ?? toRuntimeSettings(override);

  return {
    claude: {
      ...definition,
      createClient: (providerLogger) => createProviderClient(providerLogger, runtimeSettings),
      fetchModels: async (modelOptions) =>
        (await createProviderClient(logger, runtimeSettings).listModels(modelOptions)).map((model) =>
          mapModel("claude", model),
        ),
      fetchModes: async (modeOptions) =>
        (await createProviderClient(logger, runtimeSettings).listModes?.(modeOptions)) ?? definition.modes,
    },
  } as Record<AgentProvider, ProviderDefinition>;
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
