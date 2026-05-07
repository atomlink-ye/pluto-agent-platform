import { describe, expect, it, vi } from 'vitest';

import { counterIdProvider, fixedClockProvider, RunKernel, type AuthoredSpec } from '@pluto/v2-core';

import { RunNotCompletedError, runScenario } from '../../src/index.js';
import type { RuntimeAdapter } from '../../src/runtime/runtime-adapter.js';

const authored: AuthoredSpec = {
  runId: '11111111-1111-4111-8111-111111111111',
  scenarioRef: 'scenario/hello-team',
  runProfileRef: 'fake-smoke',
  actors: {
    manager: { kind: 'manager' },
  },
  declaredActors: ['manager'],
};

describe('runScenario', () => {
  it('seeds run_started before the adapter loop and exactly once', () => {
    const seedRunStartedSpy = vi.spyOn(RunKernel.prototype, 'seedRunStarted');
    const adapter: RuntimeAdapter<{ seenInit: boolean }> = {
      init(_teamContext, view) {
        expect(view.events[0]?.kind).toBe('run_started');
        return { seenInit: true };
      },
      step(state) {
        return {
          kind: 'done',
          completion: { status: 'succeeded', summary: 'Done.' },
          nextState: state,
        };
      },
    };

    const result = runScenario(authored, adapter, {
      idProvider: counterIdProvider(1),
      clockProvider: fixedClockProvider('2026-05-07T00:00:00.000Z'),
    });

    expect(result.events.map((event) => event.kind)).toEqual(['run_started', 'run_completed']);
    expect(seedRunStartedSpy).toHaveBeenCalledTimes(1);
    seedRunStartedSpy.mockRestore();
  });

  it('throws when the adapter never completes', () => {
    const adapter: RuntimeAdapter<number> = {
      init() {
        return 0;
      },
      step(state, view) {
        return {
          kind: 'request',
          request: {
            requestId: '00000000-0000-4000-8000-000000000002',
            runId: view.state.runId,
            actor: { kind: 'manager' },
            intent: 'append_mailbox_message',
            payload: {
              fromActor: { kind: 'manager' },
              toActor: { kind: 'broadcast' },
              kind: 'plan',
              body: `loop-${state}`,
            },
            idempotencyKey: null,
            clientTimestamp: '2026-05-07T00:00:00.000Z',
            schemaVersion: '1.0',
          },
          nextState: state + 1,
        };
      },
    };

    expect(() =>
      runScenario(authored, adapter, {
        idProvider: counterIdProvider(1),
        clockProvider: fixedClockProvider('2026-05-07T00:00:00.000Z'),
        maxSteps: 1,
      }),
    ).toThrow(RunNotCompletedError);
  });
});
