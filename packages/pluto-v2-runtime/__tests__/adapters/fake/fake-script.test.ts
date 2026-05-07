import { describe, expect, it } from 'vitest';

import { counterIdProvider, fixedClockProvider, initialState, type AuthoredSpec } from '@pluto/v2-core';

import { resolveFakeScriptStep } from '../../../src/index.js';
import { kernelViewOf } from '../../../src/runtime/runner.js';
import { RunKernel } from '@pluto/v2-core';
import { compile } from '@pluto/v2-core';

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
    },
    {
      actor: { kind: 'manager' },
      intent: 'change_task_state',
      payload: {
        taskId: { $ref: 'events[0].payload.taskId' },
        to: 'running',
      },
    },
  ],
};

function seededView() {
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
  kernel.submit({
    requestId: '00000000-0000-4000-8000-000000000002',
    runId: authored.runId,
    actor: { kind: 'manager' },
    intent: 'create_task',
    payload: {
      title: 'Create a task',
      ownerActor: { kind: 'role', role: 'planner' },
      dependsOn: [],
    },
    idempotencyKey: null,
    clientTimestamp: '2026-05-07T00:00:00.000Z',
    schemaVersion: '1.0',
  });

  return kernelViewOf(kernel);
}

describe('resolveFakeScriptStep', () => {
  it('resolves event payload refs against accepted request-backed events', () => {
    const resolved = resolveFakeScriptStep(authored.fakeScript![1]!, seededView());

    expect(resolved.payload).toEqual({
      taskId: '00000000-0000-4000-8000-000000000003',
      to: 'running',
    });
  });

  it('throws when a referenced event is missing', () => {
    expect(() => resolveFakeScriptStep(authored.fakeScript![1]!, { state: seededView().state, events: [] })).toThrow(
      /missing event/,
    );
  });
});
