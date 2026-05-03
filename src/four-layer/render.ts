import type { Agent, DispatchOrchestrationSource, Scenario } from "../contracts/four-layer.js";
import type { ResolvedFourLayerSelection } from "./loader.js";

export interface RenderRolePromptOptions {
  runtimeTask?: string;
  runId?: string;
  dispatchMode?: DispatchOrchestrationSource;
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
    sections.push(renderCoordinationGuidance(options.dispatchMode ?? "teamlead_chat"));
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

  if (selection.members.length > 0) {
    lines.push("", `Run ID: ${runId ?? "<runId>"}`);
  }

  return lines.join("\n");
}

function renderCoordinationGuidance(dispatchMode: DispatchOrchestrationSource): string {
  const guidance = [
    "## Coordination via SendMessage and TaskTools",
    "- Create tasks with `task.create({ role: <role>, instructions: <task>, dependsOn: [...] })`.",
    "- Coordinate teammates with `SendMessage({ to: <name>, summary?: <short>, message: <text-or-typed-envelope> })`.",
    "- Treat the shared task list as the source of truth for pending, in-progress, and completed work, but never edit mailbox.jsonl or tasks.json directly; Pluto owns those artifacts.",
    "- Read your inbox and completion notices before moving to downstream roles.",
    "- When a teammate needs plan approval, review the request in your inbox; Pluto owns posting the transport-backed `plan_approval_response` after delivery.",
    "- Final output must cite the completion message id for every required role.",
  ];

  if (dispatchMode !== "static_loop") {
    guidance.push(
      "- When you need a teammate to execute a task, post a `spawn_request` envelope to the chat room with `body: { schemaVersion: \"v1\", targetRole: <role>, taskId: <existing or new task id>, rationale?: <reason> }`. Pluto will validate against the playbook and dependsOn rules and create the worker session for you. When you're done with the run, post a `final_reconciliation` envelope with `body: { schemaVersion: \"v1\", summary, completedTaskIds }`.",
    );
  }

  return guidance.join("\n");
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
