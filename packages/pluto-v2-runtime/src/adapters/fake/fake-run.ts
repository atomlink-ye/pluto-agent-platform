import type { AuthoredSpec, ClockProvider, IdProvider } from '@pluto/v2-core';

import { runScenario, type RunScenarioOptions } from '../../runtime/runner.js';
import { makeFakeAdapter } from './fake-adapter.js';

export interface RunFakeOptions extends RunScenarioOptions {
  requestIdProvider?: IdProvider;
  requestClockProvider?: ClockProvider;
}

export function runFake(authored: AuthoredSpec, options: RunFakeOptions) {
  return runScenario(
    authored,
    makeFakeAdapter(authored.fakeScript, {
      idProvider: options.requestIdProvider ?? options.idProvider,
      clockProvider: options.requestClockProvider ?? options.clockProvider,
    }),
    options,
  );
}
