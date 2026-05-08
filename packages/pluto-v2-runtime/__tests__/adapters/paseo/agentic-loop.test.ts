import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { counterIdProvider, fixedClockProvider, type ActorRef } from '@pluto/v2-core';

import { makePaseoAdapter } from '../../../src/adapters/paseo/paseo-adapter.js';
import { runPaseo, type PaseoCliClient, type PaseoUsageEstimate } from '../../../src/adapters/paseo/run-paseo.js';
import { loadAuthoredSpec, type LoadedAuthoredSpec } from '../../../src/loader/authored-spec-loader.js';

const FIXED_TIME = '2026-05-08T00:00:00.000Z';
const SCENARIO_PATH = fileURLToPath(
  new URL('../../../test-fixtures/scenarios/hello-team-agentic-mock/scenario.yaml', import.meta.url),
);

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };
const EVALUATOR: ActorRef = { kind: 'role', role: 'evaluator' };
const exactPhrase = ['must', 'match', 'exactly'].join(' ');

type ScriptEntry = {
  actor: ActorRef;
  transcriptText: string | ((prompt: string) => string);
  usage?: Required<PaseoUsageEstimate>;
  waitExitCode?: number;
};

type PromptRecord = {
  actorKey: string;
  prompt: string;
};

function actorKey(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `role:${actor.role}`;
  }
}

function buildSpec(overrides?: Partial<LoadedAuthoredSpec>): LoadedAuthoredSpec {
  const loaded = loadAuthoredSpec(SCENARIO_PATH);
  const spec = {
    ...loaded,
    ...overrides,
    orchestration: {
      ...loaded.orchestration,
      ...overrides?.orchestration,
    },
  };

  Object.defineProperty(spec, 'playbook', {
    value: overrides?.playbook ?? loaded.playbook,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return spec as LoadedAuthoredSpec;
}

function taskIdFromPrompt(prompt: string): string {
  const match = prompt.match(/"id":\s*"([^"]+)"/);
  if (match?.[1] == null) {
    throw new Error('task id not found in prompt view');
  }

  return match[1];
}

function makeMockClient(script: readonly ScriptEntry[], prompts: PromptRecord[]): PaseoCliClient {
  const grouped = new Map<string, ScriptEntry[]>();
  const cursors = new Map<string, number>();
  const cumulative = new Map<string, string>();
  const lastPromptByActor = new Map<string, string>();

  for (const entry of script) {
    const key = actorKey(entry.actor);
    const entries = grouped.get(key) ?? [];
    entries.push(entry);
    grouped.set(key, entries);
  }

  return {
    spawnAgent: vi.fn(async (spec) => {
      prompts.push({ actorKey: spec.title, prompt: spec.initialPrompt });
      lastPromptByActor.set(spec.title, spec.initialPrompt);
      cursors.set(spec.title, (cursors.get(spec.title) ?? -1) + 1);
      return { agentId: `mock-${spec.title}` };
    }),
    sendPrompt: vi.fn(async (agentId: string, prompt: string) => {
      const key = agentId.slice('mock-'.length);
      prompts.push({ actorKey: key, prompt });
      lastPromptByActor.set(key, prompt);
      cursors.set(key, (cursors.get(key) ?? -1) + 1);
    }),
    waitIdle: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      const entry = grouped.get(key)?.[cursors.get(key) ?? -1];
      if (entry == null) {
        throw new Error(`Missing wait script entry for ${agentId}`);
      }

      return { exitCode: entry.waitExitCode ?? 0 };
    }),
    readTranscript: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      const entry = grouped.get(key)?.[cursors.get(key) ?? -1];
      if (entry == null) {
        throw new Error(`Missing transcript script entry for ${agentId}`);
      }

      const transcriptText = typeof entry.transcriptText === 'function'
        ? entry.transcriptText(lastPromptByActor.get(key) ?? '')
        : entry.transcriptText;
      const next = (cumulative.get(key) ?? '') + transcriptText;
      cumulative.set(key, next);
      return next;
    }),
    usageEstimate: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      const entry = grouped.get(key)?.[cursors.get(key) ?? -1];
      if (entry == null) {
        throw new Error(`Missing usage script entry for ${agentId}`);
      }

      return entry.usage ?? { inputTokens: 1, outputTokens: 1, costUsd: 0.001 };
    }),
    deleteAgent: vi.fn(async () => {}),
  };
}

