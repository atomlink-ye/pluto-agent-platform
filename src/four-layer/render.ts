import type { DispatchOrchestrationSource, Scenario } from "../contracts/four-layer.js";
import type { ResolvedFourLayerSelection } from "./loader.js";

export const MAILBOX_RUNTIME_COLLAR = "Mailbox files (mailbox.jsonl, per-role inbox files) and tasks.json are runtime-owned audit mirrors. Do not edit them directly. Use the provided message/coordination mechanism described in your task; the runtime mirrors your messages and task-list operations into these files for evidence.";

export interface RenderRolePromptOptions {
  runtimeTask?: string;
  runId?: string;
  dispatchMode?: DispatchOrchestrationSource;
  runtimeHelperMvp?: boolean;
}

export function renderRolePrompt(
  selection: ResolvedFourLayerSelection,
  roleName: string,
  options: RenderRolePromptOptions = {},
): string {
  const agent = getRoleAgent(selection, roleName);
  const overlay = selection.overlays[roleName];
  const sections = [agent.value.system.trim(), MAILBOX_RUNTIME_COLLAR];
  const dispatchMode = options.dispatchMode ?? "teamlead_chat";
  const runtimeHelperMvp = options.runtimeHelperMvp ?? false;

  if (roleName === selection.playbook.value.teamLead) {
    sections.push(renderAvailableRoles(selection, options.runId));
    sections.push(["## Workflow", selection.playbook.value.workflow.trim()].join("\n"));
    sections.push(renderCoordinationGuidance(roleName, selection.playbook.value.teamLead, dispatchMode, runtimeHelperMvp));
    if (dispatchMode !== "static_loop") {
      sections.push("When you receive an `evaluator_verdict` envelope with `verdict: \"fail\"`, you may post a `revision_request` envelope with `body: { schemaVersion: \"v1\", failedTaskId, failedVerdictMessageId, targetRole, instructions }` to ask the original generator role to revise; Pluto creates a fresh worker session and tracks the revision through `worker_complete`. To shut down the run early, post a `shutdown_request` envelope with `body: { schemaVersion: \"v1\", targetRole?, reason, timeoutMs? }`; teammates respond with `shutdown_response` and Pluto finalizes the run when all acknowledgments are received (or the timeout fires).");
    }
  }

  if (runtimeHelperMvp) {
    sections.push(renderRuntimeHelperGuidance(roleName, selection.playbook.value.teamLead));
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

  if (dispatchMode !== "static_loop") {
    if (roleName === "evaluator") {
      sections.push(
        runtimeHelperMvp
          ? "When your evaluation completes, post the verdict through the Pluto runtime helper instead of inline mailbox prose, then keep your textual reply concise."
          : "When your evaluation completes, post your `evaluator_verdict` envelope to the chat room with `body: {schemaVersion: 'v1', taskId, verdict, rationale?, failedRubricRef?}`. The runtime routes it to lead for revision decisions.",
      );
    }
    if (roleName !== selection.playbook.value.teamLead) {
      sections.push("If you receive a `shutdown_request` envelope, finish your current turn cleanly and post a `shutdown_response` envelope acknowledging.");
    }
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

function renderCoordinationGuidance(
  roleName: string,
  leadRoleName: string,
  dispatchMode: DispatchOrchestrationSource,
  runtimeHelperMvp: boolean,
): string {
  if (runtimeHelperMvp && roleName === leadRoleName) {
    const helper = runtimeHelperCommand();
    return [
      "## Coordination via Pluto runtime helper",
      `- Runtime helper path for this run: \`${helper}\`.`,
      "- Pluto injects your role/run context inside live agent sessions. If you test manually outside that runtime, add `--role <your-role-id>` before the command.",
      `- Start by running \`${helper} tasks\` to inspect the pre-seeded task ids for this run, and use the exact ids it returns. Do not guess playbook stage ids.`,
      `- Only use \`${helper}\` as yourself. Do not override \`--role\` on another role's behalf.`,
      `- Dispatch teammates by running \`${helper} spawn --task <taskId> --role <roleId> --rationale <why>\`. This authors the transport-backed \`spawn_request\` envelope through Pluto's helper instead of relying on prose-only SendMessage instructions.`,
      `- If you need a generic typed envelope, run \`${helper} send --to <role> --kind <kind> --body-json '<json>'\`.`,
      `- After the required tasks are complete, run \`${helper} finalize --summary <summary> --completed-task <taskId> ...\` to author \`final_reconciliation\` yourself.`,
      `- After spawning a teammate, wait for that exact task to reach \`completed\` before moving downstream. Prefer \`${helper} wait --task <taskId> --status completed --timeout 600000\` to block on Pluto's side instead of sleeping or polling mailbox.jsonl, tasks.json, or directory listings.`,
      "- In this opt-in MVP mode Pluto does not auto-post the first/next `spawn_request` or the final reconciliation for you.",
      "- Never edit mailbox.jsonl or tasks.json directly; the helper is the runtime API surface.",
    ].join("\n");
  }

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

function renderRuntimeHelperGuidance(roleName: string, leadRoleName: string): string {
  const helper = runtimeHelperCommand();
  const lines = [
    "## Pluto runtime helper",
    `- Runtime helper path for this run: \`${helper}\`.`,
    "- Pluto injects your role/run context inside live agent sessions. If you test manually outside that runtime, add `--role <your-role-id>` before the command.",
    `- Use \`${helper} tasks\` to inspect the current run task list without editing runtime-owned files.`,
    `- Use \`${helper} send --to <role> --kind <kind> --body-json '<json>'\` when you need a generic mailbox envelope through Pluto's runtime API.`,
  ];

  if (roleName !== leadRoleName) {
    lines.push(`- Only use \`${helper}\` for your own role. Do not override \`--role\` for someone else, and do not complete a task that is still pending or assigned to someone else.`);
    lines.push(`- Start with \`${helper} tasks\`, locate the task assigned to \`${roleName}\`, and wait for that task to become \`in_progress\` before doing work or posting completion.`);
    lines.push(`- Do not rely on Pluto to synthesize completion for you. When your assigned task is done, run \`${helper} complete --task <taskId> --summary <one-line-summary>\` to post \`worker_complete\`.`);
    lines.push(`- If you need to wait for task progress in your lane, run \`${helper} wait --task <taskId> --status <pending|in_progress|completed> [--timeout <ms>]\` instead of sleeping or polling mailbox/task files.`);
    if (roleName === "evaluator") {
      lines.push(`- Evaluator verdicts must also go through the helper: \`${helper} verdict --task <taskId> --verdict <pass|fail> --rationale <why> [--failed-rubric-ref <ref>]\`.`);
    }
  }

  return lines.join("\n");
}

function runtimeHelperCommand(): string {
  return "./.pluto-runtime/pluto-mailbox";
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
