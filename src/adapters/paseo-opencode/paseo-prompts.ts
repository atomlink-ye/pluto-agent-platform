import { join } from "node:path";

import type {
  AgentRoleConfig,
  CoordinationTranscriptRefV0,
  TeamConfig,
  TeamPlaybookV0,
  TeamTask,
} from "../../contracts/types.js";
import { MAILBOX_RUNTIME_COLLAR } from "../../four-layer/render.js";

export interface BuildLeadPromptInput {
  task: TeamTask;
  role: AgentRoleConfig;
  team: TeamConfig;
  playbook?: TeamPlaybookV0;
  transcript?: CoordinationTranscriptRefV0;
}

/**
 * Build the system prompt for the lead agent.
 */
export function buildLeadPrompt(input: BuildLeadPromptInput): string {
  const { task, role, team, playbook, transcript } = input;
  const workerRoles = team.roles.filter((r) => r.kind === "worker");
  const playbookBlock = playbook ? JSON.stringify(playbook, null, 2) : "No playbook supplied; use legacy worker role order only.";
  const playbookStageLines = playbook?.stages.map((stage) =>
    `- ${stage.id} | ${stage.title} | role=${stage.roleId} | dependsOn=${stage.dependsOn.length > 0 ? stage.dependsOn.join(", ") : "none"}`,
  ) ?? [];
  const helperPromptActive = role.systemPrompt.includes(".pluto-runtime/pluto-mailbox");
  const helperAbsolutePath = join(task.workspacePath, ".pluto-runtime", "pluto-mailbox");
  const lines = [
    role.systemPrompt,
    "",
    "AGENT TEAMS V1.6 — read carefully:",
    "1. You are the team lead for a mailbox-and-task-list runtime.",
    "2. The mailbox mirror and shared task list are Pluto-owned, read-only coordination artifacts for this run. Never edit, rewrite, or recreate mailbox.jsonl, tasks.json, or synthetic coordination entries yourself.",
    "3. Follow the authored playbook order below when you summarize the run.",
    helperPromptActive
      ? "4. Use the Pluto runtime helper from the authored system prompt to inspect tasks, dispatch teammates, wait on completion, and finalize the run."
      : "4. Pluto will deliver teammate outputs through the shared mailbox and will ask you for the final summary with a SUMMARIZE message.",
    "5. Your final markdown must cite the teammate completion message ids Pluto provides.",
    "6. Do not emit legacy marker prefixes or delegation markers.",
    ...(helperPromptActive
      ? [
          `Runtime helper absolute path for this run: ${helperAbsolutePath}`,
          "If your current working directory is outside the run workspace, call that absolute helper path instead of guessing a relative ./.pluto-runtime path.",
        ]
      : ["After all teammate tasks complete, wait for Pluto's SUMMARIZE message."]),
    "",
    "Runtime: agent-teams-v1_6",
    `Selected playbook id: ${playbook?.id ?? "legacy-worker-order"}`,
    `Selected playbook title: ${playbook?.title ?? "Legacy worker order only"}`,
    `Selected playbook orchestration source: ${playbook?.orchestrationSource ?? "legacy_marker_fallback"}`,
    ...(playbookStageLines.length > 0
      ? ["Selected playbook stages:", ...playbookStageLines]
      : ["Selected playbook stages: legacy worker role order only."]),
    "",
    "Selected playbook JSON:",
    playbookBlock,
    "",
    `Mailbox kind: ${transcript?.kind ?? "shared_channel"}`,
    `Coordination handle: ${transcript?.roomRef ?? `mailbox:${task.id}`}`,
    MAILBOX_RUNTIME_COLLAR,
    "",
    `Task title: ${task.title}`,
    `Goal: ${task.prompt}`,
    `Workspace path: ${task.workspacePath}`,
  ];
  if (task.artifactPath) {
    lines.push(`Artifact path the team should converge on: ${task.artifactPath}`);
  }
  return lines.join("\n");
}

export interface BuildWorkerPromptInput {
  task: TeamTask;
  role: AgentRoleConfig;
  instructions: string;
  transcript?: CoordinationTranscriptRefV0;
}

/**
 * Build the system prompt for a worker agent.
 */
export function buildWorkerPrompt(input: BuildWorkerPromptInput): string {
  const { task, role, instructions, transcript } = input;
  const helperPromptActive = role.systemPrompt.includes(".pluto-runtime/pluto-mailbox");
  const helperAbsolutePath = join(task.workspacePath, ".pluto-runtime", "pluto-mailbox");
  const lines = [
    role.systemPrompt,
    "",
    `Task title: ${task.title}`,
    `Goal: ${task.prompt}`,
    `Workspace path: ${task.workspacePath}`,
    `Mailbox kind: ${transcript?.kind ?? "shared_channel"}`,
    `Mailbox reference: ${transcript?.roomRef ?? "not-provided"}`,
  ];
  if (task.artifactPath) {
    lines.push(`Artifact path the team should converge on: ${task.artifactPath}`);
  }
  if (helperPromptActive) {
    lines.push(`Runtime helper absolute path for this run: ${helperAbsolutePath}`);
    lines.push("If your current working directory is outside the run workspace, call that absolute helper path instead of guessing a relative ./.pluto-runtime path.");
  }
  lines.push(
    "",
    "Instructions from the Team Lead:",
    instructions,
    "",
    "Pluto owns mailbox.jsonl and tasks.json as read-only coordination artifacts. Never edit them directly.",
    "When you need to send a typed mailbox envelope back to the lead, use the coordination mechanism described earlier in your prompt instead of editing runtime-owned artifacts or inventing ad-hoc control prose.",
    "Work in the workspace directly. If the lead asks you to create or update files, make those changes before replying.",
    "Do not only describe intended edits when the task calls for an artifact change.",
    "Reply with your contribution only. Keep it concise (under 15 lines).",
  );
  return lines.join("\n");
}