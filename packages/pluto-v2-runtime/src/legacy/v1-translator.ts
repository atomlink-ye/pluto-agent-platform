import { createHash } from 'node:crypto';

import type { ActorRef } from '@pluto/v2-core/actor-ref';
import type { MailboxMessageKind, RunEvent, TaskState } from '@pluto/v2-core/run-event';
import { SCHEMA_VERSION } from '@pluto/v2-core/versioning';

const UUID_V5_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

type LegacyEventType =
  | 'run_started'
  | 'lead_started'
  | 'run_completed'
  | 'final_reconciliation_received'
  | 'task_created'
  | 'task_claimed'
  | 'task_completed'
  | 'mailbox_message'
  | 'mailbox_message_queued'
  | 'mailbox_message_delivered'
  | 'lead_message'
  | 'plan_approval_requested'
  | 'plan_approval_responded'
  | 'artifact_created'
  | 'worker_started'
  | 'worker_completed'
  | 'worker_complete_received'
  | 'spawn_request_received'
  | 'spawn_request_executed'
  | 'coordination_transcript_created';

type LegacyMailboxKind =
  | 'text'
  | 'plan_approval_request'
  | 'plan_approval_response'
  | 'worker_complete'
  | 'spawn_request';

type LegacyBaseEvent = {
  id: string;
  runId: string;
  ts: string;
  type: LegacyEventType;
  roleId?: string;
  payload?: Record<string, unknown>;
};

type TranslationContext = {
  emittedCount: number;
  finalSummary: string | null;
};

const MAILBOX_KIND_MAP: Readonly<Record<LegacyMailboxKind, MailboxMessageKind | null>> = {
  text: null,
  plan_approval_request: 'plan_approval_request',
  plan_approval_response: 'plan_approval_response',
  worker_complete: 'completion',
  spawn_request: null,
};

const parseLegacyEvent = (input: unknown): LegacyBaseEvent => {
  if (!isRecord(input)) {
    throw new Error('Legacy event must be an object');
  }

  const id = requireString(input, 'id');
  const runId = requireString(input, 'runId');
  const ts = requireString(input, 'ts');
  const type = requireLegacyEventType(input.type);
  const roleId = optionalString(input.roleId, 'roleId');
  const payload = optionalRecord(input.payload, 'payload');

  return { id, runId, ts, type, roleId, payload };
};

export const translateLegacyEvents = (legacyEvents: readonly unknown[]): RunEvent[] => {
  const context: TranslationContext = {
    emittedCount: 0,
    finalSummary: null,
  };

  const translated: RunEvent[] = [];
  for (const rawEvent of legacyEvents) {
    const legacyEvent = parseLegacyEvent(rawEvent);
    const nextEvent = translateLegacyEvent(legacyEvent, context);
    if (nextEvent == null) {
      continue;
    }

    translated.push(nextEvent);
    context.emittedCount += 1;
  }

  return translated;
};

const translateLegacyEvent = (
  event: LegacyBaseEvent,
  context: TranslationContext,
): RunEvent | null => {
  switch (event.type) {
    case 'run_started':
      return translateRunStarted(event, context.emittedCount);
    case 'lead_started':
      return null;
    case 'run_completed':
      return translateRunCompleted(event, context);
    case 'final_reconciliation_received':
      return null;
    case 'task_created':
      return translateTaskCreated(event, context);
    case 'task_claimed':
      return translateTaskStateChange(event, context, 'queued', 'running');
    case 'task_completed':
      return translateTaskStateChange(event, context, 'running', 'completed');
    case 'mailbox_message':
      return translateMailboxMessage(event, context.emittedCount);
    case 'mailbox_message_queued':
    case 'mailbox_message_delivered':
    case 'lead_message':
      captureLeadSummary(event, context);
      return null;
    case 'plan_approval_requested':
    case 'plan_approval_responded':
      return null;
    case 'artifact_created':
      return translateArtifactCreated(event, context.emittedCount);
    case 'worker_started':
    case 'worker_completed':
    case 'worker_complete_received':
    case 'spawn_request_received':
    case 'spawn_request_executed':
    case 'coordination_transcript_created':
      return null;
    default:
      return assertNever(event.type);
  }
};