async function runAgentic(options: {
  script: readonly ScriptEntry[];
  spec?: Partial<LoadedAuthoredSpec>;
  adapterOptions?: {
    maxTurns?: number;
    maxParseFailuresPerTurn?: number;
    maxKernelRejections?: number;
    maxNoProgressTurns?: number;
  };
}) {
  const prompts: PromptRecord[] = [];
  const spec = buildSpec(options.spec);
  const client = makeMockClient(options.script, prompts);
  const result = await runPaseo(
    spec,
    makePaseoAdapter({
      idProvider: counterIdProvider(100),
      clockProvider: fixedClockProvider(FIXED_TIME),
      spec,
      ...options.adapterOptions,
    }),
    {
      client,
      idProvider: counterIdProvider(1),
      clockProvider: fixedClockProvider(FIXED_TIME),
      paseoAgentSpec: (actor) => ({
        provider: 'opencode',
        model: 'openai/gpt-5.4',
        mode: 'build',
        title: actorKey(actor),
        initialPrompt: `bootstrap for ${actorKey(actor)}`,
      }),
    },
  );

  return { client, prompts, result };
}

describe('agentic Paseo loop', () => {
  it('delegates from lead by task creation', async () => {
    const { prompts, result } = await runAgentic({
      script: [
        {
          actor: LEAD,
          transcriptText: [
            '```json',
            JSON.stringify({
              kind: 'create_task',
              payload: {
                title: 'Draft the change',
                ownerActor: GENERATOR,
                dependsOn: [],
              },
            }),
            '```',
          ].join('\n'),
        },
        {
          actor: GENERATOR,
          transcriptText: [
            '```json',
            JSON.stringify({
              kind: 'append_mailbox_message',
              payload: {
                fromActor: GENERATOR,
                toActor: LEAD,
                kind: 'completion',
                body: 'Draft is ready.',
              },
            }),
            '```',
          ].join('\n'),
        },
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"complete_run","payload":{"status":"succeeded","summary":"done"}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
    expect(prompts[1]?.prompt).toContain('"activeDelegation"');
    expect(result.events.map((event) => event.kind)).toEqual([
      'run_started',
      'task_created',
      'mailbox_message_appended',
      'run_completed',
    ]);
  });

  it('delegates from lead by mailbox message', async () => {
    const { prompts } = await runAgentic({
      script: [
        {
          actor: LEAD,
          transcriptText: [
            '```json',
            JSON.stringify({
              kind: 'append_mailbox_message',
              payload: {
                fromActor: LEAD,
                toActor: EVALUATOR,
                kind: 'task',
                body: 'Review the draft.',
              },
            }),
            '```',
          ].join('\n'),
        },
        {
          actor: EVALUATOR,
          transcriptText: [
            '```json',
            JSON.stringify({
              kind: 'append_mailbox_message',
              payload: {
                fromActor: EVALUATOR,
                toActor: LEAD,
                kind: 'completion',
                body: 'Review complete.',
              },
            }),
            '```',
          ].join('\n'),
        },
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"complete_run","payload":{"status":"succeeded","summary":"done"}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:evaluator', 'role:lead']);
  });

  it('keeps the sub-actor turn while a delegated task is still active', async () => {
    const { prompts } = await runAgentic({
      script: [
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"create_task","payload":{"title":"Implement","ownerActor":{"kind":"role","role":"generator"},"dependsOn":[]}}\n```',
        },
        {
          actor: GENERATOR,
          transcriptText: (prompt) =>
            `\`\`\`json\n${JSON.stringify({
              kind: 'change_task_state',
              payload: {
                taskId: taskIdFromPrompt(prompt),
                to: 'running',
              },
            })}\n\`\`\``,
        },
        {
          actor: GENERATOR,
          transcriptText: '```json\n{"kind":"publish_artifact","payload":{"kind":"intermediate","mediaType":"text/markdown","byteSize":128}}\n```',
        },
        {
          actor: GENERATOR,
          transcriptText: '```json\n{"kind":"append_mailbox_message","payload":{"fromActor":{"kind":"role","role":"generator"},"toActor":{"kind":"role","role":"lead"},"kind":"completion","body":"Work complete."}}\n```',
        },
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"complete_run","payload":{"status":"succeeded","summary":"done"}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual([
      'role:lead',
      'role:generator',
      'role:generator',
      'role:generator',
      'role:lead',
    ]);
  });

  it('returns to lead on a terminal task transition', async () => {
    const { prompts } = await runAgentic({
      script: [
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"create_task","payload":{"title":"Implement","ownerActor":{"kind":"role","role":"generator"},"dependsOn":[]}}\n```',
        },
        {
          actor: GENERATOR,
          transcriptText: (prompt) =>
            `\`\`\`json\n${JSON.stringify({
              kind: 'change_task_state',
              payload: {
                taskId: taskIdFromPrompt(prompt),
                to: 'running',
              },
            })}\n\`\`\``,
        },
        {
          actor: GENERATOR,
          transcriptText: (prompt) =>
            `\`\`\`json\n${JSON.stringify({
              kind: 'change_task_state',
              payload: {
                taskId: taskIdFromPrompt(prompt),
                to: 'completed',
              },
            })}\n\`\`\``,
        },
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"complete_run","payload":{"status":"succeeded","summary":"done"}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:generator', 'role:lead']);
  });

  it('returns to lead on mailbox completion', async () => {
    const { prompts } = await runAgentic({
      script: [
        {
          actor: LEAD,
          transcriptText: [
            '```json',
            JSON.stringify({
              kind: 'append_mailbox_message',
              payload: {
                fromActor: LEAD,
                toActor: GENERATOR,
                kind: 'task',
                body: 'Handle the change.',
              },
            }),
            '```',
          ].join('\n'),
        },
        {
          actor: GENERATOR,
          transcriptText: [
            '```json',
            JSON.stringify({
              kind: 'append_mailbox_message',
              payload: {
                fromActor: GENERATOR,
                toActor: LEAD,
                kind: 'completion',
                body: 'Handled.',
              },
            }),
            '```',
          ].join('\n'),
        },
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"complete_run","payload":{"status":"succeeded","summary":"done"}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
  });

  it('retries a parse repair within budget and succeeds', async () => {
    const { prompts, result } = await runAgentic({
      spec: { orchestration: { mode: 'agentic', maxParseFailuresPerTurn: 1 } },
      script: [
        { actor: LEAD, transcriptText: 'not json' },
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"complete_run","payload":{"status":"succeeded","summary":"recovered"}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:lead']);
    expect(prompts.every((entry) => !entry.prompt.includes(exactPhrase))).toBe(true);
    expect(result.events.map((event) => event.kind)).toEqual(['run_started', 'mailbox_message_appended', 'run_completed']);
    expect(result.events.at(-1)?.payload).toMatchObject({ status: 'succeeded', summary: 'recovered' });
  });

  it('fails when the parse repair budget is exhausted', async () => {
    const { result } = await runAgentic({
      adapterOptions: { maxParseFailuresPerTurn: 0 },
      script: [{ actor: LEAD, transcriptText: 'still not json' }],
    });

    expect(result.events.at(-1)?.payload).toMatchObject({
      status: 'failed',
      summary: 'parse failure budget exhausted for actor role:lead at turn 0',
    });
  });

  it('surfaces a kernel rejection in the next lead prompt and recovers', async () => {
    const { prompts, result } = await runAgentic({
      script: [
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"change_task_state","payload":{"taskId":"missing-task","to":"running"}}\n```',
        },
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"complete_run","payload":{"status":"succeeded","summary":"recovered"}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:lead']);
    expect(prompts[1]?.prompt).toContain('"lastRejection"');
    expect(prompts[1]?.prompt).toContain('missing-task');
    expect(result.events.map((event) => event.kind)).toEqual(['run_started', 'request_rejected', 'run_completed']);
    expect(result.events.at(-1)?.payload).toMatchObject({ status: 'succeeded', summary: 'recovered' });
  });

  it('fails the run when maxTurns is exceeded', async () => {
    const { prompts, result } = await runAgentic({
      adapterOptions: { maxTurns: 1 },
      script: [
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"create_task","payload":{"title":"Implement","ownerActor":{"kind":"role","role":"generator"},"dependsOn":[]}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead']);
    expect(result.events.at(-1)?.payload).toMatchObject({ status: 'failed', summary: 'maxTurns exhausted' });
  });

  it('fails when maxNoProgressTurns is exceeded', async () => {
    const { prompts, result } = await runAgentic({
      adapterOptions: { maxNoProgressTurns: 1 },
      script: [
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"change_task_state","payload":{"taskId":"missing-task","to":"running"}}\n```',
        },
        {
          actor: LEAD,
          transcriptText: '```json\n{"kind":"change_task_state","payload":{"taskId":"missing-task","to":"running"}}\n```',
        },
      ],
    });

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:lead']);
    expect(result.events.at(-1)?.payload).toMatchObject({ status: 'failed', summary: 'maxNoProgressTurns exhausted' });
  });
});
