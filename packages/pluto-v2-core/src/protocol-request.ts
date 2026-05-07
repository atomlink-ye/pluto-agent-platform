import { z } from 'zod';

import { ActorRefSchema } from './actor-ref.js';
import {
  ArtifactPublishedPayloadSchema,
  MailboxMessageAppendedPayloadSchema,
  RunCompletedPayloadSchema,
  TaskCreatedPayloadSchema,
  TaskStateChangedPayloadSchema,
} from './run-event.js';
import { SupportedSchemaVersionSchema } from './versioning.js';

export const PROTOCOL_REQUEST_INTENT_VALUES = [
  'append_mailbox_message',
  'create_task',
  'change_task_state',
  'publish_artifact',
  'complete_run',
] as const;

export const ProtocolRequestIntentSchema = z.enum(PROTOCOL_REQUEST_INTENT_VALUES);

export const AppendMailboxMessageRequestPayloadSchema = MailboxMessageAppendedPayloadSchema.omit({
  messageId: true,
});

export const CreateTaskRequestPayloadSchema = TaskCreatedPayloadSchema.omit({
  taskId: true,
});

export const ChangeTaskStateRequestPayloadSchema = TaskStateChangedPayloadSchema.omit({
  from: true,
});

export const PublishArtifactRequestPayloadSchema = ArtifactPublishedPayloadSchema.omit({
  artifactId: true,
});

export const CompleteRunRequestPayloadSchema = RunCompletedPayloadSchema.omit({
  completedAt: true,
});

const ProtocolRequestEnvelopeSchema = z.object({
  requestId: z.string().uuid(),
  runId: z.string(),
  actor: ActorRefSchema,
  idempotencyKey: z.string().nullable(),
  clientTimestamp: z.string().datetime(),
  schemaVersion: SupportedSchemaVersionSchema,
});

export const AppendMailboxMessageRequestSchema = ProtocolRequestEnvelopeSchema.extend({
  intent: z.literal('append_mailbox_message'),
  payload: AppendMailboxMessageRequestPayloadSchema,
});

export const CreateTaskRequestSchema = ProtocolRequestEnvelopeSchema.extend({
  intent: z.literal('create_task'),
  payload: CreateTaskRequestPayloadSchema,
});

export const ChangeTaskStateRequestSchema = ProtocolRequestEnvelopeSchema.extend({
  intent: z.literal('change_task_state'),
  payload: ChangeTaskStateRequestPayloadSchema,
});

export const PublishArtifactRequestSchema = ProtocolRequestEnvelopeSchema.extend({
  intent: z.literal('publish_artifact'),
  payload: PublishArtifactRequestPayloadSchema,
});

export const CompleteRunRequestSchema = ProtocolRequestEnvelopeSchema.extend({
  intent: z.literal('complete_run'),
  payload: CompleteRunRequestPayloadSchema,
});

export const ProtocolRequestSchema = z.discriminatedUnion('intent', [
  AppendMailboxMessageRequestSchema,
  CreateTaskRequestSchema,
  ChangeTaskStateRequestSchema,
  PublishArtifactRequestSchema,
  CompleteRunRequestSchema,
]);

export type ProtocolRequestIntent = z.infer<typeof ProtocolRequestIntentSchema>;

export type AppendMailboxMessageRequestPayload = z.infer<
  typeof AppendMailboxMessageRequestPayloadSchema
>;
export type CreateTaskRequestPayload = z.infer<typeof CreateTaskRequestPayloadSchema>;
export type ChangeTaskStateRequestPayload = z.infer<typeof ChangeTaskStateRequestPayloadSchema>;
export type PublishArtifactRequestPayload = z.infer<typeof PublishArtifactRequestPayloadSchema>;
export type CompleteRunRequestPayload = z.infer<typeof CompleteRunRequestPayloadSchema>;

export type AppendMailboxMessageRequest = z.infer<typeof AppendMailboxMessageRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type ChangeTaskStateRequest = z.infer<typeof ChangeTaskStateRequestSchema>;
export type PublishArtifactRequest = z.infer<typeof PublishArtifactRequestSchema>;
export type CompleteRunRequest = z.infer<typeof CompleteRunRequestSchema>;
export type ProtocolRequest = z.infer<typeof ProtocolRequestSchema>;
