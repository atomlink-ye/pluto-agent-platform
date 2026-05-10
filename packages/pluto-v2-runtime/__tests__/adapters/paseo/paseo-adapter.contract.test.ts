import { counterIdProvider, fixedClockProvider, type ActorRef } from '@pluto/v2-core';

import { makePaseoAdapter, type PaseoAdapterState } from '../../../src/adapters/paseo/paseo-adapter.js';
import type { KernelView } from '../../../src/runtime/kernel-view.js';
import {
  describeRuntimeAdapterContract,
  type AdapterFactory,
  type ContractScenario,
} from '../contract/runtime-adapter-contract.js';

const FIXED_TIME = '2026-05-10T00:00:00.000Z';

function directiveBlock(kind: string, payload: Record<string, unknown>): string {
  return ['```json', JSON.stringify({ kind, payload }), '```'].join('\n');
}

function latestTaskId(view: KernelView): string {
  for (let index = view.events.length - 1; index >= 0; index -= 1) {
    const event = view.events[index];
    if (event?.kind === 'task_created' && event.outcome === 'accepted') {
      return event.payload.taskId;
    }
  }

  throw new Error('expected an accepted task_created event before change_task_state');
}

function happyPathResponse(state: PaseoAdapterState, view: KernelView): string {
  switch (state.turnIndex) {
    case 0:
      return directiveBlock('create_task', {
        title: 'Contract task',
        ownerActor: { kind: 'role', role: 'generator' },
        dependsOn: [],
      });
    case 1:
      return directiveBlock('change_task_state', {
        taskId: latestTaskId(view),
        to: 'running',
      });
    case 2:
      return directiveBlock('publish_artifact', {
        kind: 'final',
        mediaType: 'text/markdown',
        byteSize: 256,
      });
    case 3:
      return directiveBlock('append_mailbox_message', {
        fromActor: { kind: 'role', role: 'evaluator' },
        toActor: { kind: 'manager' },
        kind: 'final',
        body: 'Artifact reviewed. Ready to complete the run.',
      });
    case 4:
      return directiveBlock('change_task_state', {
        taskId: latestTaskId(view),
        to: 'completed',
      });
    case 5:
      return directiveBlock('complete_run', {
        status: 'succeeded',
        summary: 'Paseo happy path complete.',
      });
    default:
      throw new Error(`unexpected paseo happy-path turn ${state.turnIndex}`);
  }
}

function responseForScenario(
  scenario: ContractScenario,
  state: PaseoAdapterState,
  actor: ActorRef,
  view: KernelView,
): string {
  switch (scenario) {
    case 'happy_path':
      return happyPathResponse(state, view);
    case 'failed':
      return directiveBlock('complete_run', {
        status: 'failed',
        summary: 'Paseo contract failure.',
      });
    case 'cancelled':
      return directiveBlock('complete_run', {
        status: 'cancelled',
        summary: 'Paseo contract cancellation.',
      });
    case 'exhausted':
      throw new Error(`unexpected pending turn for exhausted scenario (${actor.kind})`);
  }
}

const paseoFactory: AdapterFactory<PaseoAdapterState> = ({ scenario }) => {
  const adapter = makePaseoAdapter({
    idProvider: counterIdProvider(300),
    clockProvider: fixedClockProvider(FIXED_TIME),
    ...(scenario === 'exhausted' ? { maxTurns: 0 } : {}),
  });

  return {
    adapter,
    stateCursor: (state) => state.turnIndex,
    primeForStep: (state, view) => {
      const pendingTurn = adapter.pendingPaseoTurn(state, view);
      if (pendingTurn === null) {
        return state;
      }

      return adapter.withPaseoResponse(state, {
        actor: pendingTurn.actor,
        transcriptText: responseForScenario(scenario, state, pendingTurn.actor, view),
        usage: {},
      });
    },
  };
};

describeRuntimeAdapterContract('paseo', paseoFactory);
