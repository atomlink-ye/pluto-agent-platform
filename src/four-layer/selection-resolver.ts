import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { Agent, FourLayerAuthoredObjectKind, Scenario } from "../contracts/four-layer.js";
import {
  FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES,
  FOUR_LAYER_KNOWLEDGE_MAX_REFS,
  FOUR_LAYER_KNOWLEDGE_MAX_TOTAL_BYTES,
  FourLayerLoaderError,
  type FourLayerWorkspace,
  type LoadedFourLayerObject,
  type ResolvedFourLayerSelection,
  type ResolvedScenarioOverlay,
  type ResolvedTextRef,
} from "./loader-shared.js";

export async function resolveFourLayerSelection(
  workspace: FourLayerWorkspace,
  selection: { scenario: string; runProfile?: string; playbook?: string },
): Promise<ResolvedFourLayerSelection> {
  const scenario = requireFromMap(workspace.scenarios, selection.scenario, "scenario");
  const playbookName = selection.playbook ?? scenario.value.playbook;
  const playbookOverridden = Boolean(selection.playbook && selection.playbook !== scenario.value.playbook);

  const playbook = requireFromMap(workspace.playbooks, playbookName, "playbook");
  const teamLead = requireFromMap(workspace.agents, playbook.value.teamLead, "agent");
  const members = playbook.value.members.map((memberName) => requireFromMap(workspace.agents, memberName, "agent"));
  const overlayNames = new Set([playbook.value.teamLead, ...playbook.value.members]);
  const overlays = await resolveScenarioOverlays(workspace.rootDir, scenario, overlayNames, members, playbookOverridden);

  const runProfile = selection.runProfile
    ? requireFromMap(workspace.runProfiles, selection.runProfile, "run_profile")
    : undefined;

  return {
    rootDir: workspace.rootDir,
    playbook,
    scenario,
    runProfile,
    teamLead,
    members,
    overlays,
  };
}

async function resolveScenarioOverlays(
  rootDir: string,
  scenario: LoadedFourLayerObject<Scenario>,
  allowedRoles: Set<string>,
  members: LoadedFourLayerObject<Agent>[],
  ignoreUnknownRoles: boolean,
): Promise<Record<string, ResolvedScenarioOverlay>> {
  const overlays = scenario.value.overlays ?? {};
  const memberNames = new Set(members.map((member) => member.value.name));
  const resolved: Record<string, ResolvedScenarioOverlay> = {};

  for (const [roleName, overlay] of Object.entries(overlays)) {
    if (!allowedRoles.has(roleName)) {
      if (ignoreUnknownRoles) {
        continue;
      }
      throw new FourLayerLoaderError(`unknown_overlay_role:${scenario.value.name}`, [
        `scenario ${scenario.value.name} overlay targets unknown role ${roleName}`,
      ]);
    }

    const knowledge = await resolveKnowledgeRefs(rootDir, scenario.path, scenario.value.name, roleName, overlay.knowledgeRefs ?? []);
    let rubric: ResolvedTextRef | undefined;
    if (overlay.rubricRef) {
      if (roleName !== "evaluator") {
        throw new FourLayerLoaderError(`invalid_rubric_role:${scenario.value.name}`, [
          `scenario ${scenario.value.name} can only attach rubricRef to evaluator, not ${roleName}`,
        ]);
      }
      if (!memberNames.has(roleName)) {
        throw new FourLayerLoaderError(`missing_rubric_role:${scenario.value.name}`, [
          `scenario ${scenario.value.name} references evaluator rubric but playbook has no evaluator member`,
        ]);
      }
      rubric = await resolveTextRef(rootDir, scenario.path, overlay.rubricRef, `scenario ${scenario.value.name} overlay ${roleName} rubricRef`);
    }

    resolved[roleName] = {
      roleName,
      ...(overlay.prompt ? { prompt: overlay.prompt } : {}),
      ...(knowledge.length > 0 ? { knowledge } : {}),
      ...(rubric ? { rubric } : {}),
    };
  }

  return resolved;
}

async function resolveKnowledgeRefs(
  rootDir: string,
  scenarioPath: string,
  scenarioName: string,
  roleName: string,
  refs: string[],
): Promise<ResolvedTextRef[]> {
  if (refs.length > FOUR_LAYER_KNOWLEDGE_MAX_REFS) {
    throw new FourLayerLoaderError(`knowledge_ref_limit_exceeded:${scenarioName}:${roleName}`, [
      `scenario ${scenarioName} overlay ${roleName} exceeds knowledge ref cap ${FOUR_LAYER_KNOWLEDGE_MAX_REFS}`,
    ]);
  }

  const resolved = await Promise.all(
    refs.map((ref) => resolveTextRef(rootDir, scenarioPath, ref, `scenario ${scenarioName} overlay ${roleName} knowledge ref`)),
  );

  let totalBytes = 0;
  for (const entry of resolved) {
    if (entry.bytes > FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES) {
      throw new FourLayerLoaderError(`knowledge_ref_too_large:${scenarioName}:${roleName}`, [
        `${entry.ref} exceeds per-ref cap ${FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES}`,
      ]);
    }
    totalBytes += entry.bytes;
  }

  if (totalBytes > FOUR_LAYER_KNOWLEDGE_MAX_TOTAL_BYTES) {
    throw new FourLayerLoaderError(`knowledge_total_too_large:${scenarioName}:${roleName}`, [
      `scenario ${scenarioName} overlay ${roleName} exceeds total knowledge cap ${FOUR_LAYER_KNOWLEDGE_MAX_TOTAL_BYTES}`,
    ]);
  }

  return resolved;
}

async function resolveTextRef(
  rootDir: string,
  scenarioPath: string,
  ref: string,
  label: string,
): Promise<ResolvedTextRef> {
  const candidatePaths = new Set<string>();
  if (isAbsolute(ref)) {
    candidatePaths.add(ref);
  } else {
    candidatePaths.add(resolve(rootDir, ref));
    candidatePaths.add(resolve(dirname(scenarioPath), ref));
  }

  for (const path of candidatePaths) {
    try {
      const content = await readFile(path, "utf8");
      return { ref, path, content, bytes: Buffer.byteLength(content, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new FourLayerLoaderError(`missing_ref:${ref}`, [`${label} not found: ${ref}`]);
}

function requireFromMap<T>(
  map: Map<string, LoadedFourLayerObject<T>>,
  name: string,
  kind: FourLayerAuthoredObjectKind,
): LoadedFourLayerObject<T> {
  const value = map.get(name);
  if (!value) {
    throw new FourLayerLoaderError(`missing_${kind}:${name}`, [`missing ${kind} reference: ${name}`]);
  }
  return value;
}
