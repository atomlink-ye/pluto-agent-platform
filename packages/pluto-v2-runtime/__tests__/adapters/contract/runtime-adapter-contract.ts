import {
  RUN_COMPLETED_STATUS_VALUES,
  RunKernel,
  compile,
  counterIdProvider,
  fixedClockProvider,
  initialState,
  type AuthoredSpec,
  type ProtocolRequest,
  type RunCompletedStatus,
  type TeamContext,
} from '@pluto/v2-core';
import { describe, expect, it } from 'vitest';

import type { KernelView } from '../../../src/runtime/kernel-view.js';
import { kernelViewOf } from '../../../src/runtime/runner.js';
import type { RuntimeAdapter, RuntimeAdapterCompletion } from '../../../src/runtime/runtime-adapter.js';

const FIXED_TIME = '2026-05-10T00:00:00.000Z';

const CONTRACT_AUTHORED: AuthoredSpec = {
  runId: '11111111-1111-4111-8111-111111111111',
  scenarioRef: 'scenario/runtime-adapter-contract',
  runProfileRef: 'runtime-adapter-contract',
  actors: {
    manager: { kind: 'manager' },
    planner: { kind: 'role', role: 'planner' },
    generator: { kind: 'role', role: 'generator' },
    evaluator: { kind: 'role', role: 'evaluator' },
  },
  declaredActors: ['manager', 'planner', 'generator', 'evaluator'],
};

export type ContractScenario = 'happy_path' | 'failed' | 'cancelled' | 'exhausted';

export type AdapterFactoryArgs = {
  teamContext: TeamContext;
  view: KernelView;
  scenario: ContractScenario;
};

export type AdapterContractHarness<TState> = {
  adapter: RuntimeAdapter<TState>;
  stateCursor: (state: TState) => number;
  primeForStep?: (state: TState, view: KernelView) => TState;
  maxContractSteps?: number;
};

export type AdapterFactory<TState> = (args: AdapterFactoryArgs) => AdapterContractHarness<TState>;

type DriveResult = {
  completion: RuntimeAdapterCompletion;
  requestCount: number;
  progression: number[];
};

type NormalizedContractStep<TState> =
  | {
      kind: 'done';
      completion: RuntimeAdapterCompletion;
      nextState: TState;
    }
  | {
      kind: 'request';
      nextState: TState;
      request: Omit<ProtocolRequest, 'requestId'>;
    };

function cloneForAssertion<T>(value: T): T {
  return structuredClone(value);
}

function createContractContext<TState>(factory: AdapterFactory<TState>, scenario: ContractScenario) {
  const teamContext = compile(CONTRACT_AUTHORED);
  const kernel = new RunKernel({
    initialState: initialState(teamContext),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider(FIXED_TIME),
  });

  kernel.seedRunStarted({
    scenarioRef: CONTRACT_AUTHORED.scenarioRef,
    runProfileRef: CONTRACT_AUTHORED.runProfileRef,
    startedAt: FIXED_TIME,
  });

  const view = kernelViewOf(kernel);
  const harness = factory({ teamContext, view, scenario });

  return { teamContext, kernel, harness };
}

function assertRequestShape(request: ProtocolRequest, runId: string): void {
  expect(request.runId).toBe(runId);
  expect(typeof request.requestId).toBe('string');
  expect(request.requestId.length).toBeGreaterThan(0);
  expect(typeof request.schemaVersion).toBe('string');
}

function assertCompletionShape(
  completion: RuntimeAdapterCompletion,
  expectedStatus: RunCompletedStatus | null = null,
): void {
  expect(RUN_COMPLETED_STATUS_VALUES).toContain(completion.status);
  expect(typeof completion.summary === 'string' || completion.summary === null).toBe(true);

  if (expectedStatus !== null) {
    expect(completion.status).toBe(expectedStatus);
  }
}