const translateRunStarted = (event: LegacyBaseEvent, sequence: number): RunEvent => {
  const payload = requireRecord(event.payload, 'payload');

  return {
    eventId: deriveUuid(event.id, 'event'),
    runId: event.runId,
    sequence,
    timestamp: event.ts,
    schemaVersion: SCHEMA_VERSION,
    actor: { kind: 'system' },
    requestId: null,
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'run', runId: event.runId },
    outcome: 'accepted',
    kind: 'run_started',
    payload: {
      scenarioRef: requireString(payload, 'scenario'),
      runProfileRef: requireString(payload, 'runProfile'),
      startedAt: event.ts,
    },
  };
};

const translateRunCompleted = (event: LegacyBaseEvent, context: TranslationContext): RunEvent => ({
  eventId: deriveUuid(event.id, 'event'),
  runId: event.runId,
  sequence: context.emittedCount,
  timestamp: event.ts,
  schemaVersion: SCHEMA_VERSION,
  actor: { kind: 'manager' },
  requestId: deriveUuid(event.id, 'request'),
  causationId: null,
  correlationId: null,
  entityRef: { kind: 'run', runId: event.runId },
  outcome: 'accepted',
  kind: 'run_completed',
  payload: {
    status: 'succeeded',
    completedAt: event.ts,
    summary: context.finalSummary,
  },
});

const translateTaskCreated = (
  event: LegacyBaseEvent,
  context: TranslationContext,
): RunEvent => {
  const payload = requireRecord(event.payload, 'payload');
  const taskId = requireString(payload, 'taskId');

  return {
    eventId: deriveUuid(event.id, 'event'),
    runId: event.runId,
    sequence: context.emittedCount,
    timestamp: event.ts,
    schemaVersion: SCHEMA_VERSION,
    actor: event.roleId == null ? { kind: 'manager' } : roleActorRef(event.roleId),
    requestId: deriveUuid(event.id, 'request'),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'task', taskId },
    outcome: 'accepted',
    kind: 'task_created',
    payload: {
      taskId,
      title: readLegacyTaskTitle(payload),
      ownerActor: optionalActorRef(payload.ownerActor),
      dependsOn: arrayOfStrings(payload.dependsOn, 'dependsOn') ?? [],
    },
  };
};

const readLegacyTaskTitle = (payload: Record<string, unknown>): string => {
  const title = payload.title;
  if (typeof title === 'string') {
    return title;
  }

  return requireString(payload, 'summary');
};

const translateTaskStateChange = (
  event: LegacyBaseEvent,
  context: TranslationContext,
  from: TaskState,
  to: TaskState,
): RunEvent => {
  const payload = requireRecord(event.payload, 'payload');
  const taskId = requireString(payload, 'taskId');

  return {
    eventId: deriveUuid(event.id, 'event'),
    runId: event.runId,
    sequence: context.emittedCount,
    timestamp: event.ts,
    schemaVersion: SCHEMA_VERSION,
    actor: roleActorRef(requireString(event, 'roleId')),
    requestId: deriveUuid(event.id, 'request'),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'task', taskId },
    outcome: 'accepted',
    kind: 'task_state_changed',
    payload: {
      taskId,
      from,
      to,
    },
  };
};

const translateMailboxMessage = (event: LegacyBaseEvent, sequence: number): RunEvent | null => {
  const payload = requireRecord(event.payload, 'payload');
  const mappedKind = mapLegacyMailboxKind(requireString(payload, 'kind'));
  if (mappedKind == null) {
    return null;
  }

  const messageId = requireString(payload, 'messageId');
  return {
    eventId: deriveUuid(event.id, 'event'),
    runId: event.runId,
    sequence,
    timestamp: event.ts,
    schemaVersion: SCHEMA_VERSION,
    actor: roleActorRef(requireString(payload, 'from')),
    requestId: deriveUuid(event.id, 'request'),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'mailbox_message', messageId },
    outcome: 'accepted',
    kind: 'mailbox_message_appended',
    payload: {
      messageId,
      fromActor: roleActorRef(requireString(payload, 'from')),
      toActor: roleActorRef(requireString(payload, 'to')),
      kind: mappedKind,
      body: '',
    },
  };
};

const translateArtifactCreated = (event: LegacyBaseEvent, sequence: number): RunEvent => {
  const artifactId = deriveUuid(event.id, 'artifact');
  return {
    eventId: deriveUuid(event.id, 'event'),
    runId: event.runId,
    sequence,
    timestamp: event.ts,
    schemaVersion: SCHEMA_VERSION,
    actor: event.roleId == null ? { kind: 'manager' } : roleActorRef(event.roleId),
    requestId: deriveUuid(event.id, 'request'),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'artifact', artifactId },
    outcome: 'accepted',
    kind: 'artifact_published',
    payload: {
      artifactId,
      kind: 'final',
      mediaType: 'text/markdown',
      byteSize: 0,
    },
  };
};

