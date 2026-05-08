import {
  ACTOR_ROLE_VALUES,
  ARTIFACT_PUBLISHED_KIND_VALUES,
  AppendMailboxMessageRequestPayloadSchema,
  CompleteRunRequestPayloadSchema,
  CreateTaskRequestPayloadSchema,
  ChangeTaskStateRequestPayloadSchema,
  MAILBOX_MESSAGE_KIND_VALUES,
  PublishArtifactRequestPayloadSchema,
  RUN_COMPLETED_STATUS_VALUES,
  TASK_STATE_VALUES,
} from '@pluto/v2-core';
import { z } from 'zod';

export const PlutoCreateTaskArgsSchema = CreateTaskRequestPayloadSchema.pick({
  title: true,
  ownerActor: true,
  dependsOn: true,
});

export const PlutoChangeTaskStateArgsSchema = ChangeTaskStateRequestPayloadSchema.pick({
  taskId: true,
  to: true,
});

export const PlutoAppendMailboxMessageArgsSchema = AppendMailboxMessageRequestPayloadSchema.omit({
  fromActor: true,
});

export const PlutoPublishArtifactArgsSchema = PublishArtifactRequestPayloadSchema.pick({
  kind: true,
  mediaType: true,
  byteSize: true,
}).extend({
  body: z.string().optional(),
});

export const PlutoCompleteRunArgsSchema = CompleteRunRequestPayloadSchema.pick({
  status: true,
  summary: true,
});

export const PlutoReadStateArgsSchema = z.object({}).strict();

export const PlutoReadArtifactArgsSchema = z
  .object({
    artifactId: z.string().uuid(),
  })
  .strict();

export const PlutoReadTranscriptArgsSchema = z
  .object({
    actorKey: z.string().min(1),
  })
  .strict();

export type PlutoCreateTaskArgs = z.infer<typeof PlutoCreateTaskArgsSchema>;
export type PlutoChangeTaskStateArgs = z.infer<typeof PlutoChangeTaskStateArgsSchema>;
export type PlutoAppendMailboxMessageArgs = z.infer<typeof PlutoAppendMailboxMessageArgsSchema>;
export type PlutoPublishArtifactArgs = z.infer<typeof PlutoPublishArtifactArgsSchema>;
export type PlutoCompleteRunArgs = z.infer<typeof PlutoCompleteRunArgsSchema>;
export type PlutoReadStateArgs = z.infer<typeof PlutoReadStateArgsSchema>;
export type PlutoReadArtifactArgs = z.infer<typeof PlutoReadArtifactArgsSchema>;
export type PlutoReadTranscriptArgs = z.infer<typeof PlutoReadTranscriptArgsSchema>;

export const PLUTO_TOOL_NAMES = [
  'pluto_create_task',
  'pluto_change_task_state',
  'pluto_append_mailbox_message',
  'pluto_publish_artifact',
  'pluto_complete_run',
  'pluto_read_state',
  'pluto_read_artifact',
  'pluto_read_transcript',
] as const;

export type PlutoToolName = (typeof PLUTO_TOOL_NAMES)[number];

export const PLUTO_TOOL_ARG_SCHEMAS = {
  pluto_create_task: PlutoCreateTaskArgsSchema,
  pluto_change_task_state: PlutoChangeTaskStateArgsSchema,
  pluto_append_mailbox_message: PlutoAppendMailboxMessageArgsSchema,
  pluto_publish_artifact: PlutoPublishArtifactArgsSchema,
  pluto_complete_run: PlutoCompleteRunArgsSchema,
  pluto_read_state: PlutoReadStateArgsSchema,
  pluto_read_artifact: PlutoReadArtifactArgsSchema,
  pluto_read_transcript: PlutoReadTranscriptArgsSchema,
} satisfies Record<PlutoToolName, z.ZodTypeAny>;

type JsonSchema = {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'null';
  readonly description?: string;
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly enum?: readonly string[];
  readonly anyOf?: readonly JsonSchema[];
  readonly items?: JsonSchema;
  readonly format?: string;
  readonly minimum?: number;
};

