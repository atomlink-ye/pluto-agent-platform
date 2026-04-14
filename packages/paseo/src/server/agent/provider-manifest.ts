import { z } from "zod";
import type { AgentMode } from "./agent-sdk-types.js";

export type AgentModeColorTier = "safe" | "moderate" | "dangerous" | "planning";
export type AgentModeIcon = "ShieldCheck" | "ShieldAlert" | "ShieldOff";

export interface AgentModeVisuals {
  icon: AgentModeIcon;
  colorTier: AgentModeColorTier;
}

export type AgentProviderModeDefinition = Omit<AgentMode, "icon" | "colorTier"> & AgentModeVisuals;

export interface AgentProviderDefinition {
  id: string;
  label: string;
  description: string;
  defaultModeId: string | null;
  modes: AgentProviderModeDefinition[];
}

const CLAUDE_MODES: AgentProviderModeDefinition[] = [
  {
    id: "default",
    label: "Always Ask",
    description: "Prompts for permission the first time a tool is used",
    icon: "ShieldCheck",
    colorTier: "safe",
  },
  {
    id: "acceptEdits",
    label: "Accept File Edits",
    description: "Automatically approves edit-focused tools without prompting",
    icon: "ShieldAlert",
    colorTier: "moderate",
  },
  {
    id: "plan",
    label: "Plan Mode",
    description: "Analyze the codebase without executing tools or edits",
    icon: "ShieldCheck",
    colorTier: "planning",
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Skip all permission prompts (use with caution)",
    icon: "ShieldAlert",
    colorTier: "dangerous",
  },
];

export const AGENT_PROVIDER_DEFINITIONS: AgentProviderDefinition[] = [
  {
    id: "claude",
    label: "Claude",
    description: "Anthropic's multi-tool assistant with MCP support, streaming, and deep reasoning",
    defaultModeId: "default",
    modes: CLAUDE_MODES,
  },
];

export function getAgentProviderDefinition(
  provider: string,
  definitions: AgentProviderDefinition[] = AGENT_PROVIDER_DEFINITIONS,
): AgentProviderDefinition {
  const definition = definitions.find((entry) => entry.id === provider);
  if (!definition) {
    throw new Error(`Unknown agent provider: ${provider}`);
  }
  return definition;
}

export const BUILTIN_PROVIDER_IDS = AGENT_PROVIDER_DEFINITIONS.map((d) => d.id);
export const AGENT_PROVIDER_IDS = BUILTIN_PROVIDER_IDS;
export const AgentProviderSchema = z.string();

export function isValidAgentProvider(
  value: string,
  validIds: Iterable<string> = BUILTIN_PROVIDER_IDS,
): boolean {
  return Array.isArray(validIds) ? validIds.includes(value) : new Set(validIds).has(value);
}

export function getModeVisuals(
  provider: string,
  modeId: string,
  definitions: AgentProviderDefinition[],
): AgentModeVisuals | undefined {
  const definition = definitions.find((entry) => entry.id === provider);
  const mode = definition?.modes.find((m) => m.id === modeId);
  if (!mode) return undefined;
  return { icon: mode.icon, colorTier: mode.colorTier };
}
