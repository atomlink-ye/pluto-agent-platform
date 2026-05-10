import type { ClockProvider, IdProvider } from '@pluto/v2-core/core/providers';
import type { AuthoredSpec } from '@pluto/v2-core/core/team-context';

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
