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
  type TeamContext,
} from '@pluto/v2-core';
import { actorKey } from '../../../../pluto-v2-core/src/core/team-context.js';

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
import { buildAgenticToolPrompt } from './agentic-tool-prompt-builder.js';
import { createInitialAgenticLoopState } from './agentic-loop-state.js';
import { leadActorFromSpec, pickNextAgenticActor, withKernelRejection } from './agentic-scheduler.js';
import { type PaseoDirective } from './paseo-directive.js';
import { buildPromptView } from './prompt-view.js';

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
  configureAgenticState?(state: S, spec: LoadedAuthoredSpec): S;
  bypassKernelRequest?(state: S, request: ProtocolRequest, view: KernelView): boolean;
  withKernelEvent?(state: S, event: RunEvent, view: KernelView): S;
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

type RuntimeAuthoredInput = AuthoredSpec | LoadedAuthoredSpec;

type AgenticToolLoopState = ReturnType<typeof createInitialAgenticLoopState>;

type ObservedMutatingToolCall = {
  actor: ActorRef;
  toolName: PlutoToolName;
  rawArgs: unknown;
  result: PlutoToolResult;
  event: RunEvent | null;
};

type AgentInjection = {
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  cleanupPath?: string;
};

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
} as const satisfies Record<(typeof MUTATING_TOOL_NAMES)[number], PaseoDirective['kind']>;

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

