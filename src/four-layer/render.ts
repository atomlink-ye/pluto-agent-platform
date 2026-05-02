import type { Agent, Scenario } from "../contracts/four-layer.js";
import type { ResolvedFourLayerSelection } from "./loader.js";

export interface RenderRolePromptOptions {
  runtimeTask?: string;
  runId?: string;
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
    sections.push(renderAvailableRoles(selection, options.runId));
    sections.push(["## Workflow", selection.playbook.value.workflow.trim()].join("\n"));
    sections.push(renderStageDeviationDiscipline());
    sections.push(renderWorkerCoordinationGuidance());
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

function renderAvailableRoles(selection: ResolvedFourLayerSelection, runId?: string): string {
  const lines = ["## Available Roles"];
  const roles = [selection.teamLead, ...selection.members];
  for (const role of roles) {
    const description = role.value.description?.trim();
    lines.push(`- ${role.value.name}${description ? `: ${description}` : ""}`);
  }

  const workerRoles = selection.members;
  if (workerRoles.length > 0) {
    lines.push("", "## Available Roles and Spawn Commands");
    lines.push("Use `paseo run` to spawn each worker role. Fill in `<prompt>` with the stage-specific task.");
    lines.push("Emit `STAGE: <from> -> <to>` before each `paseo run` invocation.");
    lines.push("");
    for (const role of workerRoles) {
      const provider = role.value.provider ?? "<provider>";
      const model = role.value.model ?? "<model>";
      const mode = role.value.mode ?? "<mode>";
      const labelRunId = runId ?? "<runId>";
      const cmd = `paseo run --provider ${provider} --model ${model} --mode ${mode} --cwd <workspace> --title ${role.value.name}-stage --label parent_run=${labelRunId} --label role=${role.value.name} --json --detach "<prompt>"`;
      lines.push(`- **${role.value.name}**: \`${cmd}\``);
    }
  }

  return lines.join("\n");
}

function renderStageDeviationDiscipline(): string {
  return [
    "",
    "## Stage and Deviation Discipline",
    "- Emit `STAGE: <from-stage-id> -> <to-stage-id>` BEFORE each `paseo run` invocation.",
    "- Emit `DEVIATION: <reason>` when you depart from the authored playbook workflow.",
    "- The from-stage should be the most recently completed or active stage; use `lead` as the initial from-stage.",
  ].join("\n");
}

function renderWorkerCoordinationGuidance(): string {
  return [
    "",
    "## Worker Coordination",
    "- After spawning a worker with `paseo run`, capture its ID from the JSON output.",
    "- Use `paseo wait <id>` to block until the worker completes.",
    "- Use `paseo logs <id> --filter text` to capture the worker's output before proceeding.",
    "- Feed worker outputs into downstream stages as instructed by the workflow.",
  ].join("\n");
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
