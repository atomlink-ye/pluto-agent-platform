import { describe, expect, it } from 'vitest';

import type { ActorRef } from '@pluto/v2-core';

import type { LoadedPlaybook } from '../../../src/loader/authored-spec-loader.js';
import { DEFAULT_AGENTIC_PROMPT_MAX_BYTES, buildAgenticPrompt } from '../../../src/adapters/paseo/agentic-prompt-builder.js';
import type { PromptView } from '../../../src/adapters/paseo/prompt-view.js';

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };
const exactPhrase = ['must', 'match', 'exactly'].join(' ');
const payloadExactPhrase = ['payload', 'must', 'match', 'exactly'].join(' ');

const BASE_PROMPT_VIEW: PromptView = {
  run: {
    runId: '11111111-1111-4111-8111-111111111111',
    scenarioRef: 'scenario/agentic-prompt',
    runProfileRef: 'paseo-agentic',
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
    maxParseFailuresPerTurn: 2,
    kernelRejections: 0,
    maxKernelRejections: 3,
    noProgressTurns: 0,
    maxNoProgressTurns: 3,
  },
  tasks: [
    {
      id: 'task-1',
      title: 'Draft the first artifact',
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
      body: 'Produce the initial draft.',
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
    '# Agentic Playbook',
    '',
    '## planner',
    'Plan the run before work starts.',
    '',
    '## generator',
    'Write the draft artifact and keep the lead updated.',
    '',
    '## evaluator',
    'Review the draft for defects and gaps.',
  ].join('\n'),
};

function buildPrompt(actor: ActorRef, overrides?: Partial<PromptView>, playbook: LoadedPlaybook | null = PLAYBOOK): string {
  return buildAgenticPrompt({
    actor,
    promptView: {
      ...BASE_PROMPT_VIEW,
      forActor: actor,
      ...overrides,
    },
    playbook,
  });
}

describe('buildAgenticPrompt', () => {
  it('includes the lead user task, full playbook body, and PromptView JSON', () => {
    const prompt = buildPrompt(LEAD);

    expect(prompt).toContain('You are the lead actor.');
    expect(prompt).toContain('User task:\nShip a safe first draft.');
    expect(prompt).toContain('## planner');
    expect(prompt).toContain('## generator');
    expect(prompt).toContain('"userTask": "Ship a safe first draft."');
    expect(prompt).toContain('"scenarioRef": "scenario/agentic-prompt"');
  });

  it('uses the role slice for a sub-actor when a matching heading exists', () => {
    const prompt = buildPrompt(GENERATOR);

    expect(prompt).toContain('You are the generator actor.');
    expect(prompt).not.toContain('User task:\nShip a safe first draft.');
    expect(prompt).toContain('## generator\nWrite the draft artifact and keep the lead updated.');
    expect(prompt).not.toContain('## planner\nPlan the run before work starts.');
    expect(prompt).not.toContain('## evaluator\nReview the draft for defects and gaps.');
  });

  it('does not include prefilled directive payloads or answer templates', () => {
    const prompt = buildPrompt(LEAD);

    expect(prompt).not.toContain(exactPhrase);
    expect(prompt).not.toContain(payloadExactPhrase);
    expect(prompt).not.toContain('{"kind":"append_mailbox_message","payload":{}}');
    expect(prompt).not.toContain('The JSON must be a single directive object:');
    expect(prompt).toContain('The block must contain a single directive object with top-level `kind` and `payload` fields.');
    expect(prompt).toContain('payload fields are fromActor, toActor, kind, and body.');
  });

  it('caps prompt length without reintroducing directive json examples', () => {
    const prompt = buildAgenticPrompt({
      actor: LEAD,
      promptView: {
        ...BASE_PROMPT_VIEW,
        mailbox: Array.from({ length: 30 }, (_, index) => ({
          sequence: index + 1,
          from: LEAD,
          to: GENERATOR,
          kind: 'task',
          body: 'x'.repeat(2048),
        })),
      },
      playbook: {
        ...PLAYBOOK,
        body: `${PLAYBOOK.body}\n\n${'y'.repeat(80 * 1024)}`,
      },
      maxBytes: DEFAULT_AGENTIC_PROMPT_MAX_BYTES,
    });

    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(DEFAULT_AGENTIC_PROMPT_MAX_BYTES);
    expect(prompt).toContain('Emit exactly one fenced JSON block and no surrounding prose.');
    expect(prompt).not.toContain('{"kind":"append_mailbox_message","payload":{}}');
    expect(prompt).toContain('The block must contain a single directive object with top-level `kind` and `payload` fields.');
  });
});
