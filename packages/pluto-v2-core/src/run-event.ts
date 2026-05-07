import { z } from 'zod';

import { ActorRefSchema, SystemActorRefSchema } from './actor-ref.js';
import { RejectionReasonSchema } from './authority-outcome.js';
import {
  ArtifactEntityRefSchema,
  EntityRefSchema,
  MailboxMessageEntityRefSchema,
  RunEntityRefSchema,
  TaskEntityRefSchema,
} from './entity-ref.js';
import { SupportedSchemaVersionSchema } from './versioning.js';

export const ACCEPTED_RUN_EVENT_KIND_VALUES = [
  'run_started',
  'run_completed',
  'mailbox_message_appended',
  'task_created',
  'task_state_changed',
  'artifact_published',
] as const;

export const REJECTED_RUN_EVENT_KIND_VALUES = ['request_rejected'] as const;
export const RUN_EVENT_KIND_VALUES = [
  ...ACCEPTED_RUN_EVENT_KIND_VALUES,
  ...REJECTED_RUN_EVENT_KIND_VALUES,
] as const;

export const AcceptedRunEventKindSchema = z.enum(ACCEPTED_RUN_EVENT_KIND_VALUES);
export const RejectedRunEventKindSchema = z.enum(REJECTED_RUN_EVENT_KIND_VALUES);
export const RunEventKindSchema = z.enum(RUN_EVENT_KIND_VALUES);

export const MAILBOX_MESSAGE_KIND_VALUES = [
  'plan',
  'task',
  'completion',
  'plan_approval_request',
  'plan_approval_response',
  'final',
] as const;

export const TASK_STATE_VALUES = [
  'queued',
  'running',
  'blocked',
  'completed',
  'failed',
  'cancelled',
] as const;

export const RUN_COMPLETED_STATUS_VALUES = ['succeeded', 'failed', 'cancelled'] as const;
export const ARTIFACT_PUBLISHED_KIND_VALUES = ['final', 'intermediate'] as const;

export const MailboxMessageKindSchema = z.enum(MAILBOX_MESSAGE_KIND_VALUES);
export const TaskStateSchema = z.enum(TASK_STATE_VALUES);
export const RunCompletedStatusSchema = z.enum(RUN_COMPLETED_STATUS_VALUES);
export const ArtifactPublishedKindSchema = z.enum(ARTIFACT_PUBLISHED_KIND_VALUES);

export const BroadcastActorRefSchema = z.object({
  kind: z.literal('broadcast'),
});

export const RunStartedPayloadSchema = z.object({
  scenarioRef: z.string(),
  runProfileRef: z.string(),
  startedAt: z.string().datetime(),
});

export const RunCompletedPayloadSchema = z.object({
  status: RunCompletedStatusSchema,
  completedAt: z.string().datetime(),
  summary: z.string().nullable(),
});

export const MailboxMessageAppendedPayloadSchema = z.object({
  messageId: z.string(),
  fromActor: ActorRefSchema,
  toActor: z.union([ActorRefSchema, BroadcastActorRefSchema]),
  kind: MailboxMessageKindSchema,
  body: z.string(),
});

export const TaskCreatedPayloadSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  ownerActor: ActorRefSchema.nullable(),
  dependsOn: z.array(z.string()),
});

export const TaskStateChangedPayloadSchema = z.object({
  taskId: z.string(),
  from: TaskStateSchema,
  to: TaskStateSchema,
});

export const ArtifactPublishedPayloadSchema = z.object({
  artifactId: z.string(),
  kind: ArtifactPublishedKindSchema,
  mediaType: z.string(),
  byteSize: z.number().int().nonnegative(),
});

export const RequestRejectedPayloadSchema = z.object({
  rejectionReason: RejectionReasonSchema,
  rejectedRequestId: z.string().uuid(),
  detail: z.string(),
});

const RunEventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  runId: z.string(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  schemaVersion: SupportedSchemaVersionSchema,
  actor: ActorRefSchema,
  requestId: z.string().uuid().nullable(),
  causationId: z.string().uuid().nullable(),
  correlationId: z.string().nullable(),
  entityRef: EntityRefSchema,
  outcome: z.enum(['accepted', 'rejected']),
});

const AcceptedRunEventEnvelopeSchema = RunEventEnvelopeSchema.extend({
  outcome: z.literal('accepted'),
  requestId: z.string().uuid(),
});

const SystemAcceptedRunEventEnvelopeSchema = RunEventEnvelopeSchema.extend({
  outcome: z.literal('accepted'),
  actor: SystemActorRefSchema,
  requestId: z.null(),
});

