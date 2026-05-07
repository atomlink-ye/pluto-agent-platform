import { z } from 'zod';

import { ActorRefSchema } from '../actor-ref.js';
import { PROTOCOL_REQUEST_INTENT_VALUES, ProtocolRequestSchema, type ProtocolRequest } from '../protocol-request.js';
import {
  RequestRejectedEventSchema,
  RunEventSchema,
  RunStartedEventSchema,
  type RunEvent,
  type RunStartedEvent,
} from '../run-event.js';
import { SCHEMA_VERSION } from '../versioning.js';

import { composeRequestKey } from './authority.js';
import {
  defaultClockProvider,
  defaultIdProvider,
  type ClockProvider,
  type IdProvider,
} from './providers.js';
import { validate, type ValidationContext } from './protocol-validator.js';
import { InMemoryEventLogStore, type EventLogStore } from './run-event-log.js';
import { reduce } from './run-state-reducer.js';
import { RunStateSchema, type RunState } from './run-state.js';

const UNKNOWN_REQUEST_ID_LABEL = '<unknown>';
const UNKNOWN_REQUEST_ID_UUID = '00000000-0000-4000-8000-000000000000';
const UNKNOWN_RUN_ID = '<unknown-run>';
const UUID_SCHEMA = z.string().uuid();
const VALID_INTENT_VALUES = new Set<string>(PROTOCOL_REQUEST_INTENT_VALUES);

type AcceptedEventWithRequestKey = RunEvent & {
  acceptedRequestKey?: string | null;
};

export interface KernelDeps {
  initialState: RunState;
  eventLog?: EventLogStore;
  idProvider?: IdProvider;
  clockProvider?: ClockProvider;
}

export interface RunKernelSubmitContext extends ValidationContext {
  correlationId?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function summarizeParseError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

function extractRequestIdSafely(rawRequest: unknown): string | null {
  if (!isRecord(rawRequest) || typeof rawRequest.requestId !== 'string') {
    return null;
  }

  return UUID_SCHEMA.safeParse(rawRequest.requestId).success ? rawRequest.requestId : null;
}

function extractRunIdSafely(rawRequest: unknown): string | null {
  return isRecord(rawRequest) && typeof rawRequest.runId === 'string' ? rawRequest.runId : null;
}

function extractActorSafely(rawRequest: unknown): ProtocolRequest['actor'] | null {
  if (!isRecord(rawRequest) || !('actor' in rawRequest)) {
    return null;
  }

  const parsedActor = ActorRefSchema.safeParse(rawRequest.actor);
  return parsedActor.success ? parsedActor.data : null;
}

function parseStageReason(rawRequest: unknown): 'intent_unknown' | 'schema_invalid' {
  if (isRecord(rawRequest) && typeof rawRequest.intent === 'string' && !VALID_INTENT_VALUES.has(rawRequest.intent)) {
    return 'intent_unknown';
  }

  return 'schema_invalid';
}

function parseStageDetail(rawRequest: unknown, error: z.ZodError): string {
  if (parseStageReason(rawRequest) === 'intent_unknown' && isRecord(rawRequest) && typeof rawRequest.intent === 'string') {
    return `Unknown intent ${rawRequest.intent}. ${summarizeParseError(error)}`;
  }

  return summarizeParseError(error);
}

function schemaCompatibleRequestId(rawRequest: unknown): { label: string; value: string } {
  const label = extractRequestIdSafely(rawRequest) ?? UNKNOWN_REQUEST_ID_LABEL;
  return {
    label,
    value: label === UNKNOWN_REQUEST_ID_LABEL ? UNKNOWN_REQUEST_ID_UUID : label,
  };
}

function deriveCausationId(eventLog: EventLogStore): string | null {
  if (eventLog.head < 0) {
    return null;
  }

  return eventLog.read(eventLog.head, eventLog.head + 1)[0]?.eventId ?? null;
}

function rejectedEntityRef(request: ProtocolRequest): RunEvent['entityRef'] {
  switch (request.intent) {
    case 'change_task_state':
      return { kind: 'task', taskId: request.payload.taskId };
    case 'append_mailbox_message':
    case 'create_task':
    case 'publish_artifact':
    case 'complete_run':
      return { kind: 'run', runId: request.runId };
  }
}

function correlationIdFor(ctx?: RunKernelSubmitContext): string | null {
  return ctx?.correlationId ?? null;
}

function withAcceptedRequestKey(event: RunEvent, acceptedRequestKey: string | null): AcceptedEventWithRequestKey {
  return Object.assign(event, { acceptedRequestKey });
}

function taskStateOrThrow(state: RunState, taskId: string): RunState['tasks'][string]['state'] {
  const task = state.tasks[taskId];

  if (!task) {
    throw new Error(`Validated task ${taskId} is missing from run state.`);
  }

  return task.state;
}

export class RunKernel {
  readonly #eventLog: EventLogStore;
  readonly #idProvider: IdProvider;
  readonly #clockProvider: ClockProvider;
  #state: RunState;

