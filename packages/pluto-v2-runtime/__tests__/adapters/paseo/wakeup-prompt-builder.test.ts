import { describe, expect, it } from 'vitest';

import type { ActorRef } from '@pluto/v2-core';

import { buildAgenticToolPrompt, buildWakeupPrompt, type WakeupPromptDelta } from '../../../src/adapters/paseo/agentic-tool-prompt-builder.js';
import type { PromptView } from '../../../src/adapters/paseo/prompt-view.js';
import type { LoadedPlaybook } from '../../../src/loader/authored-spec-loader.js';
import { PLUTO_TOOL_NAMES } from '../../../src/tools/pluto-tool-schemas.js';

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

const BASE_PROMPT_VIEW: PromptView = {
  run: {
    runId: '11111111-1111-4111-8111-111111111111',
    scenarioRef: 'scenario/wakeup-prompt',
    runProfileRef: 'paseo-agentic-tool',
  },
  userTask: 'Ship a safe first draft.',
  forActor: LEAD,
  playbook: {
    ref: 'playbooks/agentic.md',
    sha256: 'abc123',
  },
  budgets: {
    turnIndex: 2,
    maxTurns: 20,
    parseFailuresThisTurn: 0,
    maxParseFailuresPerTurn: 0,
    kernelRejections: 0,
    maxKernelRejections: 3,
    noProgressTurns: 0,
    maxNoProgressTurns: 3,
  },
  tasks: [
    {
      id: 'task-1',
      title: 'Draft the first artifact with a concise but complete initial proposal',
      ownerActor: GENERATOR,
      state: 'running',
    },
  ],
  mailbox: [
    {
      sequence: 1,
      from: LEAD,
      to: GENERATOR,
      kind: 'task',
      body: 'Produce the initial draft and call out any obvious technical risk.',
    },
  ],
  artifacts: [
    {
      id: 'artifact-1',
      kind: 'intermediate',
      mediaType: 'text/markdown',
      byteSize: 128,
    },
  ],
  activeDelegation: GENERATOR,
  lastRejection: null,
};

const PLAYBOOK: LoadedPlaybook = {
  ref: 'playbooks/agentic.md',
  sha256: 'abc123',
  body: [
    '# Agentic Tool Playbook',
    '',
    '## lead',
    'Stay on top of the whole run.',
    'Keep the task decomposition clear and the overall outcome aligned to the user request.',
    'Verify important claims before concluding the run.',
    '',
    '## generator',
    'Write the draft artifact and report back to the lead.',
    'Prefer direct progress over long status narration.',
    'Surface blockers quickly with concrete evidence.',
    '',
    '## evaluator',
    'Review the draft for defects and gaps.',
    'Focus on risks, regressions, and missing verification.',
    '',
    '## planner',
    'Break the work into compact, verifiable steps.',
    'Keep plans aligned to the current run state and latest events.',
    '',
    'Reference expectations:',
    '- Keep transcripts concise.',
    '- Read state before acting when context is stale.',
    '- Prefer the existing delegation path over inventing new actors.',
    '- Avoid redoing finished work.',
    '- Report concrete artifacts and mailbox updates as they happen.',
    '- Close the loop with a mutating Pluto tool call.',
  ].join('\n'),
};

function bootstrapPrompt(): string {
  return buildAgenticToolPrompt({
    actor: LEAD,
    role: 'lead',
    promptView: BASE_PROMPT_VIEW,
    playbook: PLAYBOOK,
    userTask: BASE_PROMPT_VIEW.userTask,
    toolNames: PLUTO_TOOL_NAMES,
  });
}

function wakeupDelta(mailboxCount = 1): WakeupPromptDelta {
  return {
    newTasks: [],
    updatedTasks: [
      {
        id: 'task-1',
        title: 'Draft the first artifact with a concise but complete initial proposal',
        ownerActor: GENERATOR,
        state: 'running',
      },
    ],
    newMailbox: Array.from({ length: mailboxCount }, (_, index) => ({
      sequence: index + 2,
      from: GENERATOR,
      to: LEAD,
      kind: 'completion',
      body: `Mailbox update ${index + 1}: draft progress is moving and the latest artifact is attached.`,
    })),
    newArtifacts: [
      {
        id: 'artifact-1',
        kind: 'intermediate',
        mediaType: 'text/markdown',
        byteSize: 128,
      },
    ],
    delegation: GENERATOR,
    budgets: BASE_PROMPT_VIEW.budgets,
    lastRejection: null,
  };
}

function wakeupPrompt(mailboxCount = 1): string {
  return buildWakeupPrompt({
    actor: LEAD,
    latestEvent: {
      kind: 'mailbox_message_appended',
      eventId: '00000000-0000-4000-8000-000000000099',
      runId: BASE_PROMPT_VIEW.run.runId,
      sequence: 99,
      timestamp: '2026-05-08T00:01:39.000Z',
      schemaVersion: '1.0',
      actor: GENERATOR,
      requestId: '10000000-0000-4000-8000-000000000099',
      causationId: null,
      correlationId: null,
      entityRef: { kind: 'mailbox_message', messageId: 'message-99' },
      outcome: 'accepted',
      payload: {
        messageId: 'message-99',
        fromActor: GENERATOR,
        toActor: LEAD,
        kind: 'completion',
        body: 'Draft attached.',
      },
    },
    delta: wakeupDelta(mailboxCount),
  });
}

describe('wakeup prompt builder', () => {
  it('keeps the bootstrap prompt above the prior scaffold baseline', () => {
    expect(bootstrapPrompt().length).toBeGreaterThan(1500);
  });

  it('keeps a typical wakeup prompt compact and scaffold-free', () => {
    const prompt = wakeupPrompt();

    expect(prompt.length).toBeLessThan(1000);
    expect(prompt).toContain('[wakeup turn');
    expect(prompt).toContain('new event: mailbox_message_appended from generator');
    expect(prompt).toContain('"updatedTasks"');
    expect(prompt).toContain('"newMailbox"');
    expect(prompt).toContain('end your turn with one mutating pluto-tool call.');
    expect(prompt).not.toContain('Playbook:');
    expect(prompt).not.toContain('Available Pluto tools');
    expect(prompt).not.toContain('## How to call Pluto tools');
    expect(prompt).not.toContain('Never delegate understanding');
    expect(prompt).not.toContain('pluto-tool create-task');
  });

  it('stays below the worst-case wakeup size bound with ten mailbox updates', () => {
    expect(wakeupPrompt(10).length).toBeLessThan(1500);
  });
});