const captureLeadSummary = (event: LegacyBaseEvent, context: TranslationContext): void => {
  const payload = optionalRecord(event.payload, 'payload');
  if (payload == null || payload.kind !== 'summary') {
    return;
  }

  const markdown = payload.markdown;
  if (typeof markdown !== 'string') {
    return;
  }

  const summary = markdown.match(/^#+\s+(.+)$/m)?.[1]?.trim() ?? null;
  if (summary != null && summary.length > 0) {
    context.finalSummary = summary;
  }
};

const mapLegacyMailboxKind = (value: string): MailboxMessageKind | null => {
  switch (value) {
    case 'text':
    case 'plan_approval_request':
    case 'plan_approval_response':
    case 'worker_complete':
    case 'spawn_request':
      return MAILBOX_KIND_MAP[value];
    default:
      return null;
  }
};

const optionalActorRef = (value: unknown): ActorRef | null => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return roleActorRef(value);
  }

  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('ownerActor must be a string, ActorRef, or null');
  }

  switch (value.kind) {
    case 'manager':
      return { kind: 'manager' };
    case 'system':
      return { kind: 'system' };
    case 'role':
      return roleActorRef(requireString(value, 'role'));
    default:
      throw new Error(`Unknown ownerActor kind "${String(value.kind)}"`);
  }
};

const roleActorRef = (value: string): ActorRef => {
  switch (value) {
    case 'lead':
    case 'planner':
    case 'generator':
    case 'evaluator':
      return { kind: 'role', role: value };
    case 'manager':
      return { kind: 'manager' };
    case 'system':
      return { kind: 'system' };
    default:
      throw new Error(`Unknown legacy actor "${value}"`);
  }
};

const deriveUuid = (legacyEventId: string, purpose: string): string => {
  const namespaceBytes = uuidToBytes(UUID_V5_NAMESPACE);
  const nameBytes = new TextEncoder().encode(`${purpose}:${legacyEventId}`);
  const sha1 = createHash('sha1').update(namespaceBytes).update(nameBytes).digest();
  const bytes = Uint8Array.from(sha1.subarray(0, 16));

  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte == null || variantByte == null) {
    throw new Error('Failed to derive UUID bytes');
  }

  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;

  return bytesToUuid(bytes);
};

const uuidToBytes = (uuid: string): Uint8Array => {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID "${uuid}"`);
  }

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
};

const bytesToUuid = (bytes: Uint8Array): string => {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`Expected ${field} to be an object`);
  }

  return value;
};

const optionalRecord = (value: unknown, field: string): Record<string, unknown> | undefined => {
  if (value == null) {
    return undefined;
  }

  return requireRecord(value, field);
};

const requireString = (value: unknown, field: string): string => {
  if (isRecord(value)) {
    return requireString(value[field], field);
  }

  if (typeof value !== 'string') {
    throw new Error(`Expected ${field} to be a string`);
  }

  return value;
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value == null) {
    return undefined;
  }

  return requireString(value, field);
};

const arrayOfStrings = (value: unknown, field: string): string[] | undefined => {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Expected ${field} to be an array of strings`);
  }

  return [...value];
};

const requireLegacyEventType = (value: unknown): LegacyEventType => {
  switch (value) {
    case 'run_started':
    case 'lead_started':
    case 'run_completed':
    case 'final_reconciliation_received':
    case 'task_created':
    case 'task_claimed':
    case 'task_completed':
    case 'mailbox_message':
    case 'mailbox_message_queued':
    case 'mailbox_message_delivered':
    case 'lead_message':
    case 'plan_approval_requested':
    case 'plan_approval_responded':
    case 'artifact_created':
    case 'worker_started':
    case 'worker_completed':
    case 'worker_complete_received':
    case 'spawn_request_received':
    case 'spawn_request_executed':
    case 'coordination_transcript_created':
      return value;
    default:
      throw new Error(`Unknown legacy event type "${String(value)}"`);
  }
};

const assertNever = (value: never): never => {
  throw new Error(`Unhandled legacy event type "${String(value)}"`);
};

export const V1_TRANSLATOR_UUID_NAMESPACE = UUID_V5_NAMESPACE;
