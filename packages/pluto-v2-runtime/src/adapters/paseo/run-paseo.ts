import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  type RunState,
  type TeamContext,
} from '@pluto/v2-core';
import { actorKey } from '../../../../pluto-v2-core/src/core/team-context.js';

import { startPlutoLocalApi } from '../../api/pluto-local-api.js';
import { makeWaitRegistry, type WaitTraceEvent } from '../../api/wait-registry.js';
import { assembleEvidencePacket, type EvidencePacket } from '../../evidence/evidence-packet.js';
import type { UsageStatus } from '../../evidence/usage-summary-builder.js';
import type { LoadedAuthoredSpec } from '../../loader/authored-spec-loader.js';
import { startPlutoMcpServer, type PlutoToolHandlers } from '../../mcp/pluto-mcp-server.js';
import { makeTurnLeaseStore } from '../../mcp/turn-lease.js';
import { kernelViewOf, RunNotCompletedError } from '../../runtime/runner.js';
import type { KernelView } from '../../runtime/kernel-view.js';
import type { RuntimeAdapter } from '../../runtime/runtime-adapter.js';
import { makePlutoToolHandlers, type PlutoToolResult } from '../../tools/pluto-tool-handlers.js';
import { PLUTO_TOOL_NAMES, type PlutoToolName } from '../../tools/pluto-tool-schemas.js';
import type { AgenticMutation } from './agentic-mutation.js';
import { materializeActorBridge, resolveActorBridgeDependencyPaths } from './actor-bridge.js';
import { buildAgenticToolPrompt, buildWakeupPrompt } from './agentic-tool-prompt-builder.js';
import { createInitialAgenticLoopState } from './agentic-loop-state.js';
import { leadActorFromSpec, pickNextAgenticActor, withKernelRejection } from './agentic-scheduler.js';
import { runBridgeSelfCheck, type BridgeSelfCheckFailureReason } from './bridge-self-check.js';
import { buildPromptView } from './prompt-view.js';
import { planDelegatedTaskCloseout, type DelegatedTaskCloseoutPlan } from './task-closeout.js';
import { computeWakeupDelta } from './wakeup-delta.js';

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
  readonly env?: Readonly<Record<string, string>>;
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
  usageStatus: UsageStatus;
  reportedBy: 'paseo.usageEstimate';
  estimated: boolean;
  byActor: ReadonlyMap<string, UsageByActor>;
  perTurn: ReadonlyArray<UsagePerTurn>;
};

type AgenticToolUsageSummary = UsageSummary & {
  initiatingActor: ActorRef | null;
  runtimeTraces: ReadonlyArray<RuntimeTraceEvent>;
};

type RuntimeAuthoredInput = AuthoredSpec | LoadedAuthoredSpec;

type AgenticToolLoopState = ReturnType<typeof createInitialAgenticLoopState>;

type ObservedMutatingToolCall = {
  actor: ActorRef;
  toolName: PlutoToolName;
  rawArgs: unknown;
  result: PlutoToolResult;
  event: RunEvent | null;
  plannedDelegatedTaskCloseout: DelegatedTaskCloseoutPlan | null;
  deferredWaitNotifyEvent: RunEvent | null;
};

export type TaskCloseoutRejectedTraceEvent = {
  readonly kind: 'task_closeout_rejected';
  readonly actor: string;
  readonly taskId: string;
  readonly reason: string;
};

export type BridgeUnavailableTraceEvent = {
  readonly kind: 'bridge_unavailable';
  readonly actor: string;
  readonly attemptedAt: string;
  readonly reason: BridgeSelfCheckFailureReason;
  readonly stderr?: string;
  readonly latencyMs: number;
};

export type RuntimeTraceEvent = WaitTraceEvent | TaskCloseoutRejectedTraceEvent | BridgeUnavailableTraceEvent;

class PaseoRuntimeError extends Error {
  readonly runtimeTraces: ReadonlyArray<RuntimeTraceEvent>;

  constructor(message: string, runtimeTraces: ReadonlyArray<RuntimeTraceEvent>) {
    super(message);
    this.name = 'PaseoRuntimeError';
    this.runtimeTraces = runtimeTraces;
  }
}

type AgentInjection = {
  cwd: string;
  wrapperPath: string;
  handoffJsonPath: string;
};

type AgentSessionState = {
  agentId: string;
  idlePromise: Promise<AgentIdleOutcome> | null;
};

