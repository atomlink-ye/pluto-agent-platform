import type { SkillCatalogEntryV0 } from "../catalog/contracts.js";
import {
  getCuratedDefaultCatalogSeed,
  seedDefaultCatalog,
  type DefaultCatalogSeed,
  type DefaultCatalogSeedSource,
  type SeedDefaultCatalogOptions,
} from "../catalog/seed.js";
import type { AgentRoleId, RuntimeRequirementsV0, TeamConfig } from "../contracts/types.js";
import type {
  PortableNameRefSetV0,
  PortableWorkflowArtifactExpectationV0,
  PortableWorkflowLogicalRefsV0,
} from "../portable-workflow/contracts.js";
import { DEFAULT_GOVERNANCE_SEED_IDS } from "../governance/seed.js";

type DefaultTeamSeedLinks = {
  defaultPlaybookId: string;
  defaultScenarioId: string;
};

type DefaultTeamConfig = TeamConfig & DefaultTeamSeedLinks;
type CatalogRef = { id: string; version: string };

export interface RoleCatalogSelection {
  entry: CatalogRef;
  workerRole: CatalogRef;
  skill: CatalogRef;
  template?: CatalogRef;
  policyPack?: CatalogRef;
}

export interface TeamCatalogSelection {
  source: DefaultCatalogSeedSource;
  roles: Record<AgentRoleId, RoleCatalogSelection>;
}

const TEAM_ENTRY_IDS: Record<AgentRoleId, SkillCatalogEntryV0["id"]> = {
  lead: "default-lead",
  planner: "default-planner",
  generator: "default-generator",
  evaluator: "default-evaluator",
};

const ROLE_ORDER: AgentRoleId[] = ["lead", "planner", "generator", "evaluator"];
const teamSelectionRegistry = new WeakMap<TeamConfig, TeamCatalogSelection>();

/**
 * MVP-alpha static team. The lead must dispatch every other role at least once.
 */
export const DEFAULT_TEAM: DefaultTeamConfig = buildDefaultTeam();

export function buildDefaultTeam(opts: SeedDefaultCatalogOptions = {}): DefaultTeamConfig {
  return materializeDefaultTeam(seedDefaultCatalog(opts));
}

export function getRoleCatalogSelection(
  team: TeamConfig,
  roleId: AgentRoleId,
): RoleCatalogSelection | null {
  return teamSelectionRegistry.get(team)?.roles[roleId] ?? null;
}

function materializeDefaultTeam(seed: DefaultCatalogSeed): DefaultTeamConfig {
  const fallbackSeed = getCuratedDefaultCatalogSeed();
  const selections = {} as Record<AgentRoleId, RoleCatalogSelection>;
  const roles = ROLE_ORDER.map((roleId) => {
    const fallbackEntry = requireEntry(fallbackSeed, TEAM_ENTRY_IDS[roleId]);
    const selectedEntry = selectEntry(seed, TEAM_ENTRY_IDS[roleId]);
    const entry = selectedEntry ?? fallbackEntry;
    const fallbackWorkerRole = requireWorkerRole(
      fallbackSeed,
      fallbackEntry.workerRole.id,
      fallbackEntry.workerRole.version,
    );
    const workerRole = selectedEntry && isFileBackedEntry(seed, selectedEntry)
      ? findWorkerRole(seed, entry.workerRole.id, entry.workerRole.version) ?? fallbackWorkerRole
      : fallbackWorkerRole;

    selections[roleId] = {
      entry: { id: entry.id, version: entry.version },
      workerRole: { id: workerRole.id, version: workerRole.version },
      skill: { id: entry.skill.id, version: entry.skill.version },
      ...(entry.template ? { template: entry.template } : {}),
      ...(entry.policyPack ? { policyPack: entry.policyPack } : {}),
    };

    return {
      id: roleId,
      name: workerRole.name,
      kind: roleId === "lead" ? "team_lead" as const : "worker" as const,
      systemPrompt: workerRole.systemPrompt,
    };
  });

  const team: DefaultTeamConfig = {
    id: "default-mvp-alpha",
    name: "Default Pluto MVP-alpha team",
    leadRoleId: "lead",
    defaultPlaybookId: DEFAULT_GOVERNANCE_SEED_IDS.playbookId,
    defaultScenarioId: DEFAULT_GOVERNANCE_SEED_IDS.scenarioId,
    roles,
  };
  teamSelectionRegistry.set(team, { source: seed.source, roles: selections });
  return team;
}

