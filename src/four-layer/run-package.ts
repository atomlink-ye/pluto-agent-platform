import { join, resolve } from "node:path";

import type { AgentRoleConfig, TeamConfig, TeamPlaybookV0 } from "../contracts/types.js";
import type { DispatchOrchestrationSource, RunProfile } from "../contracts/four-layer.js";
import {
  loadFourLayerWorkspace,
  resolveFourLayerSelection,
  type LoadedFourLayerObject,
  type ResolvedFourLayerSelection,
} from "./loader.js";
import { renderAllRolePrompts } from "./render.js";

export interface RunPackageSelection {
  scenario: string;
  runProfile?: string;
  playbook?: string;
  runtimeTask?: string;
}

export interface CompileRunPackageOptions {
  rootDir: string;
  selection: RunPackageSelection;
  runId?: string;
  workspaceOverride?: string;
  workspaceSubdirPerRun?: boolean;
  dispatchMode?: DispatchOrchestrationSource;
  runtimeHelperMvp?: boolean;
}

export interface RunPackageSourceRef {
  name: string;
  path: string;
}

export interface RunPackageRole {
  name: string;
  kind: "team_lead" | "worker";
  description?: string;
  model: string;
  provider?: string;
  mode?: string;
  sourcePath: string;
}

export interface RunPackageWorkspace {
  cwd: string;
  materializedCwd: string;
  worktree?: {
    branch: string;
    path: string;
    baseRef?: string;
    materializedPath: string;
  };
}

export interface RunPackage {
  schemaVersion: 0;
  kind: "run_package";
  runId: string;
  rootDir: string;
  selection: {
    scenario: string;
    playbook: string;
    runProfile?: string;
    runtimeTask?: string;
  };
  task: string;
  dispatchMode: DispatchOrchestrationSource;
  sources: {
    scenario: RunPackageSourceRef;
    playbook: RunPackageSourceRef;
    runProfile?: RunPackageSourceRef;
    agents: RunPackageSourceRef[];
  };
  roles: RunPackageRole[];
  workspace: RunPackageWorkspace;
  prompts: Record<string, string>;
  team: TeamConfig;
  adapterPlaybook: TeamPlaybookV0;
  audit?: {
    requiredRoles?: string[];
    maxRevisionCycles?: number;
    finalReportSections?: string[];
  };
}

export interface CompiledRunPackage {
  package: RunPackage;
  resolved: ResolvedFourLayerSelection;
}

export async function compileRunPackage(options: CompileRunPackageOptions): Promise<CompiledRunPackage> {
  const rootDir = resolve(options.rootDir);
  const workspace = await loadFourLayerWorkspace(rootDir);
  const resolved = await resolveFourLayerSelection(workspace, options.selection);
  return compileResolvedRunPackage(resolved, {
    rootDir,
    selection: options.selection,
    runId: options.runId ?? "inspect-run",
    workspaceOverride: options.workspaceOverride,
    workspaceSubdirPerRun: options.workspaceSubdirPerRun ?? false,
    dispatchMode: options.dispatchMode ?? "teamlead_chat",
    runtimeHelperMvp: options.runtimeHelperMvp ?? false,
  });
}

