import type { ActorRef, RunEvent } from '@pluto/v2-core';

import type { LoadedPlaybook } from '../../loader/authored-spec-loader.js';
import { PLUTO_TOOL_DESCRIPTORS, type PlutoToolName } from '../../tools/pluto-tool-schemas.js';
import type { PromptView } from './prompt-view.js';

export interface AgenticToolPromptInput {
  readonly actor: ActorRef;
  readonly role: string | null;
  readonly promptView: PromptView;
  readonly playbook: LoadedPlaybook | null;
  readonly userTask: string | null;
  readonly toolNames: ReadonlyArray<PlutoToolName>;
  readonly wrapperPath: string;
  readonly maxBytes?: number;
}

export type TaskView = PromptView['tasks'][number];
export type MailboxMessageView = PromptView['mailbox'][number];
export type ArtifactView = PromptView['artifacts'][number];
export type PromptViewDelegation = PromptView['activeDelegation'];
export type PromptViewBudgets = PromptView['budgets'];
export type PromptViewRejection = PromptView['lastRejection'];

export interface WakeupPromptDelta {
  readonly newTasks: readonly TaskView[];
  readonly updatedTasks: readonly TaskView[];
  readonly newMailbox: readonly MailboxMessageView[];
  readonly newArtifacts: readonly ArtifactView[];
  readonly delegation: PromptViewDelegation;
  readonly budgets: PromptViewBudgets;
  readonly lastRejection: PromptViewRejection;
}

export interface WakeupPromptInput {
  readonly actor: ActorRef;
  readonly latestEvent: RunEvent;
  readonly delta: WakeupPromptDelta;
}

export const DEFAULT_AGENTIC_TOOL_PROMPT_MAX_BYTES = 32 * 1024;

const LEAD_FRAMING = [
  '**Never delegate understanding.** You stay responsible for',
  'what success looks like and whether the run is meeting it.',
  'The PromptView is a snapshot — verify it via tool use',
  '(read / grep / bash / glob) when the situation is non-trivial.',
].join('\n');

type PromptViewTrimOptions = {
  readonly mailboxLimit: number;
  readonly taskLimit: number;
  readonly artifactLimit: number;
  readonly bodyBytes: number;
  readonly taskTitleBytes: number;
  readonly errorBytes: number;
  readonly summaryBytes: number;
};

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  if (utf8Bytes(value) <= maxBytes) {
    return value;
  }

  const ellipsis = '\n...[truncated]';
  if (maxBytes <= utf8Bytes(ellipsis)) {
    return ellipsis.slice(0, Math.max(0, maxBytes));
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${value.slice(0, mid)}${ellipsis}`;
    if (utf8Bytes(candidate) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return `${value.slice(0, low)}${ellipsis}`;
}

function isLeadActor(actor: ActorRef): boolean {
  return actor.kind === 'role' && actor.role === 'lead';
}

function actorLabel(actor: ActorRef, role: string | null): string {
  if (role != null && role.length > 0) {
    return role;
  }

  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return actor.role;
  }
}

function promptViewForActor(actor: ActorRef, view: PromptView): PromptView {
  if (isLeadActor(actor)) {
    return view;
  }

  return {
    ...view,
    userTask: null,
  };
}

function extractRolePlaybookSlice(playbookBody: string, role: string | null): string {
  if (role == null || role === 'lead') {
    return playbookBody;
  }

  const lines = playbookBody.split('\n');
  const headingPattern = new RegExp(`^##\\s+${role}\\s*$`, 'i');
  const sectionStart = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (sectionStart === -1) {
    return playbookBody;
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index]?.trim() ?? '')) {
      sectionEnd = index;
      break;
    }
  }

  return lines.slice(sectionStart, sectionEnd).join('\n').trim();
}

function trimPromptView(view: PromptView, options: PromptViewTrimOptions): PromptView {
  return {
    ...view,
    userTask: view.userTask == null ? null : truncateToBytes(view.userTask, options.summaryBytes),
    tasks: view.tasks.slice(-options.taskLimit).map((task) => ({
      ...task,
      title: truncateToBytes(task.title, options.taskTitleBytes),
    })),
    mailbox: view.mailbox.slice(-options.mailboxLimit).map((message) => ({
      ...message,
      body: truncateToBytes(message.body, options.bodyBytes),
    })),
    artifacts: view.artifacts.slice(-options.artifactLimit),
    lastRejection: view.lastRejection == null
      ? null
      : {
          directive: view.lastRejection.directive,
          error: truncateToBytes(view.lastRejection.error, options.errorBytes),
        },
  };
}

