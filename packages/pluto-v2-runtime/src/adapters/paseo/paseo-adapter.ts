import {
  ArtifactPublishedPayloadSchema,
  MailboxMessageAppendedPayloadSchema,
  ProtocolRequestSchema,
  RunCompletedPayloadSchema,
  SCHEMA_VERSION,
  TaskCreatedPayloadSchema,
  TaskStateChangedPayloadSchema,
  type ActorRef,
  type ClockProvider,
  type IdProvider,
  type ProtocolRequest,
  type TeamContext,
} from '@pluto/v2-core';
import { z } from 'zod';

import type { PaseoUsageEstimate } from './paseo-cli-client.js';
import type { KernelView } from '../../runtime/kernel-view.js';
import type { RuntimeAdapter, RuntimeAdapterStep } from '../../runtime/runtime-adapter.js';

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

export interface PaseoAdapterState {
  readonly turnIndex: number;
  readonly maxTurns: number;
  readonly currentActor: ActorRef | null;
  readonly transcriptByActor: Readonly<Record<string, string>>;
  readonly awaitingResponseFor: ActorRef | null;
  readonly bufferedResponse: PaseoTurnResponse | null;
  readonly parseFailureCount: number;
  readonly maxParseFailuresPerTurn: number;
}

export type PaseoDeterministicAdapterState = PaseoAdapterState;

export class PaseoAdapterStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaseoAdapterStateError';
  }
}

type PhaseDefinition = {
  actor: ActorRef;
  prompt: (view: KernelView) => string;
};

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_PARSE_FAILURES_PER_TURN = 2;

const PLANNER_ACTOR: ActorRef = { kind: 'role', role: 'planner' };
const GENERATOR_ACTOR: ActorRef = { kind: 'role', role: 'generator' };
const EVALUATOR_ACTOR: ActorRef = { kind: 'role', role: 'evaluator' };
const MANAGER_ACTOR: ActorRef = { kind: 'manager' };

const DeterministicDirectiveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('append_mailbox_message'),
    payload: MailboxMessageAppendedPayloadSchema.omit({ messageId: true }),
  }),
  z.object({
    kind: z.literal('create_task'),
    payload: TaskCreatedPayloadSchema.omit({ taskId: true }),
  }),
  z.object({
    kind: z.literal('change_task_state'),
    payload: TaskStateChangedPayloadSchema.omit({ from: true }),
  }),
  z.object({
    kind: z.literal('publish_artifact'),
    payload: ArtifactPublishedPayloadSchema.omit({ artifactId: true }),
  }),
  z.object({
    kind: z.literal('complete_run'),
    payload: RunCompletedPayloadSchema.omit({ completedAt: true }),
  }),
]);

type DeterministicDirective = z.infer<typeof DeterministicDirectiveSchema>;
type DeterministicDirectiveParseResult =
  | { ok: true; directive: DeterministicDirective }
  | { ok: false; reason: string };
const FENCED_JSON_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/gi;

function actorPromptLabel(actor: ActorRef): string {
  return actor.kind === 'role' ? actor.role : actor.kind;
}

function actorKeyOf(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `role:${actor.role}`;
  }
}

function actorKeyString(actor: ActorRef | null): string {
  return actor == null ? 'unknown' : actorKeyOf(actor);
}

function appendTranscript(
  transcriptByActor: Readonly<Record<string, string>>,
  actor: ActorRef,
  entry: string,
): Readonly<Record<string, string>> {
  const key = actorKeyOf(actor);
  const previous = transcriptByActor[key] ?? '';
  return {
    ...transcriptByActor,
    [key]: previous.length > 0 ? `${previous}\n${entry}` : entry,
  };
}

function latestCreatedTaskId(view: KernelView): string {
  for (let index = view.events.length - 1; index >= 0; index -= 1) {
    const event = view.events[index];
    if (event?.kind === 'task_created' && event.outcome === 'accepted') {
      return event.payload.taskId;
    }
  }

  throw new PaseoAdapterStateError('taskId is unavailable before task_created is accepted');
}

function buildDirectivePrompt(actor: ActorRef, directiveKind: string, payload: Record<string, unknown>): string {
  return [
    `You are the ${actorPromptLabel(actor)} actor for a deterministic Pluto runtime phase.`,
    `Return exactly one fenced JSON code block and nothing else.`,
    `Use directive kind ${directiveKind}.`,
    'Use this payload structure:',
    '```json',
    JSON.stringify({ kind: directiveKind, payload }, null, 2),
    '```',
  ].join('\n');
}

