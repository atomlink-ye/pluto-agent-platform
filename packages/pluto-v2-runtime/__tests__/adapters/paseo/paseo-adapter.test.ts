import { describe, expect, it } from 'vitest';

import { compile, counterIdProvider, fixedClockProvider, initialState, RunKernel, type AuthoredSpec } from '@pluto/v2-core';

import {
  PaseoAdapterStateError,
  makePaseoAdapter,
  type PaseoAdapterState,
} from '../../../src/adapters/paseo/paseo-adapter.js';
import { kernelViewOf } from '../../../src/runtime/runner.js';

const authored: AuthoredSpec = {
  runId: '11111111-1111-4111-8111-111111111111',
  scenarioRef: 'scenario/hello-team',
  runProfileRef: 'fake-smoke',
  actors: {
    manager: { kind: 'manager' },
    planner: { kind: 'role', role: 'planner' },
    generator: { kind: 'role', role: 'generator' },
    evaluator: { kind: 'role', role: 'evaluator' },
  },
  declaredActors: ['manager', 'planner', 'generator', 'evaluator'],
};

function createKernel() {
  const teamContext = compile(authored);
  const kernel = new RunKernel({
    initialState: initialState(teamContext),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider('2026-05-07T00:00:00.000Z'),
  });

  kernel.seedRunStarted({
    scenarioRef: authored.scenarioRef,
    runProfileRef: authored.runProfileRef,
    startedAt: '2026-05-07T00:00:00.000Z',
  });

  return { teamContext, kernel };
}

function createAdapter(options?: { maxTurns?: number; maxParseFailuresPerTurn?: number }) {
  return makePaseoAdapter({
    idProvider: counterIdProvider(50),
    clockProvider: fixedClockProvider('2026-05-07T00:00:00.000Z'),
    ...options,
  });
}

describe('makePaseoAdapter', () => {
  it('builds an explicit planner prompt for the first create_task phase', () => {
    const adapter = createAdapter();
    const { teamContext, kernel } = createKernel();
    const state = adapter.init(teamContext, kernelViewOf(kernel));

    const pending = adapter.pendingPaseoTurn(state, kernelViewOf(kernel));

    expect(pending?.actor).toEqual({ kind: 'role', role: 'planner' });
    expect(pending?.prompt).toContain('Return exactly one fenced JSON code block and nothing else.');
    expect(pending?.prompt).toContain('"kind": "create_task"');
  });

  it('fails when the parse-failure budget is exhausted', () => {
    const adapter = createAdapter({ maxParseFailuresPerTurn: 0 });
    const { teamContext, kernel } = createKernel();
    const initial = adapter.init(teamContext, kernelViewOf(kernel));
    const responded = adapter.withPaseoResponse(initial, {
      actor: { kind: 'role', role: 'planner' },
      transcriptText: 'not valid json',
      usage: {},
    });

    const step = adapter.step(responded, kernelViewOf(kernel));

    expect(step.kind).toBe('done');
    if (step.kind !== 'done') {
      return;
    }

    expect(step.completion).toEqual({
      status: 'failed',
      summary: 'parse failure budget exhausted for actor role:planner at turn 0',
    });
  });

  it('fails when maxTurns is already exhausted', () => {
    const adapter = createAdapter({ maxTurns: 0 });
    const { teamContext, kernel } = createKernel();
    const state = adapter.init(teamContext, kernelViewOf(kernel));

    expect(adapter.pendingPaseoTurn(state, kernelViewOf(kernel))).toBeNull();
    expect(adapter.step(state, kernelViewOf(kernel))).toEqual({
      kind: 'done',
      completion: {
        status: 'failed',
        summary: 'maxTurns exhausted',
      },
      nextState: state,
    });
  });

  it('throws when step is called before a pending paseo turn is serviced', () => {
    const adapter = createAdapter();
    const { teamContext, kernel } = createKernel();
    const state = adapter.init(teamContext, kernelViewOf(kernel));

    expect(() => adapter.step(state, kernelViewOf(kernel))).toThrow(PaseoAdapterStateError);
  });

  it('returns done directly for a parsed complete_run directive', () => {
    const adapter = createAdapter();
    const { kernel } = createKernel();
    const state: PaseoAdapterState = {
      turnIndex: 5,
      maxTurns: 20,
      currentActor: { kind: 'manager' },
      transcriptByActor: {},
      awaitingResponseFor: null,
      bufferedResponse: {
        actor: { kind: 'manager' },
        transcriptText: [
          '```json',
          '{"kind":"complete_run","payload":{"status":"succeeded","summary":"all phases complete"}}',
          '```',
        ].join('\n'),
        usage: {},
      },
      parseFailureCount: 0,
      maxParseFailuresPerTurn: 2,
    };

    const step = adapter.step(state, kernelViewOf(kernel));

    expect(step.kind).toBe('done');
    if (step.kind !== 'done') {
      return;
    }

    expect(step.completion).toEqual({
      status: 'succeeded',
      summary: 'all phases complete',
    });
  });
});