type AgentIdleOutcome = {
  exitCode: number;
  failure: string | null;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

export interface PaseoAgentEnvHandoff {
  readonly apiUrl: string;
  readonly bearerToken: string;
  readonly actorKey: string;
}

const MUTATING_TOOL_NAMES = [
  'pluto_create_task',
  'pluto_change_task_state',
  'pluto_append_mailbox_message',
  'pluto_publish_artifact',
  'pluto_complete_run',
] as const satisfies readonly PlutoToolName[];

const MUTATING_TOOL_NAME_SET = new Set<PlutoToolName>(MUTATING_TOOL_NAMES);

const TOOL_NAME_TO_DIRECTIVE_KIND = {
  pluto_create_task: 'create_task',
  pluto_change_task_state: 'change_task_state',
  pluto_append_mailbox_message: 'append_mailbox_message',
  pluto_publish_artifact: 'publish_artifact',
  pluto_complete_run: 'complete_run',
} as const satisfies Record<(typeof MUTATING_TOOL_NAMES)[number], AgenticMutation['kind']>;

type TranscriptAwareState = {
  turnIndex: number;
  transcriptByActor?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  transcriptCursorByActor?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
};

function isTranscriptRecord(
  value: TranscriptAwareState['transcriptByActor'],
): value is Readonly<Record<string, string>> {
  return value != null && typeof value === 'object' && !(value instanceof Map);
}

function isTranscriptCursorRecord(
  value: TranscriptAwareState['transcriptCursorByActor'],
): value is Readonly<Record<string, number>> {
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
  const transcriptCursorByActor = (state as TranscriptAwareState).transcriptCursorByActor;
  const transcriptByActor = (state as TranscriptAwareState).transcriptByActor;
  const key = actorKey(actor);

  if (transcriptCursorByActor instanceof Map) {
    return transcriptCursorByActor.get(key) ?? 0;
  }

  if (isTranscriptCursorRecord(transcriptCursorByActor)) {
    const cursor = transcriptCursorByActor[key];
    if (typeof cursor === 'number') {
      return cursor;
    }
  }

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

function buildChangeTaskStateRequest(
  runId: string,
  actor: ActorRef,
  payload: { taskId: string; to: 'completed' },
  options: { idProvider: IdProvider; clockProvider: ClockProvider },
): Extract<ProtocolRequest, { intent: 'change_task_state' }> {
  return {
    requestId: options.idProvider.next(),
    runId,
    actor,
    intent: 'change_task_state',
    payload,
    idempotencyKey: null,
    clientTimestamp: options.clockProvider.nowIso(),
    schemaVersion: SCHEMA_VERSION,
  };
}

function latestRunEvent(events: readonly RunEvent[]): RunEvent {
  const event = events.at(-1);
  if (event == null) {
    throw new Error('agentic_tool loop requires at least one run event');
  }

  return event;
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
      const usageStatus: UsageStatus = perTurn.some((entry) =>
        entry.inputTokens > 0 || entry.outputTokens > 0 || entry.costUsd > 0,
      )
        ? 'reported'
        : 'unavailable';

      return {
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd,
        usageStatus,
        reportedBy: 'paseo.usageEstimate',
        estimated: usageStatus === 'reported',
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

function runtimeModeOf(authored: RuntimeAuthoredInput): string | undefined {
  return authored.orchestration?.mode;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function isAgenticToolMode(authored: RuntimeAuthoredInput): authored is LoadedAuthoredSpec {
  return runtimeModeOf(authored) === 'agentic_tool';
}

function toCoreAuthoredSpec(authored: RuntimeAuthoredInput): AuthoredSpec {
  const { playbook: _playbook, ...rest } = authored as LoadedAuthoredSpec & { playbook?: LoadedAuthoredSpec['playbook'] };
  const orchestration = authored.orchestration;

  return {
    ...(rest as Omit<AuthoredSpec, 'orchestration'>),
    ...(orchestration == null
      ? {}
      : {
          orchestration: {
            ...orchestration,
            ...(orchestration.mode === 'agentic_tool'
              ? { mode: 'agentic' as const }
              : {}),
          },
        }),
  } as AuthoredSpec;
}

function isLoadedAuthoredSpec(authored: RuntimeAuthoredInput): authored is LoadedAuthoredSpec {
  return 'playbook' in authored;
}

function ensureLoadedAuthoredSpec(authored: RuntimeAuthoredInput, mode: string): LoadedAuthoredSpec {
  if (!isLoadedAuthoredSpec(authored)) {
    throw new Error(`runPaseo ${mode} mode requires a loaded authored spec`);
  }

  return authored;
}

function buildToolAttemptDirective(toolName: (typeof MUTATING_TOOL_NAMES)[number], rawArgs: unknown): AgenticMutation {
  const payload = rawArgs != null && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs as Record<string, unknown>
    : {};

  return {
    kind: TOOL_NAME_TO_DIRECTIVE_KIND[toolName],
    payload,
  } as AgenticMutation;
}

function buildDiagnosticDirective(actor: ActorRef, body: string): AgenticMutation {
  return {
    kind: 'append_mailbox_message',
    payload: {
      fromActor: { kind: 'manager' },
      toActor: actor,
      kind: 'final',
      body,
    },
  } as AgenticMutation;
}

function planObservedDelegatedTaskCloseout(args: {
  actor: ActorRef;
  toolName: (typeof MUTATING_TOOL_NAMES)[number];
  rawArgs: unknown;
  acceptedEvent: RunEvent;
  leadActor: ActorRef;
  delegationPointer: ActorRef | null;
  delegationTaskId: string | null;
  runState: RunState;
}): DelegatedTaskCloseoutPlan | null {
  return planDelegatedTaskCloseout({
    actor: args.actor,
    acceptedEvent: args.acceptedEvent,
    directive: buildToolAttemptDirective(args.toolName, args.rawArgs),
    leadActor: args.leadActor,
    delegationPointer: args.delegationPointer,
    delegationTaskId: args.delegationTaskId,
    runState: args.runState,
  });
}

function toolErrorMessage(result: Extract<PlutoToolResult, { ok: false }>): string {
  return `${result.error.code}: ${result.error.message}`;
}

function lastEventSince(kernel: RunKernel, beforeEventCount: number): RunEvent | null {
  const events = kernel.eventLog.read();
  return events.length > beforeEventCount ? events.at(-1) ?? null : null;
}

function makeObservedPlutoHandlers(args: {
  baseHandlers: PlutoToolHandlers;
  kernel: RunKernel;
  onObserved: (call: ObservedMutatingToolCall) => void;
}): PlutoToolHandlers {
  const wrap = (toolName: (typeof MUTATING_TOOL_NAMES)[number]) => {
    return async (session: Parameters<PlutoToolHandlers[typeof toolName]>[0], rawArgs: unknown) => {
      const beforeEventCount = args.kernel.eventLog.read().length;
      const result = await args.baseHandlers[toolName](session, rawArgs);
      args.onObserved({
        actor: session.currentActor,
        toolName,
        rawArgs,
        result,
        event: lastEventSince(args.kernel, beforeEventCount),
        plannedDelegatedTaskCloseout: null,
        deferredWaitNotifyEvent: null,
      });
      return result;
    };
  };

  return {
    ...args.baseHandlers,
    pluto_create_task: wrap('pluto_create_task'),
    pluto_change_task_state: wrap('pluto_change_task_state'),
    pluto_append_mailbox_message: wrap('pluto_append_mailbox_message'),
    pluto_publish_artifact: wrap('pluto_publish_artifact'),
    pluto_complete_run: wrap('pluto_complete_run'),
  };
}

async function prepareAgentInjection(args: {
  runId: string;
  actor: ActorRef;
  workspaceCwd: string;
  handoff: PaseoAgentEnvHandoff;
}): Promise<AgentInjection> {
  const actorDir = join(args.workspaceCwd, '.pluto', 'runs', args.runId, 'agents', actorKey(args.actor));
  await mkdir(actorDir, { recursive: true });
  const bridgePaths = await resolveActorBridgeDependencyPaths();
  const bridge = await materializeActorBridge({
    actorCwd: actorDir,
    apiUrl: args.handoff.apiUrl,
    bearerToken: args.handoff.bearerToken,
    actorKey: args.handoff.actorKey,
    plutoToolSourcePath: bridgePaths.plutoToolSourcePath,
    tsxBinPath: bridgePaths.tsxBinPath,
  });
  return {
    cwd: actorDir,
    wrapperPath: bridge.wrapperPath,
    handoffJsonPath: bridge.handoffJsonPath,
  };
}

async function withSyntheticSelfCheckState<T>(args: {
  cwd: string;
  promptView: ReturnType<typeof buildPromptView>;
  run: () => Promise<T>;
}): Promise<T> {
  const selfCheckStatePath = join(args.cwd, '.pluto', 'self-check-state.json');
  await writeFile(selfCheckStatePath, JSON.stringify(args.promptView));

  try {
    return await args.run();
  } finally {
    await rm(selfCheckStatePath, { force: true });
  }
}

async function runAgenticToolLoop(
  authored: LoadedAuthoredSpec,
  kernel: RunKernel,
  options: {
    client: PaseoCliClient;
    idProvider: IdProvider;
    clockProvider: ClockProvider;
    paseoAgentSpec: (actor: ActorRef, handoff?: PaseoAgentEnvHandoff) => PaseoAgentSpec;
    bridgeSelfCheck?: typeof runBridgeSelfCheck;
    waitTimeoutSec: number;
    workspaceCwd?: string;
  },
): Promise<AgenticToolUsageSummary> {
  const leadActor = leadActorFromSpec(authored);
  const stateSeed = createInitialAgenticLoopState({ spec: authored });
  let state: AgenticToolLoopState = {
    ...stateSeed,
    currentActor: leadActor,
    awaitingResponseFor: leadActor,
  };
  const agentSessionByActorKey = new Map<string, AgentSessionState>();
  const deliveryCursorByActorKey = new Map<string, number>();
  const waitCursorByActorKey = new Map<string, number>();
  const transcriptByActor = new Map<string, string>();
  const runtimeTraceBuffer: RuntimeTraceEvent[] = [];
  const agentInjectionByActorKey = new Map<string, AgentInjection>();
  const pendingMutationByActorKey = new Map<string, Deferred<ObservedMutatingToolCall>>();
  const pendingArmByActorKey = new Map<string, Deferred<void>>();
  const usage = createUsageAccumulator();
  let initiatingActor: ActorRef | null = null;
  const leaseStore = makeTurnLeaseStore(leadActor);
  const bearerToken = randomUUID();
  const workspaceCwd = options.workspaceCwd ?? process.cwd();
  const bridgeSelfCheck = options.bridgeSelfCheck ?? runBridgeSelfCheck;
  const runRootDir = join(workspaceCwd, '.pluto', 'runs', kernel.state.runId);

  const promptViewForActor = (actor: ActorRef) => buildPromptView({
    spec: authored,
    events: kernel.eventLog.read(0, kernel.eventLog.head + 1),
    forActor: actor,
    budgets: {
      turnIndex: state.turnIndex,
      maxTurns: state.maxTurns,
      parseFailuresThisTurn: 0,
      maxParseFailuresPerTurn: 0,
      kernelRejections: state.kernelRejections,
      maxKernelRejections: state.maxKernelRejections,
      noProgressTurns: state.noProgressTurns,
      maxNoProgressTurns: state.maxNoProgressTurns,
    },
    activeDelegation: state.delegationPointer,
    lastRejection: state.lastRejection,
  });

  const pushRuntimeTrace = (event: RuntimeTraceEvent) => {
    runtimeTraceBuffer.push(event);
    if (runtimeTraceBuffer.length > 128) {
      runtimeTraceBuffer.shift();
    }

    if (event.kind === 'wait_armed') {
      pendingArmByActorKey.get(event.actor)?.resolve();
    }
  };

  const waitRegistry = makeWaitRegistry({
    events: () => kernel.eventLog.read(0, kernel.eventLog.head + 1),
    getPromptViewForActor: promptViewForActor,
    onTrace: pushRuntimeTrace,
  });
  const waitShutdownController = new AbortController();

  const rememberDeliveredEvent = (actor: ActorRef, sequence: number) => {
    const key = actorKey(actor);
    deliveryCursorByActorKey.set(key, sequence);
    waitCursorByActorKey.set(key, sequence);
  };

  const rememberActorMutationEvent = (actor: ActorRef, sequence: number) => {
    waitCursorByActorKey.set(actorKey(actor), sequence);
  };

  const readAgentSnapshot = async (key: string, agentId: string) => {
    const fullTranscript = await options.client.readTranscript(agentId, TRANSCRIPT_TAIL_LINES).catch(() => transcriptByActor.get(key) ?? '');
    transcriptByActor.set(key, fullTranscript);
    const usageEstimate = await options.client.usageEstimate(agentId).catch(() => ({}));
    return { usageEstimate };
  };

  const startIdleWatcher = (key: string, session: AgentSessionState): Promise<AgentIdleOutcome> => {
    const idlePromise = options.client.waitIdle(session.agentId, options.waitTimeoutSec)
      .then((wait) => ({
        exitCode: wait.exitCode,
        failure: null,
      }))
      .catch((error) => ({
        exitCode: 1,
        failure: error instanceof Error ? error.message : String(error),
      }));
    session.idlePromise = idlePromise;
    void idlePromise.finally(() => {
      const current = agentSessionByActorKey.get(key);
      if (current?.idlePromise === idlePromise) {
        current.idlePromise = null;
      }
    });
    return idlePromise;
  };

  const handlers = makeObservedPlutoHandlers({
    baseHandlers: makePlutoToolHandlers({
      kernel,
      runId: kernel.state.runId,
      schemaVersion: SCHEMA_VERSION,
      clock: () => new Date(options.clockProvider.nowIso()),
      idProvider: () => options.idProvider.next(),
      artifactSidecar: {
        async write(artifactId, body) {
          const artifactDir = join(runRootDir, 'artifacts');
          await mkdir(artifactDir, { recursive: true });
          const path = join(artifactDir, `${artifactId}.txt`);
          await writeFile(path, typeof body === 'string' ? body : Buffer.from(body));
          return path;
        },
        async read(artifactId) {
          const path = join(runRootDir, 'artifacts', `${artifactId}.txt`);
          return {
            path,
            body: await readFile(path, 'utf8'),
          };
        },
      },
      transcriptSidecar: {
        async read(actorKeyValue) {
          return transcriptByActor.get(actorKeyValue) ?? '';
        },
      },
      promptViewer: {
        forActor(actor) {
          return promptViewForActor(actor);
        },
      },
    }),
    kernel,
    onObserved(call) {
      const plannedDelegatedTaskCloseout = call.event != null && call.event.kind !== 'request_rejected'
        ? planObservedDelegatedTaskCloseout({
          actor: call.actor,
          toolName: call.toolName as (typeof MUTATING_TOOL_NAMES)[number],
          rawArgs: call.rawArgs,
          acceptedEvent: call.event,
          leadActor,
          delegationPointer: state.delegationPointer,
          delegationTaskId: state.delegationTaskId,
          runState: kernel.state,
        })
        : null;
      call.plannedDelegatedTaskCloseout = plannedDelegatedTaskCloseout;
      call.deferredWaitNotifyEvent = plannedDelegatedTaskCloseout == null ? null : call.event;

      if (!MUTATING_TOOL_NAME_SET.has(call.toolName)) {
        return;
      }

      if (leaseStore.matches(call.actor)) {
        pendingMutationByActorKey.get(actorKey(call.actor))?.resolve(call);
      }

      if (call.event != null && call.event.kind !== 'request_rejected') {
        rememberActorMutationEvent(call.actor, call.event.sequence);
        if (plannedDelegatedTaskCloseout == null) {
          waitRegistry.notify(call.event, promptViewForActor);
        }
      }
    },
  });

  const server = await startPlutoMcpServer({
    bearerToken,
    handlers,
    leaseStore,
    waitService: {
      registry: waitRegistry,
      cursorForActor(actor) {
        const key = actorKey(actor);
        return waitCursorByActorKey.get(key) ?? deliveryCursorByActorKey.get(key) ?? -1;
      },
      onEventDelivered: rememberDeliveredEvent,
      shutdownSignal: waitShutdownController.signal,
      shutdownReason: 'run_shutdown',
    },
  });
  const localApi = await startPlutoLocalApi({
    bearerToken,
    handlers,
    leaseStore,
    waitService: {
      registry: waitRegistry,
      cursorForActor(actor) {
        const key = actorKey(actor);
        return waitCursorByActorKey.get(key) ?? deliveryCursorByActorKey.get(key) ?? -1;
      },
      onEventDelivered: rememberDeliveredEvent,
      shutdownSignal: waitShutdownController.signal,
      shutdownReason: 'run_shutdown',
    },
  });

  try {
    for (const actorName of authored.declaredActors) {
      const actor = authored.actors[actorName] as ActorRef;
      if (actor.kind === 'manager') {
        continue;
      }

      const key = actorKey(actor);
      const handoff = {
        apiUrl: localApi.url,
        bearerToken,
        actorKey: key,
      };
      const injection = await prepareAgentInjection({
        runId: kernel.state.runId,
        actor,
        workspaceCwd,
        handoff,
      });
      agentInjectionByActorKey.set(key, injection);
      const selfCheck = await withSyntheticSelfCheckState({
        cwd: injection.cwd,
        promptView: promptViewForActor(actor),
        run: () => bridgeSelfCheck({ wrapperPath: injection.wrapperPath }),
      });
      if (!selfCheck.ok) {
        pushRuntimeTrace({
          kind: 'bridge_unavailable',
          actor: key,
          attemptedAt: options.clockProvider.nowIso(),
          reason: selfCheck.reason ?? 'other',
          ...(selfCheck.stderr == null ? {} : { stderr: selfCheck.stderr }),
          latencyMs: selfCheck.latencyMs,
        });
        initiatingActor = { kind: 'manager' };
        kernel.submit(
          buildCompleteRunRequest(
            kernel.state.runId,
            {
              status: 'failed',
              summary: `bridge_unavailable: ${selfCheck.reason ?? 'other'}`,
            },
            options,
          ),
        );
        return {
          ...usage.finalize(),
          initiatingActor,
          runtimeTraces: runtimeTraceBuffer,
        } satisfies AgenticToolUsageSummary;
      }
    }

    for (;;) {
      const budgetFailure = state.turnIndex >= state.maxTurns
        ? { status: 'failed' as const, summary: 'maxTurns exhausted' }
        : state.noProgressTurns > state.maxNoProgressTurns
          ? { status: 'failed' as const, summary: 'maxNoProgressTurns exhausted' }
          : state.kernelRejections > state.maxKernelRejections
            ? { status: 'failed' as const, summary: 'maxKernelRejections exhausted' }
            : null;
      if (budgetFailure != null) {
        initiatingActor = { kind: 'manager' };
        kernel.submit(buildCompleteRunRequest(kernel.state.runId, budgetFailure, options));
        break;
      }

      const actor = state.currentActor ?? leadActor;
      const key = actorKey(actor);
      const events = kernel.eventLog.read(0, kernel.eventLog.head + 1);
      const promptView = promptViewForActor(actor);
      const latestEvent = latestRunEvent(events);
      const handoff = {
        apiUrl: localApi.url,
        bearerToken,
        actorKey: key,
      };
      const baseAgentSpec = options.paseoAgentSpec(actor, handoff);

      const actorSpec: PaseoAgentSpec = {
        ...baseAgentSpec,
        env: {
          ...(baseAgentSpec.env ?? {}),
          PLUTO_RUN_API_URL: handoff.apiUrl,
          PLUTO_RUN_TOKEN: handoff.bearerToken,
          PLUTO_RUN_ACTOR: handoff.actorKey,
        },
      };

      leaseStore.setCurrent(actor);
      const mutationDeferred = createDeferred<ObservedMutatingToolCall>();
      const armDeferred = createDeferred<void>();
      pendingMutationByActorKey.set(key, mutationDeferred);
      pendingArmByActorKey.set(key, armDeferred);

      let session = agentSessionByActorKey.get(key);
      const sessionBusy = session?.idlePromise != null;
      if (session == null) {
        const injection = agentInjectionByActorKey.get(key);
        if (injection == null) {
          throw new Error(`missing prepared bridge injection for ${key}`);
        }
        const prompt = buildAgenticToolPrompt({
          actor,
          role: actor.kind === 'role' ? actor.role : null,
          promptView,
          playbook: authored.playbook,
          userTask: authored.userTask ?? null,
          toolNames: PLUTO_TOOL_NAMES,
          wrapperPath: injection.wrapperPath,
        });

        const spawnedSession = await options.client.spawnAgent({
          ...actorSpec,
          initialPrompt: prompt,
          ...(injection.cwd == null ? {} : { cwd: injection.cwd }),
        });
        rememberDeliveredEvent(actor, latestEvent.sequence);
        const sessionState: AgentSessionState = {
          agentId: spawnedSession.agentId,
          idlePromise: null,
        };
        agentSessionByActorKey.set(key, sessionState);
        startIdleWatcher(key, sessionState);
        session = sessionState;
      } else {
        if (!sessionBusy) {
          if (session.idlePromise != null) {
            await session.idlePromise;
          }

          const prompt = buildWakeupPrompt({
            actor,
            latestEvent,
            delta: computeWakeupDelta({
              events,
              fromSequence: deliveryCursorByActorKey.get(key) ?? (() => {
                throw new Error(`missing wakeup cursor for existing actor ${key}`);
              })(),
              forActor: actor,
              currentPromptView: promptView,
            }),
          });
          await options.client.sendPrompt(session.agentId, prompt);
          rememberDeliveredEvent(actor, latestEvent.sequence);
          startIdleWatcher(key, session);
        }
      }

      if (session == null || session.idlePromise == null) {
        throw new Error(`missing active session for ${key}`);
      }

      const idlePromise = session.idlePromise;

      let waitExitCode = 0;
      let waitFailure: string | null = null;
      let observed: ObservedMutatingToolCall | null = null;
      const turnOutcome = await Promise.race([
        mutationDeferred.promise.then((call) => ({ kind: 'mutation' as const, call })),
        idlePromise.then((idle) => ({ kind: 'idle' as const, idle })),
      ]);
      pendingMutationByActorKey.delete(key);

      if (turnOutcome.kind === 'idle') {
        waitExitCode = turnOutcome.idle.exitCode;
        waitFailure = turnOutcome.idle.failure;
      } else {
        observed = turnOutcome.call;
        const parkedOrIdle = await Promise.race([
          idlePromise.then((idle) => ({ kind: 'idle' as const, idle })),
          armDeferred.promise.then(() => ({ kind: 'armed' as const })),
        ]);
        if (parkedOrIdle.kind === 'idle') {
          waitExitCode = parkedOrIdle.idle.exitCode;
          waitFailure = parkedOrIdle.idle.failure;
        }
      }
      pendingArmByActorKey.delete(key);

      const snapshot = await readAgentSnapshot(key, session.agentId);

      usage.accumulate({
        turn: state.turnIndex,
        actor,
        waitExitCode,
        ...snapshot.usageEstimate,
      });

      if (waitFailure != null || waitExitCode !== 0) {
        const errorMessage = waitFailure ?? `paseo wait exited with code ${waitExitCode}`;
        const rejectionState = withKernelRejection(
          {
            ...state,
            currentActor: actor,
          },
          {
            directive: buildDiagnosticDirective(actor, errorMessage),
            error: errorMessage,
          },
          leadActor,
        );
        state = {
          ...state,
          ...rejectionState,
          turnIndex: state.turnIndex + 1,
        };
        continue;
      }

      if (observed == null) {
        state = {
          ...state,
          currentActor: actor,
          awaitingResponseFor: actor,
          lastRejection: null,
          noProgressTurns: state.noProgressTurns + 1,
          turnIndex: state.turnIndex + 1,
        };
        continue;
      }
      const attemptedDirective = buildToolAttemptDirective(observed.toolName as (typeof MUTATING_TOOL_NAMES)[number], observed.rawArgs);
      if (!observed.result.ok) {
        const rejectionState = withKernelRejection(
          {
            ...state,
            currentActor: actor,
          },
          {
            directive: attemptedDirective,
            error: toolErrorMessage(observed.result),
          },
          leadActor,
        );
        state = {
          ...state,
          ...rejectionState,
          turnIndex: state.turnIndex + 1,
        };
        continue;
      }

      if (observed.event?.kind === 'request_rejected') {
        const rejectionState = withKernelRejection(
          {
            ...state,
            currentActor: actor,
          },
          {
            directive: attemptedDirective,
            error: observed.event.payload.detail,
          },
          leadActor,
        );
        state = {
          ...state,
          ...rejectionState,
          turnIndex: state.turnIndex + 1,
        };
        continue;
      }

      if (observed.event == null) {
        const rejectionState = withKernelRejection(
          {
            ...state,
            currentActor: actor,
          },
          {
            directive: attemptedDirective,
            error: `No kernel event recorded for ${observed.toolName}`,
          },
          leadActor,
        );
        state = {
          ...state,
          ...rejectionState,
          turnIndex: state.turnIndex + 1,
        };
        continue;
      }

      const next = pickNextAgenticActor({
        state: {
          currentActor: actor,
          delegationPointer: state.delegationPointer,
          delegationTaskId: state.delegationTaskId,
        },
        acceptedEvent: observed.event,
        directive: attemptedDirective,
        leadActor,
      });
      if (waitRegistry.hasArmedWait(next.actor)) {
        leaseStore.setCurrent(next.actor);
      }

      const synthesizedCloseout = observed.plannedDelegatedTaskCloseout
        ?? planObservedDelegatedTaskCloseout({
          actor,
          toolName: observed.toolName as (typeof MUTATING_TOOL_NAMES)[number],
          rawArgs: observed.rawArgs,
          acceptedEvent: observed.event,
          leadActor,
          delegationPointer: state.delegationPointer,
          delegationTaskId: state.delegationTaskId,
          runState: kernel.state,
        });
      if (synthesizedCloseout != null) {
        const synthesizedEvent = kernel.submit(
          buildChangeTaskStateRequest(
            kernel.state.runId,
            synthesizedCloseout.actor,
            { taskId: synthesizedCloseout.taskId, to: 'completed' },
            options,
          ),
        ).event;

        if (synthesizedEvent.kind === 'request_rejected') {
          pushRuntimeTrace({
            kind: 'task_closeout_rejected',
            actor: actorKey(synthesizedCloseout.actor),
            taskId: synthesizedCloseout.taskId,
            reason: synthesizedEvent.payload.detail,
          });
          if (observed.deferredWaitNotifyEvent != null) {
            waitRegistry.notify(observed.deferredWaitNotifyEvent, promptViewForActor);
          }
          throw new PaseoRuntimeError(
            `Driver-synthesized task close-out rejected for ${actorKey(synthesizedCloseout.actor)} task ${synthesizedCloseout.taskId}: ${synthesizedEvent.payload.detail}`,
            runtimeTraceBuffer,
          );
        }

        rememberActorMutationEvent(synthesizedCloseout.actor, synthesizedEvent.sequence);
        waitRegistry.notify(synthesizedEvent, promptViewForActor);
      } else if (observed.deferredWaitNotifyEvent != null) {
        waitRegistry.notify(observed.deferredWaitNotifyEvent, promptViewForActor);
      }

      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      if (observed.toolName === 'pluto_complete_run' && observed.event.kind === 'run_completed') {
        initiatingActor = observed.actor;
        break;
      }
      state = {
        ...state,
        currentActor: next.actor,
        awaitingResponseFor: next.actor,
        delegationPointer: next.delegationPointer,
        delegationTaskId: next.delegationTaskId,
        lastRejection: null,
        noProgressTurns: next.progressed ? 0 : state.noProgressTurns + 1,
        turnIndex: state.turnIndex + 1,
      };
    }
  } finally {
    waitShutdownController.abort('run_shutdown');
    waitRegistry.cancelAll('run_shutdown');
    leaseStore.setCurrent(null);
    await localApi.shutdown();
    await server.shutdown();
    await cleanupAgents(options.client, Array.from(agentSessionByActorKey.values(), (session) => session.agentId));
  }

  return {
    ...usage.finalize(),
    initiatingActor,
    runtimeTraces: runtimeTraceBuffer,
  } satisfies AgenticToolUsageSummary;
}

export async function runPaseo<S>(
  authored: RuntimeAuthoredInput,
  adapter: PaseoRuntimeAdapter<S>,
  options: {
    client: PaseoCliClient;
    idProvider: IdProvider;
    clockProvider: ClockProvider;
    paseoAgentSpec: (actor: ActorRef, handoff?: PaseoAgentEnvHandoff) => PaseoAgentSpec;
    bridgeSelfCheck?: typeof runBridgeSelfCheck;
    correlationId?: string | null;
    maxSteps?: number;
    waitTimeoutSec?: number;
    workspaceCwd?: string;
  },
): Promise<{
  events: ReadonlyArray<RunEvent>;
  views: ProjectionViews;
  evidencePacket: EvidencePacket;
  usage: UsageSummary;
  runtimeTraces: ReadonlyArray<RuntimeTraceEvent>;
}> {
  if (!authored.declaredActors.includes('manager')) {
    throw new Error('runPaseo requires manager in declaredActors');
  }

  const teamContext: TeamContext = compileTeamContext(toCoreAuthoredSpec(authored));
  const kernel = new RunKernel({
    initialState: initialState(teamContext),
    idProvider: options.idProvider,
    clockProvider: options.clockProvider,
  });

  const isAgenticToolRun = isAgenticToolMode(authored);

  kernel.seedRunStarted(
    {
      scenarioRef: teamContext.scenarioRef,
      runProfileRef: teamContext.runProfileRef,
      startedAt: options.clockProvider.nowIso(),
    },
    { correlationId: options.correlationId ?? null },
  );

  if (isAgenticToolRun) {
    const loadedAuthored = ensureLoadedAuthoredSpec(authored, 'agentic_tool');
    const usage = await runAgenticToolLoop(loadedAuthored, kernel, {
      client: options.client,
        idProvider: options.idProvider,
        clockProvider: options.clockProvider,
        paseoAgentSpec: options.paseoAgentSpec,
        bridgeSelfCheck: options.bridgeSelfCheck,
        waitTimeoutSec: options.waitTimeoutSec ?? DEFAULT_WAIT_TIMEOUT_SEC,
        workspaceCwd: options.workspaceCwd,
      });
    const events = stripAcceptedRequestKey(kernel.eventLog.read(0, kernel.eventLog.head + 1));
    const views = replayAll(events);
    const evidencePacket = assembleEvidencePacket(views, events, kernel.state.runId, {
      initiatingActor: usage.initiatingActor,
    });

    return {
      events,
      views,
      evidencePacket,
      usage,
      runtimeTraces: usage.runtimeTraces,
    };
  }

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
  const evidencePacket = assembleEvidencePacket(views, events, kernel.state.runId, {
    initiatingActor: { kind: 'manager' },
  });

  return {
    events,
    views,
    evidencePacket,
    usage: usage.finalize(),
    runtimeTraces: [],
  };
}
