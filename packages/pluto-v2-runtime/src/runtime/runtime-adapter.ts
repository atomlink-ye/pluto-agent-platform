import type { RunCompletedStatus, ProtocolRequest, TeamContext } from '@pluto/v2-core';

import type { KernelView } from './kernel-view.js';

export type RuntimeAdapterCompletion = {
  status: RunCompletedStatus;
  summary: string | null;
};

export type RuntimeAdapterStep<TState> =
  | {
      kind: 'request';
      request: ProtocolRequest;
      nextState: TState;
    }
  | {
      kind: 'done';
      completion: RuntimeAdapterCompletion;
      nextState: TState;
    };

export interface RuntimeAdapter<TState = unknown> {
  init(teamContext: TeamContext, view: KernelView): TState;
  step(state: TState, view: KernelView): RuntimeAdapterStep<TState>;
}