function promptViewCandidates(view: PromptView): readonly string[] {
  const variants: readonly PromptView[] = [
    view,
    trimPromptView(view, {
      mailboxLimit: view.mailbox.length,
      taskLimit: view.tasks.length,
      artifactLimit: view.artifacts.length,
      bodyBytes: 1024,
      taskTitleBytes: 512,
      errorBytes: 512,
      summaryBytes: 512,
    }),
    trimPromptView(view, {
      mailboxLimit: 20,
      taskLimit: 20,
      artifactLimit: 20,
      bodyBytes: 512,
      taskTitleBytes: 256,
      errorBytes: 256,
      summaryBytes: 256,
    }),
    trimPromptView(view, {
      mailboxLimit: 8,
      taskLimit: 12,
      artifactLimit: 12,
      bodyBytes: 256,
      taskTitleBytes: 160,
      errorBytes: 160,
      summaryBytes: 160,
    }),
    {
      ...trimPromptView(view, {
        mailboxLimit: 0,
        taskLimit: 0,
        artifactLimit: 0,
        bodyBytes: 0,
        taskTitleBytes: 0,
        errorBytes: 0,
        summaryBytes: 96,
      }),
      lastRejection: null,
    },
  ];

  return variants.map((candidate) => JSON.stringify(candidate, null, 2));
}

function joinSections(sections: readonly string[]): string {
  return sections.filter((section) => section.trim().length > 0).join('\n\n');
}

function toolSection(toolNames: ReadonlyArray<PlutoToolName>): string {
  const descriptorByName = new Map(PLUTO_TOOL_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]));
  return [
    'Available Pluto tools:',
    ...toolNames.map((name) => {
      const descriptor = descriptorByName.get(name);
      const description = descriptor?.description ?? 'Tool description unavailable.';
      return `- ${name}: ${description}`;
    }),
    '- pluto_wait_for_event: Suspend until a new actor-visible Pluto event arrives.',
  ].join('\n');
}

function toolCallSection(wrapperPath: string): string {
  return [
    '## How to call Pluto tools',
    '',
    `Invoke the Pluto tool by running \`${wrapperPath}\` from your bash shell.`,
    'The wrapper has the run context (URL/token/actor) baked in, so',
    'you do not need to pass tokens, headers, actor ids, or API URLs yourself.',
    '',
    'Examples:',
    '',
    `  ${wrapperPath} create-task --owner=generator --title="Draft haiku v1"`,
    `  ${wrapperPath} send-mailbox --to=lead --kind=completion --body="Draft attached: ..."`,
    `  ${wrapperPath} change-task-state --task-id=<id> --to=completed`,
    `  ${wrapperPath} publish-artifact --kind=final --media-type=text/plain --byte-size=64 --body="..."`,
    `  ${wrapperPath} complete-run --status=succeeded --summary="<one-sentence>"`,
    `  ${wrapperPath} wait --timeout-sec=300`,
    `  ${wrapperPath} read-state`,
    `  ${wrapperPath} read-artifact --artifact-id=<id>`,
    `  ${wrapperPath} read-transcript --actor-key=role:generator`,
    '',
    `Run \`${wrapperPath} --help\` or \`${wrapperPath} <subcommand> --help\` for`,
    'flag details. Output is JSON by default; pass --format=text for a',
    'short human summary.',
  ].join('\n');
}

function promptHeader(actor: ActorRef, role: string | null): string {
  if (isLeadActor(actor)) {
    return 'You are the lead actor for a Pluto v2 tool-driven run.';
  }

  return `You are the ${actorLabel(actor, role)} actor for a Pluto v2 tool-driven run.`;
}

function turnRuleSection(actor: ActorRef, wrapperPath: string): string {
  if (isLeadActor(actor)) {
    return [
      'Turn rule:',
      '- Read tools are available whenever you need more context.',
      '- End your turn with EXACTLY ONE mutating Pluto tool call.',
      `- After that mutating call, prefer ${wrapperPath} wait to suspend until the next relevant event.`,
      '- Usually that means delegating, publishing a state change, or calling pluto_complete_run when the run is truly finished.',
    ].join('\n');
  }

  return [
    'Turn rule:',
    '- Read tools are available whenever you need more context.',
    '- End your turn with EXACTLY ONE mutating Pluto tool call.',
    `- After that mutating call, prefer ${wrapperPath} wait to suspend until the next relevant event.`,
    '- Usually that means pluto_change_task_state to a terminal state, or pluto_append_mailbox_message with kind completion to the lead.',
  ].join('\n');
}