function isAgenticTextMode(authored: RuntimeAuthoredInput): boolean {
  const mode = runtimeModeOf(authored);
  return mode === 'agentic' || mode === 'agentic_text';
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
            ...(orchestration.mode === 'agentic_text' || orchestration.mode === 'agentic_tool'
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

function buildToolAttemptDirective(toolName: (typeof MUTATING_TOOL_NAMES)[number], rawArgs: unknown): PaseoDirective {
  const payload = rawArgs != null && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs as Record<string, unknown>
    : {};

  return {
    kind: TOOL_NAME_TO_DIRECTIVE_KIND[toolName],
    payload,
  } as PaseoDirective;
}

function buildDiagnosticDirective(actor: ActorRef, body: string): PaseoDirective {
  return {
    kind: 'append_mailbox_message',
    payload: {
      fromActor: { kind: 'manager' },
      toActor: actor,
      kind: 'final',
      body,
    },
  } as PaseoDirective;
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

function createOpencodeConfigPayload(mcpEndpoint: string, bearerToken: string) {
  return {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      pluto: {
        type: 'remote',
        url: mcpEndpoint,
        enabled: true,
        oauth: false,
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      },
    },
  };
}

async function prepareAgentInjection(args: {
  runId: string;
  actor: ActorRef;
  mcpEndpoint: string;
  bearerToken: string;
}): Promise<AgentInjection> {
  const configPayload = createOpencodeConfigPayload(args.mcpEndpoint, args.bearerToken);
  const configJson = JSON.stringify(configPayload, null, 2);
  const actorDir = join(process.cwd(), '.pluto', 'runs', args.runId, 'agents', actorKey(args.actor));

  try {
    await mkdir(actorDir, { recursive: true });
    await writeFile(join(actorDir, 'opencode.json'), configJson, 'utf8');
    return {
      cwd: actorDir,
      cleanupPath: actorDir,
    };
  } catch {
    return {
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(configPayload),
      },
    };
  }
}

async function cleanupPaths(paths: Iterable<string>): Promise<void> {
  for (const path of paths) {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

async function runAgenticToolLoop(
  authored: LoadedAuthoredSpec,
  kernel: RunKernel,
  options: {
    client: PaseoCliClient;
    idProvider: IdProvider;
    clockProvider: ClockProvider;
    paseoAgentSpec: (actor: ActorRef) => PaseoAgentSpec;
    waitTimeoutSec: number;
  },
): Promise<UsageSummary> {
  const leadActor = leadActorFromSpec(authored);
  const stateSeed = createInitialAgenticLoopState({ spec: authored });
  let state: AgenticToolLoopState = {
    ...stateSeed,
    currentActor: leadActor,
    awaitingResponseFor: leadActor,
  };
  const agentByActorKey = new Map<string, string>();
  const transcriptByActor = new Map<string, string>();
  const agentCleanupPaths = new Set<string>();
  const usage = createUsageAccumulator();
  const leaseStore = makeTurnLeaseStore(leadActor);
  const bearerToken = randomUUID();
  const runRootDir = join(process.cwd(), '.pluto', 'runs', kernel.state.runId);
  let observedMutatingToolCall: ObservedMutatingToolCall | null = null;

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
          return buildPromptView({
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
        },
      },
    }),
    kernel,
    onObserved(call) {
      if (!MUTATING_TOOL_NAME_SET.has(call.toolName)) {
        return;
      }

      if (leaseStore.matches(call.actor)) {
        observedMutatingToolCall = call;
      }
    },
  });

  const server = await startPlutoMcpServer({
    bearerToken,
    handlers,
    leaseStore,
  });

  try {
    for (;;) {
      const budgetFailure = state.turnIndex >= state.maxTurns
        ? { status: 'failed' as const, summary: 'maxTurns exhausted' }
        : state.noProgressTurns > state.maxNoProgressTurns
          ? { status: 'failed' as const, summary: 'maxNoProgressTurns exhausted' }
          : state.kernelRejections > state.maxKernelRejections
            ? { status: 'failed' as const, summary: 'maxKernelRejections exhausted' }
            : null;
      if (budgetFailure != null) {
        kernel.submit(buildCompleteRunRequest(kernel.state.runId, budgetFailure, options));
        break;
      }

      const actor = state.currentActor ?? leadActor;
      const key = actorKey(actor);
      const promptView = buildPromptView({
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
      const prompt = buildAgenticToolPrompt({
        actor,
        role: actor.kind === 'role' ? actor.role : null,
        promptView,
        playbook: authored.playbook,
        userTask: authored.userTask ?? null,
        mcpEndpoint: server.url,
        bearerToken,
        toolNames: PLUTO_TOOL_NAMES,
      });
      const baseAgentSpec = options.paseoAgentSpec(actor);

      leaseStore.setCurrent(actor);
      observedMutatingToolCall = null;

      let agentId = agentByActorKey.get(key);
      if (agentId == null) {
        const injection = await prepareAgentInjection({
          runId: kernel.state.runId,
          actor,
          mcpEndpoint: server.url,
          bearerToken,
        });
        if (injection.cleanupPath != null) {
          agentCleanupPaths.add(injection.cleanupPath);
        }

        const session = await options.client.spawnAgent({
          ...baseAgentSpec,
          initialPrompt: prompt,
          ...(injection.cwd == null ? {} : { cwd: injection.cwd }),
          ...(injection.env == null
            ? {}
            : {
                env: {
                  ...(baseAgentSpec.env ?? {}),
                  ...injection.env,
                },
              }),
        });
        agentId = session.agentId;
        agentByActorKey.set(key, agentId);
      } else {
        await options.client.sendPrompt(agentId, prompt);
      }

      let waitExitCode = 0;
      let waitFailure: string | null = null;
      try {
        const wait = await options.client.waitIdle(agentId, options.waitTimeoutSec);
        waitExitCode = wait.exitCode;
      } catch (error) {
        waitExitCode = 1;
        waitFailure = error instanceof Error ? error.message : String(error);
      }

      const fullTranscript = await options.client.readTranscript(agentId, TRANSCRIPT_TAIL_LINES).catch(() => transcriptByActor.get(key) ?? '');
      transcriptByActor.set(key, fullTranscript);
      const usageEstimate = await options.client.usageEstimate(agentId).catch(() => ({}));

      usage.accumulate({
        turn: state.turnIndex,
        actor,
        waitExitCode,
        ...usageEstimate,
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

      if (observedMutatingToolCall == null) {
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

      const observed: ObservedMutatingToolCall = observedMutatingToolCall;
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

      if (observed.toolName === 'pluto_complete_run' && observed.event.kind === 'run_completed') {
        break;
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
    leaseStore.setCurrent(null);
    await server.shutdown();
    await cleanupAgents(options.client, agentByActorKey.values());
    await cleanupPaths(agentCleanupPaths);
  }

  return usage.finalize();
}

export async function runPaseo<S>(
  authored: RuntimeAuthoredInput,
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

  const teamContext: TeamContext = compileTeamContext(toCoreAuthoredSpec(authored));
  const kernel = new RunKernel({
    initialState: initialState(teamContext),
    idProvider: options.idProvider,
    clockProvider: options.clockProvider,
  });

  const isAgenticTextRun = isAgenticTextMode(authored);
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
      waitTimeoutSec: options.waitTimeoutSec ?? DEFAULT_WAIT_TIMEOUT_SEC,
    });
    const events = stripAcceptedRequestKey(kernel.eventLog.read(0, kernel.eventLog.head + 1));
    const views = replayAll(events);
    const evidencePacket = assembleEvidencePacket(views, events, kernel.state.runId);

    return {
      events,
      views,
      evidencePacket,
      usage,
    };
  }

  let state = adapter.init(teamContext, kernelViewOf(kernel));
  if (isAgenticTextRun) {
    if (adapter.configureAgenticState == null) {
      throw new Error('runPaseo agentic mode requires adapter.configureAgenticState');
    }
    state = adapter.configureAgenticState(state, ensureLoadedAuthoredSpec(authored, 'agentic_text'));
  }
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

        if (adapter.bypassKernelRequest?.(step.nextState, step.request, kernelViewOf(kernel)) ?? false) {
          state = step.nextState;
          continue;
        }

        const submission = kernel.submit(step.request, { correlationId: options.correlationId ?? null });
        state = adapter.withKernelEvent?.(step.nextState, submission.event, kernelViewOf(kernel)) ?? step.nextState;
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