export function compileResolvedRunPackage(
  resolved: ResolvedFourLayerSelection,
  options: Required<Pick<CompileRunPackageOptions, "rootDir" | "selection" | "runId" | "workspaceSubdirPerRun" | "dispatchMode" | "runtimeHelperMvp">> &
    Pick<CompileRunPackageOptions, "workspaceOverride">,
): CompiledRunPackage {
  const task = resolveRunPackageTask(
    resolved.scenario.value.task,
    options.selection.runtimeTask,
    resolved.scenario.value.allowTaskOverride,
  );
  const prompts = renderAllRolePrompts(resolved, {
    runtimeTask: task,
    runId: options.runId,
    dispatchMode: options.dispatchMode,
    runtimeHelperMvp: options.runtimeHelperMvp,
  });
  const team = buildRunPackageTeamConfig(resolved, prompts);
  const runProfile = resolved.runProfile?.value;
  const workspaceDir = resolveRunPackageWorkspaceDir(
    options.rootDir,
    runProfile?.workspace.cwd,
    options.runId,
    options.workspaceOverride,
    options.workspaceSubdirPerRun,
  );
  const materializedCwd = resolveRunPackageWorktreeDir(
    options.rootDir,
    runProfile?.workspace.worktree?.path,
    workspaceDir,
    options.runId,
  );

  const runPackage: RunPackage = {
    schemaVersion: 0,
    kind: "run_package",
    runId: options.runId,
    rootDir: options.rootDir,
    selection: {
      scenario: resolved.scenario.value.name,
      playbook: resolved.playbook.value.name,
      ...(resolved.runProfile ? { runProfile: resolved.runProfile.value.name } : {}),
      ...(options.selection.runtimeTask ? { runtimeTask: task } : {}),
    },
    task,
    dispatchMode: options.dispatchMode,
    sources: {
      scenario: sourceRef(resolved.scenario),
      playbook: sourceRef(resolved.playbook),
      ...(resolved.runProfile ? { runProfile: sourceRef(resolved.runProfile) } : {}),
      agents: [resolved.teamLead, ...resolved.members].map(sourceRef),
    },
    roles: [resolved.teamLead, ...resolved.members].map((entry) => ({
      name: entry.value.name,
      kind: entry.value.name === resolved.playbook.value.teamLead ? "team_lead" : "worker",
      ...(entry.value.description ? { description: entry.value.description } : {}),
      model: entry.value.model,
      ...(entry.value.provider ? { provider: entry.value.provider } : {}),
      ...(entry.value.mode ? { mode: entry.value.mode } : {}),
      sourcePath: entry.path,
    })),
    workspace: buildRunPackageWorkspace(runProfile, options.rootDir, workspaceDir, materializedCwd, options.runId),
    prompts,
    team,
    adapterPlaybook: buildRunPackageAdapterPlaybook(resolved),
    ...(resolved.playbook.value.audit ? { audit: resolved.playbook.value.audit } : {}),
  };

  return { package: runPackage, resolved };
}

function buildRunPackageTeamConfig(
  resolved: ResolvedFourLayerSelection,
  prompts: Record<string, string>,
): TeamConfig {
  const roles: AgentRoleConfig[] = [resolved.teamLead, ...resolved.members].map((entry) => ({
    id: entry.value.name as AgentRoleConfig["id"],
    name: entry.value.name,
    kind: entry.value.name === resolved.playbook.value.teamLead ? "team_lead" : "worker",
    systemPrompt: prompts[entry.value.name] ?? entry.value.system,
  }));
  return {
    id: resolved.playbook.value.name,
    name: resolved.playbook.value.description ?? resolved.playbook.value.name,
    leadRoleId: resolved.playbook.value.teamLead as TeamConfig["leadRoleId"],
    roles,
  };
}

function buildRunPackageAdapterPlaybook(resolved: ResolvedFourLayerSelection): TeamPlaybookV0 {
  const stages = resolved.members.map((member, index) => ({
    id: `${member.value.name}-stage`,
    kind: inferRunPackageStageKind(member.value.name),
    roleId: member.value.name as AgentRoleConfig["id"],
    title: member.value.description ?? member.value.name,
    instructions: `Handle the ${member.value.name} task for scenario ${resolved.scenario.value.name}.`,
    dependsOn: index === 0 ? [] : [`${resolved.members[index - 1]!.value.name}-stage`],
    evidenceCitation: { required: true, label: member.value.name },
  })) satisfies TeamPlaybookV0["stages"];
  return {
    schemaVersion: 0,
    id: resolved.playbook.value.name,
    title: resolved.playbook.value.description ?? resolved.playbook.value.name,
    description: resolved.playbook.value.workflow,
    orchestrationSource: "teamlead_direct",
    stages,
    revisionRules: [],
    finalCitationMetadata: {
      requiredStageIds: stages.map((stage) => stage.id),
      requireFinalReconciliation: true,
    },
  };
}