function phasePlan(): readonly PhaseDefinition[] {
  return [
    {
      actor: PLANNER_ACTOR,
      prompt: () =>
        buildDirectivePrompt(PLANNER_ACTOR, 'create_task', {
          title: 'Implement the requested runtime change',
          ownerActor: GENERATOR_ACTOR,
          dependsOn: [],
        }),
    },
    {
      actor: GENERATOR_ACTOR,
      prompt: (view) =>
        buildDirectivePrompt(GENERATOR_ACTOR, 'change_task_state', {
          taskId: latestCreatedTaskId(view),
          to: 'running',
        }),
    },
    {
      actor: GENERATOR_ACTOR,
      prompt: () =>
        buildDirectivePrompt(GENERATOR_ACTOR, 'publish_artifact', {
          kind: 'final',
          mediaType: 'text/markdown',
          byteSize: 256,
        }),
    },
    {
      actor: EVALUATOR_ACTOR,
      prompt: () =>
        buildDirectivePrompt(EVALUATOR_ACTOR, 'append_mailbox_message', {
          fromActor: EVALUATOR_ACTOR,
          toActor: MANAGER_ACTOR,
          kind: 'final',
          body: 'Artifact reviewed. Ready to complete the run.',
        }),
    },
    {
      actor: GENERATOR_ACTOR,
      prompt: (view) =>
        buildDirectivePrompt(GENERATOR_ACTOR, 'change_task_state', {
          taskId: latestCreatedTaskId(view),
          to: 'completed',
        }),
    },
    {
      actor: MANAGER_ACTOR,
      prompt: () =>
        buildDirectivePrompt(MANAGER_ACTOR, 'complete_run', {
          status: 'succeeded',
          summary: 'Deterministic paseo phase plan completed.',
        }),
    },
  ];
}

function phaseAt(turnIndex: number): PhaseDefinition | null {
  return phasePlan()[turnIndex] ?? null;
}

function makeProtocolRequest(
  actor: ActorRef,
  directive: DeterministicDirective,
  view: KernelView,
  providers: { idProvider: IdProvider; clockProvider: ClockProvider },
): ProtocolRequest {
  return ProtocolRequestSchema.parse({
    requestId: providers.idProvider.next(),
    runId: view.state.runId,
    actor,
    intent: directive.kind,
    payload: directive.payload,
    idempotencyKey: null,
    clientTimestamp: providers.clockProvider.nowIso(),
    schemaVersion: SCHEMA_VERSION,
  });
}

function nextPhaseState(
  state: PaseoDeterministicAdapterState,
  transcriptByActor: Readonly<Record<string, string>>,
): PaseoDeterministicAdapterState {
  const nextTurnIndex = state.turnIndex + 1;
  const nextPhase = phaseAt(nextTurnIndex);
  return {
    turnIndex: nextTurnIndex,
    maxTurns: state.maxTurns,
    currentActor: nextPhase?.actor ?? null,
    transcriptByActor,
    awaitingResponseFor: nextPhase?.actor ?? null,
    bufferedResponse: null,
    parseFailureCount: 0,
    maxParseFailuresPerTurn: state.maxParseFailuresPerTurn,
  };
}

function parseDeterministicDirectiveCandidate(candidate: string): DeterministicDirectiveParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    return { ok: false, reason: `directive JSON parse failed: ${message}` };
  }

  const result = DeterministicDirectiveSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: `directive validation failed: ${result.error.issues.map((issue) => issue.message).join('; ')}`,
    };
  }

  return { ok: true, directive: result.data };
}

