import { describe, expect, it } from 'vitest';

import { counterIdProvider, fixedClockProvider, initialState, RunKernel, compile, type AuthoredSpec } from '@pluto/v2-core';

import { makeFakeAdapter } from '../../../src/adapters/fake/fake-adapter.js';
import { kernelViewOf } from '../../../src/runtime/runner.js';

const authored: AuthoredSpec = {
  runId: '11111111-1111-4111-8111-111111111111',
  scenarioRef: 'scenario/hello-team',
  runProfileRef: 'fake-smoke',
  actors: {
    manager: { kind: 'manager' },
    planner: { kind: 'role', role: 'planner' },
  },
  declaredActors: ['manager', 'planner'],
  fakeScript: [
    {
      actor: { kind: 'manager' },
      intent: 'create_task',
      payload: {
        title: 'Create a task',
        ownerActor: { kind: 'role', role: 'planner' },
        dependsOn: [],
      },
      idempotencyKey: 'create-1',
    },
    {
      actor: { kind: 'manager' },
      intent: 'complete_run',
      payload: {
        status: 'succeeded',
        summary: 'Done.',
      },
    },
  ],
};

function createView() {
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

  return { teamContext, view: kernelViewOf(kernel) };
}

describe('makeFakeAdapter', () => {
  it('emits deterministic requests for scripted steps', () => {
    const providers = {
      idProvider: counterIdProvider(2),
      clockProvider: fixedClockProvider('2026-05-07T00:00:00.000Z'),
    };
    const adapter = makeFakeAdapter(authored.fakeScript ?? [], providers);
    const { teamContext, view } = createView();

    const state = adapter.init(teamContext, view);
    const step = adapter.step(state, view);

    expect(step.kind).toBe('request');
    if (step.kind !== 'request') {
      return;
    }

    expect(step.request.requestId).toBe('00000000-0000-4000-8000-000000000002');
    expect(step.request.intent).toBe('create_task');
  });

  it('converts complete_run scripted steps into done completions', () => {
    const providers = {
      idProvider: counterIdProvider(2),
      clockProvider: fixedClockProvider('2026-05-07T00:00:00.000Z'),
    };
    const adapter = makeFakeAdapter(authored.fakeScript ?? [], providers);
    const { teamContext, view } = createView();

    const first = adapter.step(adapter.init(teamContext, view), view);
    const second = adapter.step(first.nextState, view);

    expect(second).toEqual({
      kind: 'done',
      completion: {
        status: 'succeeded',
        summary: 'Done.',
      },
      nextState: { index: 2 },
    });
  });
});