function resolveRunPackageTask(
  scenarioTask: string | undefined,
  runtimeTask: string | undefined,
  allowTaskOverride: boolean | undefined,
): string {
  if (runtimeTask) {
    if (allowTaskOverride === false) {
      throw new Error("task_override_not_allowed");
    }
    return runtimeTask;
  }
  if (!scenarioTask) {
    throw new Error("scenario_task_missing");
  }
  return scenarioTask;
}

function resolveRunPackageWorkspaceDir(
  rootDir: string,
  configuredCwd: string | undefined,
  runId: string,
  override?: string,
  workspaceSubdirPerRun = false,
): string {
  if (override) return workspaceSubdirPerRun ? resolve(override, ".pluto-run-workspaces", runId) : resolve(override);
  return resolve(interpolateRunPackagePath(configuredCwd ?? join(rootDir, ".tmp", "manager-runs", runId), rootDir, runId, rootDir));
}

function resolveRunPackageWorktreeDir(
  rootDir: string,
  worktreePath: string | undefined,
  workspaceDir: string,
  runId: string,
): string {
  if (!worktreePath) return workspaceDir;
  return resolve(interpolateRunPackagePath(worktreePath, rootDir, runId, workspaceDir));
}

function materializeRunPackageWorkspace(
  workspace: NonNullable<RunProfile["workspace"]>,
  rootDir: string,
  workspaceDir: string,
  runId: string,
): NonNullable<RunProfile["workspace"]> {
  return {
    cwd: interpolateRunPackagePath(workspace.cwd, rootDir, runId, workspaceDir),
    ...(workspace.worktree
      ? {
          worktree: {
            branch: interpolateRunPackagePath(workspace.worktree.branch, rootDir, runId, workspaceDir),
            path: interpolateRunPackagePath(workspace.worktree.path, rootDir, runId, workspaceDir),
            ...(workspace.worktree.baseRef ? { baseRef: workspace.worktree.baseRef } : {}),
          },
        }
      : {}),
  };
}

function buildRunPackageWorkspace(
  runProfile: RunProfile | undefined,
  rootDir: string,
  workspaceDir: string,
  materializedCwd: string,
  runId: string,
): RunPackageWorkspace {
  if (!runProfile) {
    return { cwd: workspaceDir, materializedCwd };
  }
  const materialized = materializeRunPackageWorkspace(runProfile.workspace, rootDir, workspaceDir, runId);
  return {
    cwd: materialized.cwd,
    materializedCwd,
    ...(materialized.worktree && runProfile.workspace.worktree
      ? {
          worktree: {
            branch: materialized.worktree.branch,
            path: materialized.worktree.path,
            ...(materialized.worktree.baseRef ? { baseRef: materialized.worktree.baseRef } : {}),
            materializedPath: materializedCwd,
          },
        }
      : {}),
  };
}

function interpolateRunPackagePath(value: string, rootDir: string, runId: string, cwd: string): string {
  return value.replaceAll("${repo_root}", rootDir).replaceAll("${run_id}", runId).replaceAll("${cwd}", cwd);
}

function sourceRef<T extends { name: string }>(entry: LoadedFourLayerObject<T>): RunPackageSourceRef {
  return { name: entry.value.name, path: entry.path };
}

function inferRunPackageStageKind(roleId: string): TeamPlaybookV0["stages"][number]["kind"] {
  switch (roleId) {
    case "planner":
      return "plan";
    case "generator":
      return "generate";
    case "evaluator":
      return "evaluate";
    default:
      return "synthesize";
  }
}