function normalizeStepForAssertion<TState>(step: ReturnType<RuntimeAdapter<TState>['step']>): NormalizedContractStep<TState> {
  if (step.kind === 'done') {
    return step;
  }

  const { requestId: _requestId, ...request } = step.request;
  return {
    kind: 'request',
    nextState: step.nextState,
    request,
  };
}

function driveAdapter<TState>(factory: AdapterFactory<TState>, scenario: ContractScenario): DriveResult {
  const { teamContext, kernel, harness } = createContractContext(factory, scenario);
  let state = harness.adapter.init(teamContext, kernelViewOf(kernel));
  const progression = [harness.stateCursor(state)];
  const maxSteps = harness.maxContractSteps ?? 12;
  let requestCount = 0;

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const view = kernelViewOf(kernel);
    const stepReadyState = harness.primeForStep?.(state, view) ?? state;
    const cursorBefore = harness.stateCursor(stepReadyState);
    const step = harness.adapter.step(stepReadyState, view);

    expect(harness.stateCursor(step.nextState)).toBeGreaterThanOrEqual(cursorBefore);
    progression.push(harness.stateCursor(step.nextState));
    state = step.nextState;

    if (step.kind === 'request') {
      requestCount += 1;
      assertRequestShape(step.request, view.state.runId);
      kernel.submit(step.request);
      continue;
    }

    assertCompletionShape(step.completion);
    return {
      completion: step.completion,
      requestCount,
      progression,
    };
  }

  throw new Error(`Contract scenario ${scenario} exceeded ${maxSteps} steps without terminating`);
}

export function describeRuntimeAdapterContract<TState>(
  adapterName: string,
  factory: AdapterFactory<TState>,
): void {
  describe(`runtime-adapter contract: ${adapterName}`, () => {
    it('initializes stably and produces deterministic step output for the same primed state and view', () => {
      const { teamContext, kernel, harness } = createContractContext(factory, 'happy_path');
      const view = kernelViewOf(kernel);
      const firstInit = harness.adapter.init(teamContext, view);
      const secondInit = harness.adapter.init(teamContext, view);

      expect(secondInit).toStrictEqual(firstInit);

      const primedState = harness.primeForStep?.(firstInit, view) ?? firstInit;
      const stateSnapshot = cloneForAssertion(primedState);
      const viewSnapshot = cloneForAssertion(view);
      const firstStep = harness.adapter.step(primedState, view);
      const secondStep = harness.adapter.step(primedState, view);

      expect(normalizeStepForAssertion(firstStep)).toStrictEqual(normalizeStepForAssertion(secondStep));
      expect(primedState).toStrictEqual(stateSnapshot);
      expect(view).toStrictEqual(viewSnapshot);
    });

    it('happy path emits one or more request steps before exactly one terminal done step', () => {
      const result = driveAdapter(factory, 'happy_path');

      expect(result.requestCount).toBeGreaterThan(0);
      assertCompletionShape(result.completion, 'succeeded');
    });

    it('happy path state progresses monotonically toward termination', () => {
      const result = driveAdapter(factory, 'happy_path');

      for (let index = 1; index < result.progression.length; index += 1) {
        expect(result.progression[index]).toBeGreaterThanOrEqual(result.progression[index - 1] ?? -1);
      }

      expect(result.progression.at(-1)).toBeGreaterThan(result.progression[0] ?? -1);
    });

    it.each([
      ['happy_path', 'succeeded'],
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
    ] as const)('surfaces %s completion status through the public completion shape', (scenario, expectedStatus) => {
      const result = driveAdapter(factory, scenario);
      assertCompletionShape(result.completion, expectedStatus);
    });

    it('classifies exhaustion as failed rather than succeeded', () => {
      const result = driveAdapter(factory, 'exhausted');

      assertCompletionShape(result.completion, 'failed');
      expect(result.completion.status).not.toBe('succeeded');
      expect(result.completion.summary?.toLowerCase()).toContain('exhaust');
    });
  });
}
