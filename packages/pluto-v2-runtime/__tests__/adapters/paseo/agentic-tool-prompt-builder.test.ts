import { describe, expect, it } from 'vitest';

import type { ActorRef } from '@pluto/v2-core';

import { buildAgenticToolPrompt, buildWakeupPrompt } from '../../../src/adapters/paseo/agentic-tool-prompt-builder.js';
import type { PromptView } from '../../../src/adapters/paseo/prompt-view.js';
import type { LoadedPlaybook } from '../../../src/loader/authored-spec-loader.js';
import { PLUTO_TOOL_NAMES } from '../../../src/tools/pluto-tool-schemas.js';

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };
const EVALUATOR: ActorRef = { kind: 'role', role: 'evaluator' };
const MANAGER: ActorRef = { kind: 'manager' };
const SYSTEM: ActorRef = { kind: 'system' };
const EXACT_MATCH_PHRASE = ['must', 'match', 'exactly'].join(' ');
const PAYLOAD_MATCH_PHRASE = ['payload', 'must', 'match', 'exactly'].join(' ');
const CRAFT_FIDELITY_HEADING = '## Craft fidelity (lead-only)';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const RUN_BIN_PATH = '/tmp/pluto-run/bin/pluto-tool';
const WRAPPER_PATH = '/tmp/pluto-run/agents/role:lead/pluto-tool';

const BASE_PROMPT_VIEW: PromptView = {
  run: {
    runId: RUN_ID,
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
    runId: RUN_ID,
    promptView: {
      ...BASE_PROMPT_VIEW,
      forActor: actor,
    },
    playbook: PLAYBOOK,
    userTask: BASE_PROMPT_VIEW.userTask,
    toolNames: PLUTO_TOOL_NAMES,
    runBinPath: RUN_BIN_PATH,
    wrapperPath: WRAPPER_PATH,
  });
}