export const RunStartedEventSchema = SystemAcceptedRunEventEnvelopeSchema.extend({
  kind: z.literal('run_started'),
  entityRef: RunEntityRefSchema,
  payload: RunStartedPayloadSchema,
});

export const RunCompletedEventSchema = AcceptedRunEventEnvelopeSchema.extend({
  kind: z.literal('run_completed'),
  entityRef: RunEntityRefSchema,
  payload: RunCompletedPayloadSchema,
});

export const MailboxMessageAppendedEventSchema = AcceptedRunEventEnvelopeSchema.extend({
  kind: z.literal('mailbox_message_appended'),
  entityRef: MailboxMessageEntityRefSchema,
  payload: MailboxMessageAppendedPayloadSchema,
});

export const TaskCreatedEventSchema = AcceptedRunEventEnvelopeSchema.extend({
  kind: z.literal('task_created'),
  entityRef: TaskEntityRefSchema,
  payload: TaskCreatedPayloadSchema,
});

export const TaskStateChangedEventSchema = AcceptedRunEventEnvelopeSchema.extend({
  kind: z.literal('task_state_changed'),
  entityRef: TaskEntityRefSchema,
  payload: TaskStateChangedPayloadSchema,
});

export const ArtifactPublishedEventSchema = AcceptedRunEventEnvelopeSchema.extend({
  kind: z.literal('artifact_published'),
  entityRef: ArtifactEntityRefSchema,
  payload: ArtifactPublishedPayloadSchema,
});

export const AcceptedRunEventSchema = z.discriminatedUnion('kind', [
  RunStartedEventSchema,
  RunCompletedEventSchema,
  MailboxMessageAppendedEventSchema,
  TaskCreatedEventSchema,
  TaskStateChangedEventSchema,
  ArtifactPublishedEventSchema,
]);

export const RequestRejectedEventSchema = RunEventEnvelopeSchema.extend({
  outcome: z.literal('rejected'),
  kind: z.literal('request_rejected'),
  requestId: z.string().uuid(),
  payload: RequestRejectedPayloadSchema,
});

export const RejectedRunEventSchema = RequestRejectedEventSchema;

export const RunEventSchema = z.discriminatedUnion('kind', [
  RunStartedEventSchema,
  RunCompletedEventSchema,
  MailboxMessageAppendedEventSchema,
  TaskCreatedEventSchema,
  TaskStateChangedEventSchema,
  ArtifactPublishedEventSchema,
  RequestRejectedEventSchema,
]);

export type AcceptedRunEventKind = z.infer<typeof AcceptedRunEventKindSchema>;
export type RejectedRunEventKind = z.infer<typeof RejectedRunEventKindSchema>;
export type RunEventKind = z.infer<typeof RunEventKindSchema>;
export type MailboxMessageKind = z.infer<typeof MailboxMessageKindSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export type RunCompletedStatus = z.infer<typeof RunCompletedStatusSchema>;
export type ArtifactPublishedKind = z.infer<typeof ArtifactPublishedKindSchema>;
export type BroadcastActorRef = z.infer<typeof BroadcastActorRefSchema>;

export type RunStartedPayload = z.infer<typeof RunStartedPayloadSchema>;
export type RunCompletedPayload = z.infer<typeof RunCompletedPayloadSchema>;
export type MailboxMessageAppendedPayload = z.infer<typeof MailboxMessageAppendedPayloadSchema>;
export type TaskCreatedPayload = z.infer<typeof TaskCreatedPayloadSchema>;
export type TaskStateChangedPayload = z.infer<typeof TaskStateChangedPayloadSchema>;
export type ArtifactPublishedPayload = z.infer<typeof ArtifactPublishedPayloadSchema>;
export type RequestRejectedPayload = z.infer<typeof RequestRejectedPayloadSchema>;

export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;
export type RunCompletedEvent = z.infer<typeof RunCompletedEventSchema>;
export type MailboxMessageAppendedEvent = z.infer<typeof MailboxMessageAppendedEventSchema>;
export type TaskCreatedEvent = z.infer<typeof TaskCreatedEventSchema>;
export type TaskStateChangedEvent = z.infer<typeof TaskStateChangedEventSchema>;
export type ArtifactPublishedEvent = z.infer<typeof ArtifactPublishedEventSchema>;
export type RequestRejectedEvent = z.infer<typeof RequestRejectedEventSchema>;

export type AcceptedRunEvent = z.infer<typeof AcceptedRunEventSchema>;
export type RejectedRunEvent = z.infer<typeof RejectedRunEventSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