  constructor(deps: KernelDeps) {
    this.#eventLog = deps.eventLog ?? new InMemoryEventLogStore();
    this.#idProvider = deps.idProvider ?? defaultIdProvider;
    this.#clockProvider = deps.clockProvider ?? defaultClockProvider;
    this.#state = RunStateSchema.parse(deps.initialState);
  }

  get eventLog(): EventLogStore {
    return this.#eventLog;
  }

  get state(): RunState {
    return this.#state;
  }

  seedRunStarted(
    payload: {
      scenarioRef: string;
      runProfileRef: string;
      startedAt: string;
    },
    ctx?: RunKernelSubmitContext,
  ): { event: RunStartedEvent } {
    if (this.#eventLog.head >= 0) {
      throw new Error('run_started can only be seeded into an empty event log');
    }

    const event = RunStartedEventSchema.parse({
      eventId: this.#idProvider.next(),
      runId: this.#state.runId,
      sequence: this.#state.sequence + 1,
      timestamp: this.#clockProvider.nowIso(),
      schemaVersion: SCHEMA_VERSION,
      actor: { kind: 'system' },
      requestId: null,
      causationId: null,
      correlationId: correlationIdFor(ctx),
      entityRef: { kind: 'run', runId: this.#state.runId },
      outcome: 'accepted',
      kind: 'run_started',
      payload,
    });

    this.#eventLog.append(event);
    this.#state = reduce(this.#state, event);

    return { event };
  }

  submit(rawRequest: unknown, ctx?: RunKernelSubmitContext): { event: RunEvent } {
    const parsedRequest = ProtocolRequestSchema.safeParse(rawRequest);
    const event = parsedRequest.success
      ? this.#submitParsedRequest(parsedRequest.data, ctx)
      : this.#submitRejectedParse(rawRequest, parsedRequest.error, ctx);

    this.#eventLog.append(event);
    this.#state = reduce(this.#state, event);

    return { event };
  }

  #submitParsedRequest(request: ProtocolRequest, ctx?: RunKernelSubmitContext): RunEvent {
    const validationResult = validate(this.#state, request, ctx);
    return validationResult.ok
      ? this.#buildAcceptedEvent(request, ctx)
      : this.#buildRejectedEvent({
          runId: request.runId,
          actor: request.actor,
          requestId: request.requestId,
          rejectedRequestId: request.requestId,
          schemaVersion: request.schemaVersion,
          entityRef: rejectedEntityRef(request),
          reason: validationResult.reason,
          detail: validationResult.detail,
          correlationId: correlationIdFor(ctx),
        });
  }