function buildWakeup(actor: ActorRef): string {
  return buildWakeupPrompt({
    actor,
    latestEvent: {
      kind: 'mailbox_message_appended',
      eventId: '00000000-0000-4000-8000-000000000099',
      runId: RUN_ID,
      sequence: 99,
      timestamp: '2026-05-09T00:01:39.000Z',
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
    delta: {
      newTasks: [],
      updatedTasks: [],
      newMailbox: [
        {
          sequence: 2,
          from: GENERATOR,
          to: LEAD,
          kind: 'completion',
          body: 'Draft attached.',
        },
      ],
      newArtifacts: [],
      delegation: GENERATOR,
      budgets: BASE_PROMPT_VIEW.budgets,
      lastRejection: null,
    },
  });
}

describe('buildAgenticToolPrompt', () => {
  it('includes the lead-only understanding framing and craft-fidelity lines', () => {
    const prompt = buildPrompt(LEAD);
    const normalized = prompt.toLowerCase();

    expect(prompt).toContain('**Never delegate understanding.** You stay responsible for');
    expect(prompt).toContain('The PromptView is a snapshot');
    expect(prompt).toContain('User task:\nShip a safe first draft.');
    expect(prompt).toContain(CRAFT_FIDELITY_HEADING);
    expect(normalized).toContain('orchestrate craft');
    expect(prompt).toContain('VERBATIM');
    expect(normalized).toContain('do not rewrite');
  });

  it('anchors every bootstrap prompt to the live actor and run id', () => {
    const prompts = [
      { actor: LEAD, label: 'lead' },
      { actor: GENERATOR, label: 'generator' },
      { actor: MANAGER, label: 'manager' },
      { actor: SYSTEM, label: 'system' },
    ] as const;

    for (const { actor, label } of prompts) {
      const prompt = buildPrompt(actor);
      const normalized = prompt.toLowerCase();

      expect(normalized).toContain(`you are the live ${label} actor for run`);
      expect(prompt).toContain(RUN_ID);
      expect(prompt).toContain('Do NOT use external control planes');
      expect(prompt).toContain('There is no other actor; you are the actor.');
    }
  });

  it('omits the framing line and user task for sub-actors', () => {
    const prompt = buildPrompt(GENERATOR);

    expect(prompt).not.toContain('**Never delegate understanding.**');
    expect(prompt).not.toContain('User task:\nShip a safe first draft.');
    expect(prompt).not.toContain(CRAFT_FIDELITY_HEADING);
    expect(prompt).not.toContain('VERBATIM');
    expect(prompt).toContain('## generator\nWrite the draft artifact and report back to the lead.');
    expect(prompt).not.toContain('## evaluator\nReview the draft for defects and gaps.');
    expect(prompt).toContain('"userTask": null');
  });

  it('keeps craft-fidelity language out of evaluator and manager bootstrap prompts', () => {
    const prompts = [buildPrompt(EVALUATOR), buildPrompt(MANAGER)];

    for (const prompt of prompts) {
      const normalized = prompt.toLowerCase();

      expect(prompt).not.toContain(CRAFT_FIDELITY_HEADING);
      expect(prompt).not.toContain('VERBATIM');
      expect(normalized).not.toContain('orchestrate craft');
      expect(normalized).not.toContain('do not rewrite');
    }
  });

  it('keeps craft-fidelity language out of wakeup prompts for every actor', () => {
    const prompts = [buildWakeup(LEAD), buildWakeup(GENERATOR), buildWakeup(MANAGER)];

    for (const prompt of prompts) {
      const normalized = prompt.toLowerCase();

      expect(prompt).not.toContain(CRAFT_FIDELITY_HEADING);
      expect(prompt).not.toContain('VERBATIM');
      expect(normalized).not.toContain('orchestrate craft');
      expect(normalized).not.toContain('do not rewrite');
    }
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

  it('shows wrapper-path tool usage without leaking curl, mcporter, token, or URL details', () => {
    const prompt = buildPrompt(LEAD);

    expect(prompt).toContain('Available Pluto tools:');
    expect(prompt).toContain('pluto_create_task');
    expect(prompt).toContain('pluto_complete_run');
    expect(prompt).toContain('pluto_read_transcript');
    expect(prompt).toContain('## How to call Pluto tools');
    expect(prompt).toContain(`Invoke the Pluto tool by running \`${RUN_BIN_PATH}\` from your bash shell.`);
    expect(prompt).toContain('Always pass `--actor role:lead` explicitly.');
    expect(prompt).toContain(`The per-actor wrapper \`${WRAPPER_PATH}\` is a backward-compat shortcut that forwards to the same run-level binary.`);
    expect(prompt).toContain(`${RUN_BIN_PATH} --actor role:lead create-task --owner=generator --title="Draft haiku v1"`);
    expect(prompt).toContain(`${RUN_BIN_PATH} --actor role:lead send-mailbox --to=lead --kind=completion --body="Draft attached: ..."`);
    expect(prompt).toContain(`${RUN_BIN_PATH} --actor role:lead wait --timeout-sec=300`);
    expect(prompt).toContain(`${RUN_BIN_PATH} --actor role:lead read-transcript --actor-key=role:generator`);
    expect(prompt).toContain('End your turn with EXACTLY ONE mutating Pluto tool call.');
    expect(prompt).toContain(`After that mutating call, prefer ${WRAPPER_PATH} wait`);
    expect(prompt).not.toContain('available in your shell');
    expect(prompt).not.toContain('curl');
    expect(prompt).not.toContain('mcporter');
    expect(prompt).not.toContain('Bearer auth is preconfigured');
    expect(prompt).not.toContain('token-123');
    expect(prompt).not.toContain('http://127.0.0.1');
  });

  it('anchors each bootstrap prompt to the shared run binary with the actor-specific --actor value', () => {
    const leadPrompt = buildPrompt(LEAD);
    const generatorPrompt = buildPrompt(GENERATOR);

    expect(leadPrompt).toContain(RUN_BIN_PATH);
    expect(leadPrompt).toContain('--actor role:lead');
    expect(generatorPrompt).toContain(RUN_BIN_PATH);
    expect(generatorPrompt).toContain('--actor role:generator');
  });

  it('mentions the canonical composite verbs for lead, generator, and evaluator bootstraps', () => {
    const leadPrompt = buildPrompt(LEAD);
    const generatorPrompt = buildPrompt(GENERATOR);
    const evaluatorPrompt = buildPrompt(EVALUATOR);

    expect(leadPrompt).toContain('final-reconciliation');
    expect(leadPrompt).toContain('complete-run');
    expect(generatorPrompt).toContain('worker-complete');
    expect(generatorPrompt).toContain('append-mailbox-message kind=completion');
    expect(evaluatorPrompt).toContain('evaluator-verdict');
    expect(evaluatorPrompt).toContain('structured verdict mailbox message');
    expect(leadPrompt).toContain('Evaluator verdict mailbox messages may arrive with kind `final` for `pass`, or kind `task` for `needs-revision` and `fail`.');
    expect(leadPrompt).toContain('Always inspect `body.verdict` to determine the outcome. Do not infer evaluator verdict outcome from mailbox `kind` alone.');
  });

  it('requires verbatim generator wording in the lead final-reconciliation section', () => {
    const leadPrompt = buildPrompt(LEAD);
    const sectionStart = leadPrompt.indexOf('## Canonical composite verb');
    const reconciliationSection = leadPrompt.slice(sectionStart);

    expect(reconciliationSection).toContain('final-reconciliation');
    expect(reconciliationSection).toContain('VERBATIM');
    expect(reconciliationSection).toContain('exactly as written');
    expect(reconciliationSection).toContain('Do not rewrite, paraphrase');
  });
});
