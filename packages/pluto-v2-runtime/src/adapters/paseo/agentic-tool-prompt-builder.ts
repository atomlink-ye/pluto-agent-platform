import type { ActorRef } from '@pluto/v2-core';

import type { LoadedPlaybook } from '../../loader/authored-spec-loader.js';
import { PLUTO_TOOL_DESCRIPTORS, type PlutoToolName } from '../../tools/pluto-tool-schemas.js';
import type { PromptView } from './prompt-view.js';

export interface AgenticToolPromptInput {
  readonly actor: ActorRef;
  readonly role: string | null;
  readonly promptView: PromptView;
  readonly playbook: LoadedPlaybook | null;
  readonly userTask: string | null;
  readonly mcpEndpoint: string;
  readonly bearerToken: string;
  readonly toolNames: ReadonlyArray<PlutoToolName>;
  readonly maxBytes?: number;
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
  ].join('\n');
}

function promptHeader(actor: ActorRef, role: string | null): string {
  if (isLeadActor(actor)) {
    return 'You are the lead actor for a Pluto v2 tool-driven run.';
  }

  return `You are the ${actorLabel(actor, role)} actor for a Pluto v2 tool-driven run.`;
}

function turnRuleSection(actor: ActorRef): string {
  if (isLeadActor(actor)) {
    return [
      'Turn rule:',
      '- Read tools are available whenever you need more context.',
      '- End your turn with EXACTLY ONE mutating Pluto tool call.',
      '- Usually that means delegating, publishing a state change, or calling pluto_complete_run when the run is truly finished.',
    ].join('\n');
  }

  return [
    'Turn rule:',
    '- Read tools are available whenever you need more context.',
    '- End your turn with EXACTLY ONE mutating Pluto tool call.',
    '- Usually that means pluto_change_task_state to a terminal state, or pluto_append_mailbox_message with kind completion to the lead.',
  ].join('\n');
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
  const connectionSection = [
    `Pluto MCP endpoint: ${input.mcpEndpoint}`,
    input.bearerToken.trim().length > 0
      ? 'Bearer auth is preconfigured for this session.'
      : 'Bearer auth is unavailable for this session.',
  ].join('\n');
  const fixedSections = [
    promptHeader(input.actor, roleLabel),
    isLeadActor(input.actor) ? LEAD_FRAMING : '',
    userTaskSection,
    toolSection(input.toolNames),
    connectionSection,
    turnRuleSection(input.actor),
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
