import {
  AUTHORITY_MATRIX,
  MAILBOX_MESSAGE_KIND_VALUES,
  RUN_COMPLETED_STATUS_VALUES,
  TASK_STATE_VALUES,
  type ActorRef,
  type ProtocolRequestIntent,
} from '@pluto/v2-core';

import type { LoadedPlaybook } from '../../loader/authored-spec-loader.js';
import type { PromptView } from './prompt-view.js';

export interface AgenticPromptInput {
  readonly actor: ActorRef;
  readonly promptView: PromptView;
  readonly playbook: LoadedPlaybook | null;
  readonly maxBytes?: number;
}

export const DEFAULT_AGENTIC_PROMPT_MAX_BYTES = 32 * 1024;

const FINAL_INSTRUCTION = [
  'Decide ONE directive that advances the run and is authorized for your actor.',
  'Emit exactly ONE fenced JSON code block and no surrounding prose.',
  'The block must contain a single directive object with top-level `kind` and `payload` fields.',
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

function actorLabel(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return actor.role;
  }
}

function isLeadActor(actor: ActorRef): boolean {
  return actor.kind === 'role' && actor.role === 'lead';
}

function leadLine(actor: ActorRef): string {
  if (isLeadActor(actor)) {
    return 'You are the lead actor for an agentic Pluto v2 run.';
  }

  switch (actor.kind) {
    case 'manager':
      return 'You are the manager actor. Enforce orchestration boundaries and complete the run only when the state supports it.';
    case 'system':
      return 'You are the system actor. Respond only with a valid directive when the state requires a system action.';
    case 'role':
      return `You are the ${actor.role} actor on a Pluto v2 agentic run.`;
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

function extractRolePlaybookSlice(playbookBody: string, actor: ActorRef): string {
  if (actor.kind !== 'role' || actor.role === 'lead') {
    return playbookBody;
  }

  const lines = playbookBody.split('\n');
  const headingPattern = new RegExp(`^##\\s+${actor.role}\\s*$`, 'i');
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

function matcherAllowance(actor: ActorRef, matcher: (typeof AUTHORITY_MATRIX)[ProtocolRequestIntent][number]): string | null {
  switch (matcher.kind) {
    case 'manager':
      return actor.kind === 'manager' ? 'allowed' : null;
    case 'system':
      return actor.kind === 'system' ? 'allowed' : null;
    case 'role':
      return actor.kind === 'role' && actor.role === matcher.role ? 'allowed' : null;
    case 'role-owns-task':
      return actor.kind === 'role' && actor.role === matcher.role
        ? 'conditional: only for tasks you own'
        : null;
    case 'role-bounded-transitions':
      return actor.kind === 'role' && actor.role === matcher.role
        ? `conditional: only to ${matcher.transitions.join(', ')}`
        : null;
  }
}

function intentAllowance(actor: ActorRef, intent: ProtocolRequestIntent): string {
  for (const matcher of AUTHORITY_MATRIX[intent]) {
    const allowance = matcherAllowance(actor, matcher);
    if (allowance != null) {
      return allowance;
    }
  }

  return 'not allowed for this actor';
}

function buildAuthorityGuidance(actor: ActorRef): string {
  return [
    'Authority and directive shapes:',
    `- append_mailbox_message (${intentAllowance(actor, 'append_mailbox_message')}): payload fields are fromActor, toActor, kind, and body. Mailbox kind must be one of ${MAILBOX_MESSAGE_KIND_VALUES.join(', ')}.`,
    `- create_task (${intentAllowance(actor, 'create_task')}): payload fields are title, ownerActor, and dependsOn.`,
    `- change_task_state (${intentAllowance(actor, 'change_task_state')}): payload fields are taskId and to. Task state must be one of ${TASK_STATE_VALUES.join(', ')}.`,
    `- publish_artifact (${intentAllowance(actor, 'publish_artifact')}): payload fields are kind, mediaType, and byteSize.`,
    `- complete_run (${intentAllowance(actor, 'complete_run')}): payload fields are status and summary. Status must be one of ${RUN_COMPLETED_STATUS_VALUES.join(', ')}.`,
  ].join('\n');
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
    trimPromptView(view, {
      mailboxLimit: 3,
      taskLimit: 6,
      artifactLimit: 6,
      bodyBytes: 128,
      taskTitleBytes: 96,
      errorBytes: 96,
      summaryBytes: 96,
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

  const minimalCompactView: PromptView = {
    ...trimPromptView(view, {
      mailboxLimit: 0,
      taskLimit: 0,
      artifactLimit: 0,
      bodyBytes: 0,
      taskTitleBytes: 0,
      errorBytes: 0,
      summaryBytes: 64,
    }),
    userTask: null,
    playbook: view.playbook,
    tasks: [],
    mailbox: [],
    artifacts: [],
    lastRejection: null,
  };

  return [...variants.map((candidate) => JSON.stringify(candidate, null, 2)), JSON.stringify(minimalCompactView)];
}

function selectPromptViewJson(view: PromptView, maxBytes: number): string {
  const candidates = promptViewCandidates(view);
  for (const candidate of candidates) {
    if (utf8Bytes(candidate) <= maxBytes) {
      return candidate;
    }
  }

  return candidates.at(-1) ?? '{}';
}

function joinPromptSections(sections: readonly string[]): string {
  return sections.filter((section) => section.trim().length > 0).join('\n\n');
}

export function buildAgenticPrompt(input: AgenticPromptInput): string {
  const maxBytes = input.maxBytes ?? DEFAULT_AGENTIC_PROMPT_MAX_BYTES;
  const promptView = promptViewForActor(input.actor, input.promptView);
  const authorityGuidance = buildAuthorityGuidance(input.actor);
  const leadSection = leadLine(input.actor);
  const userTaskSection = isLeadActor(input.actor) ? `User task:\n${input.promptView.userTask ?? ''}` : '';
  const promptViewHeader = 'PromptView JSON:';
  const playbookHeader = isLeadActor(input.actor)
    ? 'Playbook:'
    : `Playbook for ${actorLabel(input.actor)}:`;
  const playbookBody = input.playbook == null
    ? 'No playbook loaded.'
    : isLeadActor(input.actor)
      ? input.playbook.body
      : extractRolePlaybookSlice(input.playbook.body, input.actor);

  const promptViewJsonCandidates = promptViewCandidates(promptView);
  for (const promptViewJson of promptViewJsonCandidates) {
    const fixedPrompt = joinPromptSections([
      leadSection,
      userTaskSection,
      `${playbookHeader}\n`,
      `${promptViewHeader}\n${promptViewJson}`,
      authorityGuidance,
      FINAL_INSTRUCTION,
    ]);
    const playbookBudget = Math.max(0, maxBytes - utf8Bytes(fixedPrompt));
    const fittedPlaybookBody = truncateToBytes(playbookBody, playbookBudget);
    const prompt = joinPromptSections([
      leadSection,
      userTaskSection,
      `${playbookHeader}\n${fittedPlaybookBody}`,
      `${promptViewHeader}\n${promptViewJson}`,
      authorityGuidance,
      FINAL_INSTRUCTION,
    ]);

    if (utf8Bytes(prompt) <= maxBytes) {
      return prompt;
    }
  }

  const fallbackPromptViewJson = selectPromptViewJson(promptView, 0);

  return joinPromptSections([
    leadSection,
    userTaskSection,
    `${playbookHeader}\n`,
    `${promptViewHeader}\n${fallbackPromptViewJson}`,
    authorityGuidance,
    FINAL_INSTRUCTION,
  ]);
}
