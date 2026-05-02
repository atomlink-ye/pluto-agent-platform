import type { Agent, Scenario } from "../contracts/four-layer.js";
import type { ResolvedFourLayerSelection } from "./loader.js";

export interface RenderRolePromptOptions {
  runtimeTask?: string;
}

export function renderRolePrompt(
  selection: ResolvedFourLayerSelection,
  roleName: string,
  options: RenderRolePromptOptions = {},
): string {
  const agent = getRoleAgent(selection, roleName);
  const overlay = selection.overlays[roleName];
  const sections = [agent.value.system.trim()];

  if (roleName === selection.playbook.value.teamLead) {
    sections.push(renderAvailableRoles(selection));
    sections.push(["## Workflow", selection.playbook.value.workflow.trim()].join("\n"));
  }

  if (overlay?.prompt) {
    sections.push(["## Specialization", overlay.prompt.trim()].join("\n"));
  }

  if (overlay?.knowledge?.length) {
    sections.push([
      "## Knowledge",
      ...overlay.knowledge.map((entry) => [`### ${entry.ref}`, entry.content.trim()].join("\n")),
    ].join("\n\n"));
  }

  if (roleName === "evaluator" && overlay?.rubric) {
    sections.push(["## Rubric", overlay.rubric.content.trim()].join("\n"));
  }

  sections.push(["## Task", resolveTask(selection.scenario.value, options.runtimeTask)].join("\n"));
  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

export function renderAllRolePrompts(
  selection: ResolvedFourLayerSelection,
  options: RenderRolePromptOptions = {},
): Record<string, string> {
  const prompts: Record<string, string> = {};
  const roleNames = [selection.teamLead.value.name, ...selection.members.map((member) => member.value.name)];
  for (const roleName of roleNames) {
    prompts[roleName] = renderRolePrompt(selection, roleName, options);
  }
  return prompts;
}

function getRoleAgent(selection: ResolvedFourLayerSelection, roleName: string) {
  if (selection.teamLead.value.name === roleName) {
    return selection.teamLead;
  }
  const member = selection.members.find((candidate) => candidate.value.name === roleName);
  if (!member) {
    throw new Error(`unknown_role:${roleName}`);
  }
  return member;
}

function renderAvailableRoles(selection: ResolvedFourLayerSelection): string {
  const lines = ["## Available Roles"];
  const roles = [selection.teamLead, ...selection.members];
  for (const role of roles) {
    const description = role.value.description?.trim();
    lines.push(`- ${role.value.name}${description ? `: ${description}` : ""}`);
  }
  lines.push(
    "",
    "## Delegation / Spawn Template",
    "Before Pluto mechanically launches a teammate, emit exactly one canonical intent line:",
    "DELEGATE: <available-role-name> :: <specific task, expected output, dependencies, and citation requirements>",
    "If the runtime can truly spawn directly, you may instead emit:",
    "SPAWN: <available-role-name> :: <specific task, expected output, dependencies, and citation requirements>",
    "Only request roles listed above. Wait for each requested role's contribution before final reconciliation unless the workflow says otherwise.",
  );
  return lines.join("\n");
}

function resolveTask(scenario: Scenario, runtimeTask?: string): string {
  if (runtimeTask) {
    if (scenario.allowTaskOverride === false) {
      throw new Error(`task_override_not_allowed:${scenario.name}`);
    }
    return runtimeTask.trim();
  }
  if (scenario.task) {
    return scenario.task.trim();
  }
  throw new Error(`task_required:${scenario.name}`);
}