export interface PlutoToolDescriptor {
  readonly name: PlutoToolName;
  readonly description: string;
  readonly argsSchema: z.ZodTypeAny;
  readonly inputSchema: JsonSchema;
}

const ACTOR_REF_JSON_SCHEMA: JsonSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['manager'],
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['role'],
        },
        role: {
          type: 'string',
          enum: ACTOR_ROLE_VALUES,
        },
      },
      required: ['kind', 'role'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['system'],
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  ],
};

const ACTOR_OR_BROADCAST_JSON_SCHEMA: JsonSchema = {
  anyOf: [
    ACTOR_REF_JSON_SCHEMA,
    {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['broadcast'],
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  ],
};

function objectSchema(properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function toolDescriptor(
  name: PlutoToolName,
  description: string,
  argsSchema: z.ZodTypeAny,
  inputSchema: JsonSchema,
): PlutoToolDescriptor {
  return {
    name,
    description,
    argsSchema,
    inputSchema,
  };
}

export const PLUTO_TOOL_DESCRIPTORS = [
  toolDescriptor(
    'pluto_create_task',
    'Create a Pluto task in the active run.',
    PlutoCreateTaskArgsSchema,
    objectSchema(
      {
        title: { type: 'string' },
        ownerActor: {
          anyOf: [ACTOR_REF_JSON_SCHEMA, { type: 'null' }],
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      ['title', 'ownerActor', 'dependsOn'],
    ),
  ),
  toolDescriptor(
    'pluto_change_task_state',
    'Change the state of an existing Pluto task.',
    PlutoChangeTaskStateArgsSchema,
    objectSchema(
      {
        taskId: { type: 'string' },
        to: { type: 'string', enum: TASK_STATE_VALUES },
      },
      ['taskId', 'to'],
    ),
  ),
  toolDescriptor(
    'pluto_append_mailbox_message',
    'Append a mailbox message for another Pluto actor.',
    PlutoAppendMailboxMessageArgsSchema,
    objectSchema(
      {
        toActor: ACTOR_OR_BROADCAST_JSON_SCHEMA,
        kind: { type: 'string', enum: MAILBOX_MESSAGE_KIND_VALUES },
        body: { type: 'string' },
      },
      ['toActor', 'kind', 'body'],
    ),
  ),
  toolDescriptor(
    'pluto_publish_artifact',
    'Publish an artifact for the active Pluto run.',
    PlutoPublishArtifactArgsSchema,
    objectSchema(
      {
        kind: { type: 'string', enum: ARTIFACT_PUBLISHED_KIND_VALUES },
        mediaType: { type: 'string' },
        byteSize: { type: 'integer', minimum: 0 },
        body: { type: 'string' },
      },
      ['kind', 'mediaType', 'byteSize'],
    ),
  ),
  toolDescriptor(
    'pluto_complete_run',
    'Mark the active Pluto run as completed.',
    PlutoCompleteRunArgsSchema,
    objectSchema(
      {
        status: { type: 'string', enum: RUN_COMPLETED_STATUS_VALUES },
        summary: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      ['status', 'summary'],
    ),
  ),
  toolDescriptor(
    'pluto_read_state',
    'Read the current PromptView for the active actor.',
    PlutoReadStateArgsSchema,
    objectSchema({}, []),
  ),
  toolDescriptor(
    'pluto_read_artifact',
    'Read an artifact sidecar by artifact id.',
    PlutoReadArtifactArgsSchema,
    objectSchema(
      {
        artifactId: { type: 'string', format: 'uuid' },
      },
      ['artifactId'],
    ),
  ),
  toolDescriptor(
    'pluto_read_transcript',
    'Read a transcript sidecar by actor key.',
    PlutoReadTranscriptArgsSchema,
    objectSchema(
      {
        actorKey: { type: 'string' },
      },
      ['actorKey'],
    ),
  ),
] as const satisfies readonly PlutoToolDescriptor[];
