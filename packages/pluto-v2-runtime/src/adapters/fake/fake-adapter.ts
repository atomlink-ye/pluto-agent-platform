import type { ClockProvider, IdProvider } from '@pluto/v2-core/core/providers';
import type { FakeScriptStep, TeamContext } from '@pluto/v2-core/core/team-context';

import type { KernelView } from '../../runtime/kernel-view.js';
import type { RuntimeAdapter } from '../../runtime/runtime-adapter.js';
import { materializeFakeCompletion, materializeFakeProtocolRequest } from './fake-script.js';

export interface FakeAdapterState {
  index: number;
}

export function makeFakeAdapter(
  steps: readonly FakeScriptStep[] | undefined,
  providers: { idProvider: IdProvider; clockProvider: ClockProvider },
): RuntimeAdapter<FakeAdapterState> {
  return {
    init(_teamContext: TeamContext, _view: KernelView): FakeAdapterState {
      return { index: 0 };
    },

    step(state: FakeAdapterState, view: KernelView) {
      const step = steps?.[state.index];
      const nextState = { index: state.index + 1 };

      if (!step) {
        return {
          kind: 'done' as const,
          completion: { status: 'succeeded' as const, summary: null },
          nextState,
        };
      }

      if (step.intent === 'complete_run') {
        return {
          kind: 'done' as const,
          completion: materializeFakeCompletion(step, view),
          nextState,
        };
      }

      return {
        kind: 'request' as const,
        request: materializeFakeProtocolRequest(step, view, providers),
        nextState,
      };
    },
  };
}
