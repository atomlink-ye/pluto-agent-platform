import {
  SCHEMA_VERSION,
  RunKernel,
  compile as compileTeamContext,
  initialState,
  replayAll,
  type ActorRef,
  type AuthoredSpec,
  type ClockProvider,
  type IdProvider,
  type ProtocolRequest,
  type ReplayViews,
  type RunEvent,
  type TeamContext,
} from '@pluto/v2-core';
import { actorKey } from '../../../../pluto-v2-core/src/core/team-context.js';

import { assembleEvidencePacket, type EvidencePacket } from '../../evidence/evidence-packet.js';
import { kernelViewOf, RunNotCompletedError } from '../../runtime/runner.js';
import type { KernelView } from '../../runtime/kernel-view.js';
import type { RuntimeAdapter } from '../../runtime/runtime-adapter.js';

export type PaseoLabel = `${string}=${string}`;

export interface PaseoAgentSpec {
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly thinking?: string;
  readonly title: string;
  readonly initialPrompt: string;
  readonly labels?: ReadonlyArray<PaseoLabel>;
  readonly cwd?: string;
}

export interface PaseoAgentSession {
  readonly agentId: string;
}

export interface PaseoUsageEstimate {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

export interface PaseoCliClient {
  spawnAgent(spec: PaseoAgentSpec): Promise<PaseoAgentSession>;
  sendPrompt(agentId: string, prompt: string): Promise<void>;
  waitIdle(agentId: string, timeoutSec: number): Promise<{ exitCode: number }>;
  readTranscript(agentId: string, tailLines: number): Promise<string>;
  usageEstimate(agentId: string): Promise<PaseoUsageEstimate>;
  deleteAgent(agentId: string): Promise<void>;
}

export interface PaseoTurnRequest {
  readonly actor: ActorRef;
  readonly prompt: string;
}

export interface PaseoTurnResponse {
  readonly actor: ActorRef;
  readonly transcriptText: string;
  readonly usage: PaseoUsageEstimate;
}

export interface PaseoRuntimeAdapter<S> extends RuntimeAdapter<S> {
  pendingPaseoTurn(state: S, view: KernelView): PaseoTurnRequest | null;
  withPaseoResponse(state: S, response: PaseoTurnResponse): S;
}

type ProjectionViews = ReplayViews;

type InternalAcceptedRequestKeyEvent = RunEvent & {
  acceptedRequestKey?: string | null;
};

type UsageByActor = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

type UsagePerTurn = {
  turnIndex: number;
  actor: ActorRef;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  waitExitCode: number;
};

type UsageSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byActor: ReadonlyMap<string, UsageByActor>;
  perTurn: ReadonlyArray<UsagePerTurn>;
};

type TranscriptAwareState = {
  turnIndex: number;
  transcriptByActor?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
};

function isTranscriptRecord(
  value: TranscriptAwareState['transcriptByActor'],
): value is Readonly<Record<string, string>> {
  return value != null && typeof value === 'object' && !(value instanceof Map);
}

const DEFAULT_MAX_STEPS = 1000;
const DEFAULT_WAIT_TIMEOUT_SEC = 600;
const TRANSCRIPT_TAIL_LINES = 200;

function toPublicRunEvent(event: RunEvent): RunEvent {
  const { acceptedRequestKey: _acceptedRequestKey, ...publicEvent } =
    event as InternalAcceptedRequestKeyEvent;
  return publicEvent;
}

function stripAcceptedRequestKey(events: readonly RunEvent[]): RunEvent[] {
  return events.map(toPublicRunEvent);
}

function transcriptLengthBefore<S>(state: S, actor: ActorRef): number {
  const transcriptByActor = (state as TranscriptAwareState).transcriptByActor;
  const key = actorKey(actor);

  if (transcriptByActor instanceof Map) {
    return transcriptByActor.get(key)?.length ?? 0;
  }

  if (isTranscriptRecord(transcriptByActor)) {
    const transcript = transcriptByActor[key];
    return typeof transcript === 'string' ? transcript.length : 0;
  }

  return 0;
}

function turnIndexOf<S>(state: S): number {
  return (state as TranscriptAwareState).turnIndex;
}

function buildCompleteRunRequest(
  runId: string,
  completion: { status: 'succeeded' | 'failed' | 'cancelled'; summary: string | null },
  options: { idProvider: IdProvider; clockProvider: ClockProvider },
): ProtocolRequest {
  return {
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
  };
}

