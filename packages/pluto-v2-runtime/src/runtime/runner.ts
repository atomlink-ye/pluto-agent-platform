import {
  type AuthoredSpec,
  type TeamContext,
} from '@pluto/v2-core/core/team-context';
import type { ClockProvider, IdProvider } from '@pluto/v2-core/core/providers';
import { RunKernel } from '@pluto/v2-core/core/run-kernel';
import { initialState } from '@pluto/v2-core/core/run-state';
import { compile as compileTeamContext } from '@pluto/v2-core/core/spec-compiler';
import type { EvidenceProjectionView, MailboxProjectionView, TaskProjectionView } from '@pluto/v2-core/projections';
import { replayAll } from '@pluto/v2-core/projections/replay';
import type { ProtocolRequest } from '@pluto/v2-core/protocol-request';
import type { RunEvent } from '@pluto/v2-core/run-event';
import { SCHEMA_VERSION } from '@pluto/v2-core/versioning';

import { assembleEvidencePacket, type EvidencePacket } from '../evidence/evidence-packet.js';

import type { KernelView } from './kernel-view.js';
import type { RuntimeAdapter } from './runtime-adapter.js';

export interface RunScenarioOptions {
  idProvider: IdProvider;
  clockProvider: ClockProvider;
  correlationId?: string | null;
  maxSteps?: number;
}

export interface RunScenarioResult {
  teamContext: TeamContext;
  events: ReadonlyArray<RunEvent>;
  views: {
    task: TaskProjectionView['view'];
    mailbox: MailboxProjectionView['view'];
    evidence: EvidenceProjectionView['view'];
  };
  evidencePacket: EvidencePacket;
}

export class RunNotCompletedError extends Error {
  readonly runId: string;
  readonly maxSteps: number;

  constructor(runId: string, maxSteps: number) {
    super(`Run ${runId} did not complete within ${maxSteps} steps`);
    this.name = 'RunNotCompletedError';
    this.runId = runId;
    this.maxSteps = maxSteps;
  }
}

const DEFAULT_MAX_STEPS = 1000;

type InternalAcceptedRequestKeyEvent = RunEvent & {
  acceptedRequestKey?: string | null;
};

export const kernelViewOf = (kernel: RunKernel): KernelView => ({
  state: kernel.state,
  events: kernel.eventLog.read(0, kernel.eventLog.head + 1),
});

const toPublicRunEvent = (event: RunEvent): RunEvent => {
  const { acceptedRequestKey: _acceptedRequestKey, ...publicEvent } =
    event as InternalAcceptedRequestKeyEvent;
  return publicEvent;
};

const buildCompleteRunRequest = (
  runId: string,
  completion: { status: 'succeeded' | 'failed' | 'cancelled'; summary: string | null },
  options: RunScenarioOptions,
): ProtocolRequest => ({
  requestId: options.idProvider.next(),
  runId,
  actor: { kind: 'manager' },
  intent: 'complete_run',
  payload: {
    status: completion.status,
    summary: completion.summary,
  },
  idempotencyKey: null,
  clientTimestamp: options.clockProvider.nowIso(),
  schemaVersion: SCHEMA_VERSION,
});

export const runScenario = <TState>(
  authored: AuthoredSpec,
  adapter: RuntimeAdapter<TState>,
  options: RunScenarioOptions,
): RunScenarioResult => {
  if (!authored.declaredActors.includes('manager')) {
    throw new Error('runScenario requires manager in declaredActors');
  }

  const teamContext = compileTeamContext(authored);
  const kernel = new RunKernel({
    initialState: initialState(teamContext),
    idProvider: options.idProvider,
    clockProvider: options.clockProvider,
  });

  kernel.seedRunStarted(
    {
      scenarioRef: teamContext.scenarioRef,
      runProfileRef: teamContext.runProfileRef,
      startedAt: options.clockProvider.nowIso(),
    },
    { correlationId: options.correlationId },
  );

  let adapterState = adapter.init(teamContext, kernelViewOf(kernel));
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  let completed = false;

  for (let stepCount = 0; stepCount < maxSteps; stepCount += 1) {
    const step = adapter.step(adapterState, kernelViewOf(kernel));
    adapterState = step.nextState;

    if (step.kind === 'done') {
      kernel.submit(buildCompleteRunRequest(kernel.state.runId, step.completion, options), {
        correlationId: options.correlationId,
      });
      completed = true;
      break;
    }

    kernel.submit(step.request, { correlationId: options.correlationId });
  }

  if (!completed) {
    throw new RunNotCompletedError(kernel.state.runId, maxSteps);
  }

  const events = kernel.eventLog.read(0, kernel.eventLog.head + 1).map(toPublicRunEvent);
  const views = replayAll(events);

  return {
    teamContext,
    events,
    views,
    evidencePacket: assembleEvidencePacket(views, events, kernel.state.runId),
  };
};
