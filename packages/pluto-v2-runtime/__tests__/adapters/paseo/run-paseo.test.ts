import { describe, expect, it, vi } from 'vitest';

import { counterIdProvider, fixedClockProvider, type ActorRef, type AuthoredSpec } from '@pluto/v2-core';

import type { KernelView } from '../../../src/runtime/kernel-view.js';
import { runPaseo, type PaseoCliClient, type PaseoRuntimeAdapter, type PaseoUsageEstimate } from '../../../src/adapters/paseo/run-paseo.js';

type MockTurn = {
  actor: ActorRef;
  prompt: string;
};

type MockState = {
  turnIndex: number;
  transcriptByActor: Map<string, string>;
  pendingTurns: MockTurn[];
  stepFactory: (state: MockState, view: KernelView) => ReturnType<PaseoRuntimeAdapter<MockState>['step']>;
};

type ClientScriptEntry = {
  actor: ActorRef;
  transcriptText: string;
  usage: PaseoUsageEstimate;
  waitExitCode: number;
};

const FIXED_TIME = '2026-05-07T00:00:00.000Z';

const authored: AuthoredSpec = {
  runId: '11111111-1111-4111-8111-111111111111',
  scenarioRef: 'scenario/paseo-test',
  runProfileRef: 'paseo-test',
  actors: {
    manager: { kind: 'manager' },
    generator: { kind: 'role', role: 'generator' },
    evaluator: { kind: 'role', role: 'evaluator' },
  },
  declaredActors: ['manager', 'generator', 'evaluator'],
};

const generatorActor: ActorRef = { kind: 'role', role: 'generator' };
const evaluatorActor: ActorRef = { kind: 'role', role: 'evaluator' };

function actorKeyForTest(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `role:${actor.role}`;
  }
}

function makeAdapter(options: {
  pendingTurns: MockTurn[];
  stepFactory: (state: MockState, view: KernelView) => ReturnType<PaseoRuntimeAdapter<MockState>['step']>;
}): PaseoRuntimeAdapter<MockState> {
  return {
    init() {
      return {
        turnIndex: 0,
        transcriptByActor: new Map<string, string>(),
        pendingTurns: [...options.pendingTurns],
        stepFactory: options.stepFactory,
      };
    },

    pendingPaseoTurn(state) {
      return state.pendingTurns[0] ?? null;
    },

    withPaseoResponse(state, response) {
      const key = actorKeyForTest(response.actor);
      const nextTranscriptByActor = new Map(state.transcriptByActor);
      nextTranscriptByActor.set(key, (nextTranscriptByActor.get(key) ?? '') + response.transcriptText);
      return {
        ...state,
        turnIndex: state.turnIndex + 1,
        transcriptByActor: nextTranscriptByActor,
        pendingTurns: state.pendingTurns.slice(1),
      };
    },

    step(state, view) {
      return state.stepFactory(state, view);
    },
  };
}

function makeAppendMailboxRequest(runId: string) {
  return {
    requestId: '00000000-0000-4000-8000-000000000010',
    runId,
    actor: generatorActor,
    intent: 'append_mailbox_message' as const,
    payload: {
      fromActor: generatorActor,
      toActor: { kind: 'manager' as const },
      kind: 'plan' as const,
      body: 'generator update',
    },
    idempotencyKey: 'idem-1',
    clientTimestamp: FIXED_TIME,
    schemaVersion: '1.0' as const,
  };
}

function makeMockClient(script: readonly ClientScriptEntry[], deleteImpl?: (agentId: string) => Promise<void>): PaseoCliClient {
  const grouped = new Map<string, ClientScriptEntry[]>();
  const cursors = new Map<string, number>();
  const cumulative = new Map<string, string>();

  for (const entry of script) {
    const key = actorKeyForTest(entry.actor);
    const entries = grouped.get(key) ?? [];
    entries.push(entry);
    grouped.set(key, entries);
  }

  return {
    spawnAgent: vi.fn(async (spec) => {
      const agentId = `mock-${spec.title}`;
      const key = agentId.slice('mock-'.length);
      // spawn-with-initialPrompt consumes the first turn's slot, so advance
      // the cursor here just like sendPrompt does for subsequent turns.
      cursors.set(key, (cursors.get(key) ?? -1) + 1);
      return { agentId };
    }),
    sendPrompt: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      cursors.set(key, (cursors.get(key) ?? -1) + 1);
    }),
    waitIdle: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      const index = cursors.get(key) ?? -1;
      const entry = grouped.get(key)?.[index];
      if (!entry) {
        throw new Error(`Missing wait script entry for ${agentId} at ${index}`);
      }
      return { exitCode: entry.waitExitCode };
    }),
    readTranscript: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      const index = cursors.get(key) ?? -1;
      const entry = grouped.get(key)?.[index];
      if (!entry) {
        throw new Error(`Missing transcript script entry for ${agentId} at ${index}`);
      }
      const next = (cumulative.get(key) ?? '') + entry.transcriptText;
      cumulative.set(key, next);
      return next;
    }),
    usageEstimate: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      const index = cursors.get(key) ?? -1;
      const entry = grouped.get(key)?.[index];
      if (!entry) {
        throw new Error(`Missing usage script entry for ${agentId} at ${index}`);
      }
      return entry.usage;
    }),
    deleteAgent: vi.fn(async (agentId: string) => {
      await deleteImpl?.(agentId);
    }),
  };
}