function extractBalancedJsonObject(text: string): string | null {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char == null) {
      continue;
    }

    if (startIndex === -1) {
      if (char === '{') {
        startIndex = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseDeterministicDirective(text: string): DeterministicDirectiveParseResult {
  const fencedMatches = [...text.matchAll(FENCED_JSON_BLOCK_PATTERN)];
  if (fencedMatches.length > 1) {
    return { ok: false, reason: 'multiple fenced json blocks found' };
  }

  if (fencedMatches[0]?.[1] != null) {
    return parseDeterministicDirectiveCandidate(fencedMatches[0][1].trim());
  }

  const balancedObject = extractBalancedJsonObject(text);
  if (balancedObject == null) {
    return { ok: false, reason: 'no fenced json block or balanced JSON object found' };
  }

  return parseDeterministicDirectiveCandidate(balancedObject);
}

export function makePaseoAdapter(options: {
  idProvider: IdProvider;
  clockProvider: ClockProvider;
  maxTurns?: number;
  maxParseFailuresPerTurn?: number;
}): PaseoRuntimeAdapter<PaseoAdapterState> {
  return {
    init(teamContext: TeamContext, _view: KernelView): PaseoAdapterState {
      const firstPhase = phaseAt(0);
      return {
        turnIndex: 0,
        maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
        currentActor: firstPhase?.actor ?? null,
        transcriptByActor: {},
        awaitingResponseFor: firstPhase?.actor ?? null,
        bufferedResponse: null,
        parseFailureCount: 0,
        maxParseFailuresPerTurn: options.maxParseFailuresPerTurn ?? DEFAULT_MAX_PARSE_FAILURES_PER_TURN,
      };
    },

    pendingPaseoTurn(state: PaseoAdapterState, view: KernelView): PaseoTurnRequest | null {
      if (state.bufferedResponse !== null || state.turnIndex >= state.maxTurns) {
        return null;
      }

      const pendingActor = state.awaitingResponseFor;
      const phase = phaseAt(state.turnIndex);
      if (pendingActor == null || phase == null) {
        return null;
      }

      return {
        actor: pendingActor,
        prompt: phase.prompt(view),
      };
    },

    withPaseoResponse(state: PaseoAdapterState, response: PaseoTurnResponse): PaseoAdapterState {
      if (state.awaitingResponseFor == null) {
        throw new PaseoAdapterStateError('received paseo response with no actor awaiting a response');
      }

      if (actorKeyOf(state.awaitingResponseFor) !== actorKeyOf(response.actor)) {
        throw new PaseoAdapterStateError(
          `received paseo response for ${actorKeyOf(response.actor)} while awaiting ${actorKeyOf(state.awaitingResponseFor)}`,
        );
      }

      return {
        ...state,
        currentActor: response.actor,
        awaitingResponseFor: null,
        bufferedResponse: response,
        transcriptByActor: appendTranscript(
          state.transcriptByActor,
          response.actor,
          `[assistant turn ${state.turnIndex}]\n${response.transcriptText}`,
        ),
      };
    },

    step(state: PaseoAdapterState, view: KernelView): RuntimeAdapterStep<PaseoAdapterState> {
      const deterministicState = state;

      if (deterministicState.bufferedResponse !== null) {
        const parseResult = parseDeterministicDirective(deterministicState.bufferedResponse.transcriptText);
        if (!parseResult.ok) {
          const nextFailureCount = deterministicState.parseFailureCount + 1;
          const nextState: PaseoDeterministicAdapterState = {
            ...deterministicState,
            awaitingResponseFor: deterministicState.currentActor,
            bufferedResponse: null,
            parseFailureCount: nextFailureCount,
            transcriptByActor: deterministicState.currentActor
              ? appendTranscript(
                  deterministicState.transcriptByActor,
                  deterministicState.currentActor,
                  `[system] Parse failure: ${parseResult.reason}`,
                )
              : deterministicState.transcriptByActor,
          };

          if (nextFailureCount > deterministicState.maxParseFailuresPerTurn) {
            return {
              kind: 'done',
              completion: {
                status: 'failed',
                summary: `parse failure budget exhausted for actor ${actorKeyString(deterministicState.currentActor)} at turn ${deterministicState.turnIndex}`,
              },
              nextState,
            };
          }

          return {
            kind: 'request',
            request: makeProtocolRequest(
              deterministicState.currentActor ?? MANAGER_ACTOR,
              {
                kind: 'append_mailbox_message',
                payload: {
                  fromActor: MANAGER_ACTOR,
                  toActor: deterministicState.currentActor ?? MANAGER_ACTOR,
                  kind: 'final',
                  body: `Directive parse failure: ${parseResult.reason}. Return exactly one fenced json block of the expected kind.`,
                },
              },
              view,
              options,
            ),
            nextState,
          };
        }

        if (parseResult.directive.kind === 'complete_run') {
          return {
            kind: 'done',
            completion: parseResult.directive.payload,
            nextState: nextPhaseState(deterministicState, deterministicState.transcriptByActor),
          };
        }

        return {
          kind: 'request',
          request: makeProtocolRequest(deterministicState.currentActor ?? MANAGER_ACTOR, parseResult.directive, view, options),
          nextState: nextPhaseState(deterministicState, deterministicState.transcriptByActor),
        };
      }

      if (deterministicState.turnIndex >= deterministicState.maxTurns) {
        return {
          kind: 'done',
          completion: {
            status: 'failed',
            summary: 'maxTurns exhausted',
          },
          nextState: deterministicState,
        };
      }

      if (this.pendingPaseoTurn(deterministicState, view) !== null) {
        throw new PaseoAdapterStateError('step reached while a paseo turn is still pending');
      }

      throw new PaseoAdapterStateError('step reached with no buffered response or completion available');
    },
  };
}