function actorRefForWakeup(actor: ActorRef | null): string | null {
  if (actor == null) {
    return null;
  }

  return actor.kind === 'role' ? `role:${actor.role}` : actor.kind;
}

function clampWakeupText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 16))}...[truncated]`;
}

function wakeupDeltaJson(delta: WakeupPromptDelta): string {
  return JSON.stringify({
    newTasks: delta.newTasks.map((task) => ([
      task.id,
      task.state,
      actorRefForWakeup(task.ownerActor),
      clampWakeupText(task.title, 44),
    ])),
    updatedTasks: delta.updatedTasks.map((task) => ([
      task.id,
      task.state,
      actorRefForWakeup(task.ownerActor),
      clampWakeupText(task.title, 44),
    ])),
    newMailbox: delta.newMailbox.map((message) => ([
      message.sequence,
      actorRefForWakeup(message.from),
      actorRefForWakeup(message.to),
      message.kind,
      clampWakeupText(message.body, 44),
    ])),
    newArtifacts: delta.newArtifacts.map((artifact) => ([
      artifact.id,
      artifact.kind,
      artifact.mediaType,
      artifact.byteSize,
    ])),
    delegation: actorRefForWakeup(delta.delegation),
    budgets: delta.budgets,
    lastRejection: delta.lastRejection == null
      ? null
      : [delta.lastRejection.directive.kind, clampWakeupText(delta.lastRejection.error, 80)],
  });
}

export function buildAgenticToolPrompt(input: AgenticToolPromptInput): string {
  const maxBytes = input.maxBytes ?? DEFAULT_AGENTIC_TOOL_PROMPT_MAX_BYTES;
  const roleLabel = input.role ?? (input.actor.kind === 'role' ? input.actor.role : null);
  const promptView = promptViewForActor(input.actor, input.promptView);
  const promptViewJsonCandidates = promptViewCandidates(promptView);
  const playbookBody = input.playbook == null
    ? 'No playbook loaded.'
    : isLeadActor(input.actor)
      ? input.playbook.body
      : extractRolePlaybookSlice(input.playbook.body, roleLabel);
  const userTaskSection = isLeadActor(input.actor) && input.userTask != null
    ? `User task:\n${input.userTask}`
    : '';
  const playbookHeader = isLeadActor(input.actor) ? 'Playbook:' : `Playbook for ${actorLabel(input.actor, roleLabel)}:`;
  const fixedSections = [
    promptHeader(input.actor, roleLabel),
    isLeadActor(input.actor) ? LEAD_FRAMING : '',
    userTaskSection,
    toolSection(input.toolNames),
    toolCallSection(input.wrapperPath),
    turnRuleSection(input.actor, input.wrapperPath),
  ];

  for (const promptViewJson of promptViewJsonCandidates) {
    const fixedPrompt = joinSections([
      ...fixedSections,
      `${playbookHeader}\n`,
      `PromptView JSON:\n${promptViewJson}`,
    ]);
    const playbookBudget = Math.max(0, maxBytes - utf8Bytes(fixedPrompt));
    const prompt = joinSections([
      ...fixedSections,
      `${playbookHeader}\n${truncateToBytes(playbookBody, playbookBudget)}`,
      `PromptView JSON:\n${promptViewJson}`,
    ]);

    if (utf8Bytes(prompt) <= maxBytes) {
      return prompt;
    }
  }

  return joinSections([
    ...fixedSections,
    `${playbookHeader}\n`,
    `PromptView JSON:\n${promptViewJsonCandidates.at(-1) ?? '{}'}`,
  ]);
}

export function buildWakeupPrompt(input: WakeupPromptInput): string {
  return [
    `[wakeup turn ${input.delta.budgets.turnIndex + 1}]`,
    `new event: ${input.latestEvent.kind} from ${actorLabel(input.latestEvent.actor, null)}`,
    '',
    'delta:',
    wakeupDeltaJson(input.delta),
    '',
    'end your turn with one mutating pluto-tool call.',
  ].join('\n');
}