  #submitRejectedParse(rawRequest: unknown, error: z.ZodError, ctx?: RunKernelSubmitContext): RunEvent {
    const requestId = schemaCompatibleRequestId(rawRequest);
    const runId = (extractRunIdSafely(rawRequest) ?? this.#state.runId) || UNKNOWN_RUN_ID;

    return this.#buildRejectedEvent({
      runId,
      actor: extractActorSafely(rawRequest) ?? { kind: 'system' },
      requestId: requestId.value,
      rejectedRequestId: requestId.value,
      schemaVersion: SCHEMA_VERSION,
      entityRef: { kind: 'run', runId },
      reason: parseStageReason(rawRequest),
      detail: `Rejected request ${requestId.label}: ${parseStageDetail(rawRequest, error)}`,
      correlationId: correlationIdFor(ctx),
    });
  }

  #buildAcceptedEvent(request: ProtocolRequest, ctx?: RunKernelSubmitContext): RunEvent {
    const eventId = this.#idProvider.next();
    const timestamp = this.#clockProvider.nowIso();
    const acceptedRequestKey = composeRequestKey(
      request.runId,
      request.actor,
      request.intent,
      request.idempotencyKey,
    );

    const baseEvent = {
      eventId,
      runId: request.runId,
      sequence: this.#state.sequence + 1,
      timestamp,
      schemaVersion: request.schemaVersion,
      actor: request.actor,
      requestId: request.requestId,
      causationId: deriveCausationId(this.#eventLog),
      correlationId: correlationIdFor(ctx),
      outcome: 'accepted' as const,
    };

    switch (request.intent) {
      case 'append_mailbox_message': {
        const messageId = this.#idProvider.next();
        return withAcceptedRequestKey(
          RunEventSchema.parse({
            ...baseEvent,
            kind: 'mailbox_message_appended',
            entityRef: { kind: 'mailbox_message', messageId },
            payload: {
              ...request.payload,
              messageId,
            },
          }),
          acceptedRequestKey,
        );
      }
      case 'create_task': {
        const taskId = this.#idProvider.next();
        return withAcceptedRequestKey(
          RunEventSchema.parse({
            ...baseEvent,
            kind: 'task_created',
            entityRef: { kind: 'task', taskId },
            payload: {
              ...request.payload,
              taskId,
            },
          }),
          acceptedRequestKey,
        );
      }
      case 'change_task_state': {
        return withAcceptedRequestKey(
          RunEventSchema.parse({
            ...baseEvent,
            kind: 'task_state_changed',
            entityRef: { kind: 'task', taskId: request.payload.taskId },
            payload: {
              taskId: request.payload.taskId,
              from: taskStateOrThrow(this.#state, request.payload.taskId),
              to: request.payload.to,
            },
          }),
          acceptedRequestKey,
        );
      }
      case 'publish_artifact': {
        const artifactId = this.#idProvider.next();
        return withAcceptedRequestKey(
          RunEventSchema.parse({
            ...baseEvent,
            kind: 'artifact_published',
            entityRef: { kind: 'artifact', artifactId },
            payload: {
              ...request.payload,
              artifactId,
            },
          }),
          acceptedRequestKey,
        );
      }
      case 'complete_run': {
        return withAcceptedRequestKey(
          RunEventSchema.parse({
            ...baseEvent,
            kind: 'run_completed',
            entityRef: { kind: 'run', runId: request.runId },
            payload: {
              ...request.payload,
              completedAt: timestamp,
            },
          }),
          acceptedRequestKey,
        );
      }
    }

    const exhaustiveRequest: never = request;
    return exhaustiveRequest;
  }

  #buildRejectedEvent(input: {
    runId: string;
    actor: ProtocolRequest['actor'];
    requestId: string;
    rejectedRequestId: string;
    schemaVersion: string;
    entityRef: RunEvent['entityRef'];
    reason: Extract<RunEvent, { kind: 'request_rejected' }>['payload']['rejectionReason'];
    detail: string;
    correlationId: string | null;
  }): RunEvent {
    return RequestRejectedEventSchema.parse({
      eventId: this.#idProvider.next(),
      runId: input.runId,
      sequence: this.#state.sequence + 1,
      timestamp: this.#clockProvider.nowIso(),
      schemaVersion: input.schemaVersion,
      actor: input.actor,
      requestId: input.requestId,
      causationId: deriveCausationId(this.#eventLog),
      correlationId: input.correlationId,
      entityRef: input.entityRef,
      outcome: 'rejected',
      kind: 'request_rejected',
      payload: {
        rejectionReason: input.reason,
        rejectedRequestId: input.rejectedRequestId,
        detail: input.detail,
      },
    });
  }
}