function createUsageAccumulator() {
  const byActor = new Map<string, UsageByActor>();
  const perTurn: UsagePerTurn[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  return {
    accumulate(entry: {
      turn: number;
      actor: ActorRef;
      waitExitCode: number;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
    }) {
      const inputTokens = entry.inputTokens ?? 0;
      const outputTokens = entry.outputTokens ?? 0;
      const costUsd = entry.costUsd ?? 0;
      const key = actorKey(entry.actor);
      const actorTotals = byActor.get(key) ?? {
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };

      actorTotals.turns += 1;
      actorTotals.inputTokens += inputTokens;
      actorTotals.outputTokens += outputTokens;
      actorTotals.costUsd += costUsd;
      byActor.set(key, actorTotals);

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalCostUsd += costUsd;
      perTurn.push({
        turnIndex: entry.turn,
        actor: entry.actor,
        inputTokens,
        outputTokens,
        costUsd,
        waitExitCode: entry.waitExitCode,
      });
    },

    finalize(): UsageSummary {
      return {
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd,
        byActor,
        perTurn,
      };
    },
  };
}

async function cleanupAgents(client: PaseoCliClient, agentIds: Iterable<string>): Promise<void> {
  for (const agentId of agentIds) {
    try {
      await client.deleteAgent(agentId);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export async function runPaseo<S>(
  authored: AuthoredSpec,
  adapter: PaseoRuntimeAdapter<S>,
  options: {
    client: PaseoCliClient;
    idProvider: IdProvider;
    clockProvider: ClockProvider;
    paseoAgentSpec: (actor: ActorRef) => PaseoAgentSpec;
    correlationId?: string | null;
    maxSteps?: number;
    waitTimeoutSec?: number;
  },
): Promise<{
  events: ReadonlyArray<RunEvent>;
  views: ProjectionViews;
  evidencePacket: EvidencePacket;
  usage: UsageSummary;
}> {
  if (!authored.declaredActors.includes('manager')) {
    throw new Error('runPaseo requires manager in declaredActors');
  }

  const teamContext: TeamContext = compileTeamContext(authored);
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
    { correlationId: options.correlationId ?? null },
  );

  let state = adapter.init(teamContext, kernelViewOf(kernel));
  const agentByActorKey = new Map<string, string>();
  const usage = createUsageAccumulator();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const waitTimeoutSec = options.waitTimeoutSec ?? DEFAULT_WAIT_TIMEOUT_SEC;
  let stepCount = 0;

  try {
    for (;;) {
      const turn = adapter.pendingPaseoTurn(state, kernelViewOf(kernel));
      if (turn !== null) {
        const key = actorKey(turn.actor);
        let agentId = agentByActorKey.get(key);
        let spawnedThisTurn = false;
        if (agentId === undefined) {
          const session = await options.client.spawnAgent({
            ...options.paseoAgentSpec(turn.actor),
            initialPrompt: turn.prompt,
          });
          agentId = session.agentId;
          agentByActorKey.set(key, agentId);
          spawnedThisTurn = true;
        }

        const lastSeenLen = transcriptLengthBefore(state, turn.actor);
        if (!spawnedThisTurn) {
          await options.client.sendPrompt(agentId, turn.prompt);
        }
        const wait = await options.client.waitIdle(agentId, waitTimeoutSec);
        const fullText = await options.client.readTranscript(agentId, TRANSCRIPT_TAIL_LINES);
        const newSlice = fullText.slice(lastSeenLen);
        const usageEstimate = await options.client.usageEstimate(agentId);

        usage.accumulate({
          turn: turnIndexOf(state),
          actor: turn.actor,
          waitExitCode: wait.exitCode,
          ...usageEstimate,
        });

        state = adapter.withPaseoResponse(state, {
          actor: turn.actor,
          transcriptText: newSlice,
          usage: usageEstimate,
        });
        continue;
      }

      if (stepCount >= maxSteps) {
        throw new RunNotCompletedError(kernel.state.runId, maxSteps);
      }
      stepCount += 1;

      const step = adapter.step(state, kernelViewOf(kernel));
      if (step.kind === 'done') {
        kernel.submit(buildCompleteRunRequest(kernel.state.runId, step.completion, options), {
          correlationId: options.correlationId ?? null,
        });
        state = step.nextState;
        break;
      }

      kernel.submit(step.request, { correlationId: options.correlationId ?? null });
      state = step.nextState;
    }
  } finally {
    await cleanupAgents(options.client, agentByActorKey.values());
  }

  const events = stripAcceptedRequestKey(kernel.eventLog.read(0, kernel.eventLog.head + 1));
  const views = replayAll(events);
  const evidencePacket = assembleEvidencePacket(views, events, kernel.state.runId);

  return {
    events,
    views,
    evidencePacket,
    usage: usage.finalize(),
  };
}