async function runWith(options: { client: PaseoCliClient; adapter: PaseoRuntimeAdapter<MockState>; maxSteps?: number }) {
  return runPaseo(authored, options.adapter, {
    client: options.client,
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider(FIXED_TIME),
    paseoAgentSpec: (actor) => ({
      provider: 'opencode',
      model: 'openai/gpt-5.4',
      mode: 'build',
      title: actorKeyForTest(actor),
      initialPrompt: `You are ${actorKeyForTest(actor)}. Wait for the next prompt.`,
    }),
    maxSteps: options.maxSteps,
  });
}

describe('runPaseo', () => {
  it('reuses spawned agents by actor and accumulates usage', async () => {
    const client = makeMockClient([
      {
        actor: generatorActor,
        transcriptText: 'first response\n',
        usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
        waitExitCode: 0,
      },
      {
        actor: generatorActor,
        transcriptText: 'second response\n',
        usage: { inputTokens: 12, outputTokens: 6, costUsd: 0.02 },
        waitExitCode: 0,
      },
    ]);
    const adapter = makeAdapter({
      pendingTurns: [
        { actor: generatorActor, prompt: 'prompt-1' },
        { actor: generatorActor, prompt: 'prompt-2' },
      ],
      stepFactory: (state) => ({
        kind: 'done',
        completion: { status: 'succeeded', summary: `turns:${state.turnIndex}` },
        nextState: state,
      }),
    });

    const result = await runWith({ client, adapter, maxSteps: 1 });

    expect(client.spawnAgent).toHaveBeenCalledTimes(1);
    expect(client.spawnAgent).toHaveBeenCalledWith({
      provider: 'opencode',
      model: 'openai/gpt-5.4',
      mode: 'build',
      title: 'role:generator',
      initialPrompt: 'prompt-1',
    });
    expect(client.sendPrompt).toHaveBeenCalledTimes(1);
    expect(client.sendPrompt).toHaveBeenCalledWith('mock-role:generator', 'prompt-2');
    expect(result.usage.totalInputTokens).toBe(22);
    expect(result.usage.totalOutputTokens).toBe(11);
    expect(result.usage.totalCostUsd).toBe(0.03);
    expect(result.usage.byActor.get('role:generator')).toEqual({
      turns: 2,
      inputTokens: 22,
      outputTokens: 11,
      costUsd: 0.03,
    });
    expect(result.usage.usageStatus).toBe('available');
    expect(result.usage.reportedBy).toBe('paseo.usageEstimate');
    expect(result.usage.estimated).toBe(true);
    expect(result.usage.perTurn).toEqual([
      {
        turnIndex: 0,
        actor: generatorActor,
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
        waitExitCode: 0,
      },
      {
        turnIndex: 1,
        actor: generatorActor,
        inputTokens: 12,
        outputTokens: 6,
        costUsd: 0.02,
        waitExitCode: 0,
      },
    ]);
  });

  it('keeps zero-valued usage reports available when the provider reported them explicitly', async () => {
    const client = makeMockClient([
      {
        actor: generatorActor,
        transcriptText: 'no usage\n',
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        waitExitCode: 0,
      },
    ]);
    const adapter = makeAdapter({
      pendingTurns: [{ actor: generatorActor, prompt: 'prompt-1' }],
      stepFactory: (state) => ({
        kind: 'done',
        completion: { status: 'succeeded', summary: `turns:${state.turnIndex}` },
        nextState: state,
      }),
    });

    const result = await runWith({ client, adapter, maxSteps: 1 });

    expect(result.usage.totalInputTokens).toBe(0);
    expect(result.usage.totalOutputTokens).toBe(0);
    expect(result.usage.totalCostUsd).toBe(0);
    expect(result.usage.usageStatus).toBe('available');
    expect(result.usage.reportedBy).toBe('paseo.usageEstimate');
    expect(result.usage.estimated).toBe(true);
  });

  it('marks usage as partial when only some turns report telemetry', async () => {
    const client = makeMockClient([
      {
        actor: generatorActor,
        transcriptText: 'reported usage\n',
        usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.01 },
        waitExitCode: 0,
      },
      {
        actor: generatorActor,
        transcriptText: 'missing usage\n',
        usage: {},
        waitExitCode: 0,
      },
    ]);
    const adapter = makeAdapter({
      pendingTurns: [
        { actor: generatorActor, prompt: 'prompt-1' },
        { actor: generatorActor, prompt: 'prompt-2' },
      ],
      stepFactory: (state) => ({
        kind: 'done',
        completion: { status: 'succeeded', summary: `turns:${state.turnIndex}` },
        nextState: state,
      }),
    });

    const result = await runWith({ client, adapter, maxSteps: 1 });

    expect(result.usage.totalInputTokens).toBe(10);
    expect(result.usage.totalOutputTokens).toBe(4);
    expect(result.usage.totalCostUsd).toBe(0.01);
    expect(result.usage.usageStatus).toBe('partial');
    expect(result.usage.reportedBy).toBe('paseo.usageEstimate');
    expect(result.usage.estimated).toBe(true);
  });

  it('does not count model phases against maxSteps', async () => {
    const client = makeMockClient([
      {
        actor: generatorActor,
        transcriptText: 'alpha\n',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 },
        waitExitCode: 0,
      },
      {
        actor: generatorActor,
        transcriptText: 'beta\n',
        usage: { inputTokens: 2, outputTokens: 2, costUsd: 0.002 },
        waitExitCode: 0,
      },
    ]);
    const stepSpy = vi.fn((state: MockState) => ({
      kind: 'done' as const,
      completion: { status: 'succeeded' as const, summary: `steps:${state.turnIndex}` },
      nextState: state,
    }));
    const adapter = makeAdapter({
      pendingTurns: [
        { actor: generatorActor, prompt: 'prompt-a' },
        { actor: generatorActor, prompt: 'prompt-b' },
      ],
      stepFactory: stepSpy,
    });

    const result = await runWith({ client, adapter, maxSteps: 1 });

    expect(stepSpy).toHaveBeenCalledTimes(1);
    expect(result.events.at(-1)?.kind).toBe('run_completed');
    expect(result.usage.perTurn).toHaveLength(2);
  });

  it('strips acceptedRequestKey from public events', async () => {
    const client = makeMockClient([]);
    const adapter = makeAdapter({
      pendingTurns: [],
      stepFactory: (state, view) => {
        if (state.turnIndex === 0) {
          return {
            kind: 'request',
            request: makeAppendMailboxRequest(view.state.runId),
            nextState: { ...state, turnIndex: 1 },
          };
        }

        return {
          kind: 'done',
          completion: { status: 'succeeded', summary: 'done' },
          nextState: state,
        };
      },
    });

    const result = await runWith({ client, adapter, maxSteps: 2 });

    expect(result.events.map((event) => event.kind)).toEqual([
      'run_started',
      'mailbox_message_appended',
      'run_completed',
    ]);
    for (const event of result.events) {
      expect(Object.prototype.hasOwnProperty.call(event, 'acceptedRequestKey')).toBe(false);
    }
  });

  it('deletes spawned agents best-effort on completion', async () => {
    const client = makeMockClient(
      [
        {
          actor: generatorActor,
          transcriptText: 'g\n',
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 },
          waitExitCode: 0,
        },
        {
          actor: evaluatorActor,
          transcriptText: 'e\n',
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 },
          waitExitCode: 0,
        },
      ],
      async (agentId) => {
        if (agentId === 'mock-role:generator') {
          throw new Error('delete failed');
        }
      },
    );
    const adapter = makeAdapter({
      pendingTurns: [
        { actor: generatorActor, prompt: 'generator prompt' },
        { actor: evaluatorActor, prompt: 'evaluator prompt' },
      ],
      stepFactory: (state) => ({
        kind: 'done',
        completion: { status: 'succeeded', summary: `turns:${state.turnIndex}` },
        nextState: state,
      }),
    });

    const result = await runWith({ client, adapter, maxSteps: 1 });

    expect(result.events.at(-1)?.kind).toBe('run_completed');
    expect(client.deleteAgent).toHaveBeenCalledTimes(2);
    expect(client.deleteAgent).toHaveBeenCalledWith('mock-role:generator');
    expect(client.deleteAgent).toHaveBeenCalledWith('mock-role:evaluator');
  });
});