function selectEntry(seed: DefaultCatalogSeed, entryId: SkillCatalogEntryV0["id"]): SkillCatalogEntryV0 | null {
  return seed.entries.find(
    (candidate) => candidate.id === entryId && candidate.status === "active" && candidate.reviewStatus === "approved",
  ) ?? null;
}

function requireEntry(seed: DefaultCatalogSeed, entryId: SkillCatalogEntryV0["id"]): SkillCatalogEntryV0 {
  const entry = selectEntry(seed, entryId);
  if (!entry) {
    throw new Error(`default_team_missing_entry:${entryId}`);
  }
  return entry;
}

function requireWorkerRole(seed: DefaultCatalogSeed, roleId: string, version: string) {
  const workerRole = findWorkerRole(seed, roleId, version);
  if (!workerRole) {
    throw new Error(`default_team_missing_worker_role:${roleId}@${version}`);
  }
  return workerRole;
}

function findWorkerRole(seed: DefaultCatalogSeed, roleId: string, version: string) {
  return seed.workerRoles.find(
    (candidate) => candidate.id === roleId && candidate.version === version && candidate.status === "active",
  ) ?? null;
}

function isFileBackedEntry(seed: DefaultCatalogSeed, entry: CatalogRef) {
  return seed.fileBackedKeys.entries.has(`${entry.id}@${entry.version}`);
}

export const DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0: RuntimeRequirementsV0 = {
  runtimeIds: ["opencode-live"],
  adapterIds: ["paseo-opencode"],
  providers: ["opencode"],
  model: {
    ids: ["opencode/minimax-m2.5-free"],
    families: ["minimax"],
    modes: ["build"],
    minContextWindowTokens: 128_000,
  },
  tools: {
    shell: true,
  },
  files: {
    read: true,
    write: true,
    workspaceRootOnly: true,
  },
  callbacks: {
    followUpMessages: true,
    eventStream: true,
    backgroundSessions: true,
  },
  locality: ["remote"],
  posture: ["workspace_write"],
  limits: {
    minExecutionMs: 180_000,
  },
};

export const DEFAULT_TEAM_ENV_REFS_V0: PortableNameRefSetV0 = {
  required: ["OPENCODE_BASE_URL"],
  optional: ["PASEO_BIN", "PASEO_PROVIDER"],
};

export const DEFAULT_TEAM_SECRET_REFS_V0: PortableNameRefSetV0 = {
  required: ["OPENCODE_API_KEY"],
};

export const DEFAULT_TEAM_ARTIFACT_EXPECTATION_V0: PortableWorkflowArtifactExpectationV0 = {
  format: "markdown",
  required: true,
  workspaceRelativeArtifactPathOnly: true,
  leadSummaryRequired: true,
  contributionRoleOrder: ["planner", "generator", "evaluator"],
};

export const DEFAULT_TEAM_LOGICAL_REFS_V0: PortableWorkflowLogicalRefsV0 = {
  teamId: DEFAULT_TEAM.id,
  leadRoleId: DEFAULT_TEAM.leadRoleId,
  roleIds: DEFAULT_TEAM.roles.map((role) => role.id),
  runtimeIds: DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0.runtimeIds ?? [],
  adapterIds: DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0.adapterIds ?? [],
  providers: DEFAULT_TEAM_RUNTIME_REQUIREMENTS_V0.providers ?? [],
  artifactRefs: ["final-artifact.markdown", "lead-summary", "worker-contributions"],
};

export function getRole(team: TeamConfig, id: string) {
  const role = team.roles.find((r) => r.id === id);
  if (!role) {
    throw new Error(`role_not_found:${id}`);
  }
  return role;
}
