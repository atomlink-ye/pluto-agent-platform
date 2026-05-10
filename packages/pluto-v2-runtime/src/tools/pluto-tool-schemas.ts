import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { infer as Infer, ZodTypeAny } from 'zod';

const require = createRequire(import.meta.url);
const zodPackageDir = dirname(require.resolve('zod'));
const { z } = require(join(zodPackageDir, 'v3', 'index.cjs')) as {
  z: typeof import('zod')['z'];
};

const ACTOR_ROLE_PATTERN = '^[a-z][a-z0-9_-]*$';
const ACTOR_ROLE_VALUES = ['lead', 'planner', 'generator', 'evaluator'] as const;
const ARTIFACT_PUBLISHED_KIND_VALUES = ['final', 'intermediate'] as const;
const MAILBOX_MESSAGE_KIND_VALUES = [
  'plan',
  'task',
  'completion',
  'plan_approval_request',
  'plan_approval_response',
  'final',
] as const;
const RUN_COMPLETED_STATUS_VALUES = ['succeeded', 'failed', 'cancelled'] as const;
const TASK_STATE_VALUES = ['queued', 'running', 'blocked', 'completed', 'failed', 'cancelled'] as const;

const PlutoActorRoleSchema = z.string().max(64).regex(new RegExp(ACTOR_ROLE_PATTERN));

const PlutoManagerActorRefSchema = z.object({
  kind: z.literal('manager'),
});

const PlutoRoleActorRefSchema = z.object({
  kind: z.literal('role'),
  role: PlutoActorRoleSchema,
});

const PlutoSystemActorRefSchema = z.object({
  kind: z.literal('system'),
});

const PlutoBroadcastActorRefSchema = z.object({
  kind: z.literal('broadcast'),
});

const PlutoActorRefSchema = z.discriminatedUnion('kind', [
  PlutoManagerActorRefSchema,
  PlutoRoleActorRefSchema,
  PlutoSystemActorRefSchema,
]);

const PlutoActorOrBroadcastSchema = z.discriminatedUnion('kind', [
  PlutoManagerActorRefSchema,
  PlutoRoleActorRefSchema,
  PlutoSystemActorRefSchema,
  PlutoBroadcastActorRefSchema,
]);

export const PlutoCreateTaskArgsSchema = z.object({
  title: z.string(),
  ownerActor: PlutoActorRefSchema.nullable(),
  dependsOn: z.array(z.string()),
});

export const PlutoChangeTaskStateArgsSchema = z.object({
  taskId: z.string(),
  to: z.enum(TASK_STATE_VALUES),
});

export const PlutoAppendMailboxMessageArgsSchema = z.object({
  toActor: PlutoActorOrBroadcastSchema,
  kind: z.enum(MAILBOX_MESSAGE_KIND_VALUES),
  body: z.string(),
});

export const PlutoPublishArtifactArgsSchema = z.object({
  kind: z.enum(ARTIFACT_PUBLISHED_KIND_VALUES),
  mediaType: z.string(),
  byteSize: z.number().int().nonnegative(),
  body: z.string().optional(),
});

export const PlutoCompleteRunArgsSchema = z.object({
  status: z.enum(RUN_COMPLETED_STATUS_VALUES),
  summary: z.string().nullable(),
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

export type PlutoCreateTaskArgs = Infer<typeof PlutoCreateTaskArgsSchema>;
export type PlutoChangeTaskStateArgs = Infer<typeof PlutoChangeTaskStateArgsSchema>;
export type PlutoAppendMailboxMessageArgs = Infer<typeof PlutoAppendMailboxMessageArgsSchema>;
export type PlutoPublishArtifactArgs = Infer<typeof PlutoPublishArtifactArgsSchema>;
export type PlutoCompleteRunArgs = Infer<typeof PlutoCompleteRunArgsSchema>;
export type PlutoReadStateArgs = Infer<typeof PlutoReadStateArgsSchema>;
export type PlutoReadArtifactArgs = Infer<typeof PlutoReadArtifactArgsSchema>;
export type PlutoReadTranscriptArgs = Infer<typeof PlutoReadTranscriptArgsSchema>;

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
} satisfies Record<PlutoToolName, ZodTypeAny>;

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
  readonly pattern?: string;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly minimum?: number;
};

export interface PlutoToolDescriptor {
  readonly name: PlutoToolName;
  readonly description: string;
  readonly argsSchema: ZodTypeAny;
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
          pattern: ACTOR_ROLE_PATTERN,
          maxLength: 64,
          description: `Built-in defaults: ${ACTOR_ROLE_VALUES.join(' | ')}. Custom authored roles are also accepted when the run policy declares them.`,
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
  argsSchema: ZodTypeAny,
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
        actorKey: { type: 'string', minLength: 1 },
      },
      ['actorKey'],
    ),
  ),
] as const satisfies readonly PlutoToolDescriptor[];
