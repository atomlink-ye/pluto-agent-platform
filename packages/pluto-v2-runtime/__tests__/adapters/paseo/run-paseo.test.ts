import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { counterIdProvider, fixedClockProvider, type ActorRef, type AuthoredSpec } from '@pluto/v2-core';

import type { KernelView } from '../../../src/runtime/kernel-view.js';
import { runPaseo, type PaseoCliClient, type PaseoRuntimeAdapter, type PaseoUsageEstimate } from '../../../src/adapters/paseo/run-paseo.js';
import { buildUsageSummary } from '../../../src/evidence/usage-summary-builder.js';
import { loadAuthoredSpec, type LoadedAuthoredSpec } from '../../../src/loader/authored-spec-loader.js';

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
const AGENTIC_TOOL_SCENARIO_PATH = fileURLToPath(
  new URL('../../../test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml', import.meta.url),
);

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

  return 'unknown';
}

function buildAgenticSpec(): LoadedAuthoredSpec {
  const loaded = loadAuthoredSpec(AGENTIC_TOOL_SCENARIO_PATH);
  const spec = {
    ...loaded,
    actors: {
      ...loaded.actors,
      planner: { kind: 'role' as const, role: 'planner' as const },
    },
    declaredActors: [...loaded.declaredActors, 'planner'],
    orchestration: {
      ...loaded.orchestration,
    },
  };

  Object.defineProperty(spec, 'playbook', {
    value: loaded.playbook,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return spec as LoadedAuthoredSpec;
}

function readInjectedApi(spec: { env?: Readonly<Record<string, string>> }): { url: string; token: string; actor: string } {
  const url = spec.env?.PLUTO_RUN_API_URL;
  const token = spec.env?.PLUTO_RUN_TOKEN;
  const actor = spec.env?.PLUTO_RUN_ACTOR;
  if (typeof url !== 'string' || typeof token !== 'string' || typeof actor !== 'string') {
    throw new Error('missing run API env handoff');
  }

  return { url, token, actor };
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

  it('preserves unavailable usage as null across runtime and built aggregate views', async () => {
    const client = makeMockClient([
      {
        actor: generatorActor,
        transcriptText: 'missing usage\n',
        usage: {},
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
    const usageSummary = buildUsageSummary({
      authored,
      evidencePacket: result.evidencePacket,
      usage: result.usage,
      actorSpecByKey: new Map([
        ['role:generator', { provider: 'opencode', model: 'openai/gpt-5.4', mode: 'build' }],
      ]),
      evidencePacketPath: 'runs/run-1/evidence-packet.json',
    });

    expect(result.usage.totalInputTokens).toBeNull();
    expect(result.usage.totalOutputTokens).toBeNull();
    expect(result.usage.totalCostUsd).toBeNull();
    expect(result.usage.byActor.get('role:generator')).toEqual({
      turns: 1,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    });
    expect(result.usage.perTurn[0]).toEqual({
      turnIndex: 0,
      actor: generatorActor,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      waitExitCode: 0,
    });
    expect(result.usage.usageStatus).toBe('unavailable');

    expect(usageSummary.byActor['role:generator']).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
    expect(usageSummary.byModel['opencode:openai/gpt-5.4']).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
    expect(usageSummary.perTurn[0]).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    });
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

  it('precomputes distinct actor tokens and writes the correct handoff for never-active actors', async () => {
    const workspaceCwd = await mkdtemp(join(tmpdir(), 'pluto-v2-run-paseo-agentic-'));
    const spec = buildAgenticSpec();
    const spawnSpecs: Array<{ title: string; env?: Readonly<Record<string, string>> }> = [];
    const specByAgentId = new Map<string, { title: string; env?: Readonly<Record<string, string>> }>();
    const transcriptByAgentId = new Map<string, string>();
    const bridgeSelfCheck = vi.fn(async () => ({ ok: true, latencyMs: 0 }));
    const client: PaseoCliClient = {
      spawnAgent: vi.fn(async (agentSpec) => {
        const agentId = `mock-${agentSpec.title}`;
        spawnSpecs.push(agentSpec);
        specByAgentId.set(agentId, agentSpec);
        return { agentId };
      }),
      sendPrompt: vi.fn(async () => {
        throw new Error('unexpected follow-up prompt');
      }),
      waitIdle: vi.fn(async (agentId: string) => {
        const agentSpec = specByAgentId.get(agentId);
        if (agentSpec == null) {
          throw new Error(`missing spec for ${agentId}`);
        }

        const { url, token, actor } = readInjectedApi(agentSpec);
        const response = await fetch(`${url.replace(/\/v1$/, '/v2')}/composite/final-reconciliation`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'Pluto-Run-Actor': actor,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ completedTasks: ['missing-task'], citedMessages: ['999'], summary: 'done' }),
        });
        expect(response.status).toBe(200);
        transcriptByAgentId.set(agentId, 'lead completed the run\n');
        return { exitCode: 0 };
      }),
      readTranscript: vi.fn(async (agentId: string) => transcriptByAgentId.get(agentId) ?? ''),
      usageEstimate: vi.fn(async () => ({})),
      deleteAgent: vi.fn(async () => {}),
    };

    try {
      const result = await runPaseo(spec, makeAdapter({
        pendingTurns: [],
        stepFactory: (state) => ({
          kind: 'done',
          completion: { status: 'succeeded', summary: `turns:${state.turnIndex}` },
          nextState: state,
        }),
      }), {
        client,
        idProvider: counterIdProvider(1),
        clockProvider: fixedClockProvider(FIXED_TIME),
        paseoAgentSpec: (actor) => ({
          provider: 'opencode',
          model: 'openai/gpt-5.4',
          mode: 'build',
          title: actorKeyForTest(actor),
          initialPrompt: `You are ${actorKeyForTest(actor)}.`,
        }),
        bridgeSelfCheck,
        workspaceCwd,
      });

      expect(result.events.at(-1)?.kind).toBe('run_completed');
      expect(bridgeSelfCheck).toHaveBeenCalledTimes(
        spec.declaredActors.filter((actorName) => spec.actors[actorName]?.kind !== 'manager').length,
      );
      expect(spawnSpecs).toHaveLength(1);

      const runAgentsDir = join(workspaceCwd, '.pluto', 'runs', spec.runId, 'agents');
      const leadHandoff = JSON.parse(await readFile(join(runAgentsDir, 'role:lead', '.pluto', 'handoff.json'), 'utf8')) as { bearerToken: string; actorKey: string };
      const generatorHandoff = JSON.parse(await readFile(join(runAgentsDir, 'role:generator', '.pluto', 'handoff.json'), 'utf8')) as { bearerToken: string; actorKey: string };
      const evaluatorHandoff = JSON.parse(await readFile(join(runAgentsDir, 'role:evaluator', '.pluto', 'handoff.json'), 'utf8')) as { bearerToken: string; actorKey: string };
      const plannerHandoff = JSON.parse(await readFile(join(runAgentsDir, 'role:planner', '.pluto', 'handoff.json'), 'utf8')) as { bearerToken: string; actorKey: string };

      expect(leadHandoff.actorKey).toBe('role:lead');
      expect(generatorHandoff.actorKey).toBe('role:generator');
      expect(evaluatorHandoff.actorKey).toBe('role:evaluator');
      expect(plannerHandoff.actorKey).toBe('role:planner');
      expect(new Set([
        leadHandoff.bearerToken,
        generatorHandoff.bearerToken,
        evaluatorHandoff.bearerToken,
        plannerHandoff.bearerToken,
      ]).size).toBe(4);
      expect(spawnSpecs[0]?.env?.PLUTO_RUN_TOKEN).toBe(leadHandoff.bearerToken);
      expect(spawnSpecs[0]?.env?.PLUTO_RUN_ACTOR).toBe('role:lead');
    } finally {
      await rm(workspaceCwd, { recursive: true, force: true });
    }
  });
});
