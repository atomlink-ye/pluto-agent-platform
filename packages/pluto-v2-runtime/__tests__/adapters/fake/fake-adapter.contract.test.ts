import { counterIdProvider, fixedClockProvider, type FakeScriptStep } from '@pluto/v2-core';

import { makeFakeAdapter, type FakeAdapterState } from '../../../src/adapters/fake/fake-adapter.js';
import {
  describeRuntimeAdapterContract,
  type AdapterFactory,
  type ContractScenario,
} from '../contract/runtime-adapter-contract.js';

const FIXED_TIME = '2026-05-10T00:00:00.000Z';

function fakeScriptForScenario(scenario: ContractScenario): readonly FakeScriptStep[] {
  switch (scenario) {
    case 'happy_path':
      return [
        {
          actor: { kind: 'manager' },
          intent: 'create_task',
          payload: {
            title: 'Contract task',
            ownerActor: { kind: 'role', role: 'planner' },
            dependsOn: [],
          },
          idempotencyKey: 'fake-contract-create',
        },
        {
          actor: { kind: 'manager' },
          intent: 'complete_run',
          payload: {
            status: 'succeeded',
            summary: 'Fake happy path complete.',
          },
        },
      ];
    case 'failed':
      return [
        {
          actor: { kind: 'manager' },
          intent: 'complete_run',
          payload: {
            status: 'failed',
            summary: 'Fake contract failure.',
          },
        },
      ];
    case 'cancelled':
      return [
        {
          actor: { kind: 'manager' },
          intent: 'complete_run',
          payload: {
            status: 'cancelled',
            summary: 'Fake contract cancellation.',
          },
        },
      ];
    case 'exhausted':
      return [
        {
          actor: { kind: 'manager' },
          intent: 'complete_run',
          payload: {
            status: 'failed',
            summary: 'Fake contract exhausted turn budget.',
          },
        },
      ];
  }
}

const fakeFactory: AdapterFactory<FakeAdapterState> = ({ scenario }) => ({
  adapter: makeFakeAdapter(fakeScriptForScenario(scenario), {
    idProvider: counterIdProvider(200),
    clockProvider: fixedClockProvider(FIXED_TIME),
  }),
  stateCursor: (state) => state.index,
});

describeRuntimeAdapterContract('fake', fakeFactory);
