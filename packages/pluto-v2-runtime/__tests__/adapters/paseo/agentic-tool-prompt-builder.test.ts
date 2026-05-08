import { describe, expect, it } from 'vitest';

import type { ActorRef } from '@pluto/v2-core';

import { buildAgenticToolPrompt } from '../../../src/adapters/paseo/agentic-tool-prompt-builder.js';
import type { PromptView } from '../../../src/adapters/paseo/prompt-view.js';
import type { LoadedPlaybook } from '../../../src/loader/authored-spec-loader.js';
import { PLUTO_TOOL_NAMES } from '../../../src/tools/pluto-tool-schemas.js';

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };
const EXACT_MATCH_PHRASE = ['must', 'match', 'exactly'].join(' ');
const PAYLOAD_MATCH_PHRASE = ['payload', 'must', 'match', 'exactly'].join(' ');

const BASE_PROMPT_VIEW: PromptView = {
  run: {
    runId: '11111111-1111-4111-8111-111111111111',
    scenarioRef: 'scenario/agentic-tool-prompt',
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
    '# Agentic Tool Playbook',
    '',
    '## lead',
    'Stay on top of the whole run.',
    '',
    '## generator',
    'Write the draft artifact and report back to the lead.',
    '',
    '## evaluator',
    'Review the draft for defects and gaps.',
  ].join('\n'),
};

function buildPrompt(actor: ActorRef): string {
  return buildAgenticToolPrompt({
    actor,
    role: actor.kind === 'role' ? actor.role : null,
    promptView: {
      ...BASE_PROMPT_VIEW,
      forActor: actor,
    },
    playbook: PLAYBOOK,
    userTask: BASE_PROMPT_VIEW.userTask,
    toolNames: PLUTO_TOOL_NAMES,
  });
}

describe('buildAgenticToolPrompt', () => {
  it('includes the lead-only understanding framing line', () => {
    const prompt = buildPrompt(LEAD);

    expect(prompt).toContain('**Never delegate understanding.** You stay responsible for');
    expect(prompt).toContain('The PromptView is a snapshot');
    expect(prompt).toContain('User task:\nShip a safe first draft.');
  });

  it('omits the framing line and user task for sub-actors', () => {
    const prompt = buildPrompt(GENERATOR);

    expect(prompt).not.toContain('**Never delegate understanding.**');
    expect(prompt).not.toContain('User task:\nShip a safe first draft.');
    expect(prompt).toContain('## generator\nWrite the draft artifact and report back to the lead.');
    expect(prompt).not.toContain('## evaluator\nReview the draft for defects and gaps.');
    expect(prompt).toContain('"userTask": null');
  });

  it('does not contain fenced-json directive instructions or exact-match payload language', () => {
    const leadPrompt = buildPrompt(LEAD);
    const subactorPrompt = buildPrompt(GENERATOR);

    for (const prompt of [leadPrompt, subactorPrompt]) {
      expect(prompt).not.toContain(EXACT_MATCH_PHRASE);
      expect(prompt).not.toContain(PAYLOAD_MATCH_PHRASE);
      expect(prompt).not.toContain('```json');
      expect(prompt).not.toContain('Emit exactly ONE fenced JSON code block');
    }
  });

  it('shows literal pluto-tool usage without leaking curl, mcporter, token, or URL details', () => {
    const prompt = buildPrompt(LEAD);

    expect(prompt).toContain('Available Pluto tools:');
    expect(prompt).toContain('pluto_create_task');
    expect(prompt).toContain('pluto_complete_run');
    expect(prompt).toContain('pluto_read_transcript');
    expect(prompt).toContain('## How to call Pluto tools');
    expect(prompt).toContain('pluto-tool create-task --owner=generator --title="Draft haiku v1"');
    expect(prompt).toContain('pluto-tool send-mailbox --to=lead --kind=completion --body="Draft attached: ..."');
    expect(prompt).toContain('pluto-tool wait --timeout-sec=300');
    expect(prompt).toContain('pluto-tool read-transcript --actor-key=role:generator');
    expect(prompt).toContain('End your turn with EXACTLY ONE mutating Pluto tool call.');
    expect(prompt).toContain('After that mutating call, prefer pluto-tool wait');
    expect(prompt).not.toContain('curl');
    expect(prompt).not.toContain('mcporter');
    expect(prompt).not.toContain('Bearer auth is preconfigured');
    expect(prompt).not.toContain('token-123');
    expect(prompt).not.toContain('http://127.0.0.1');
  });
});
