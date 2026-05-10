import type {
  ActorRef,
} from '@pluto/v2-core/actor-ref';
import type { RunKernel } from '@pluto/v2-core/core/run-kernel';
import type {
  AppendMailboxMessageRequest,
  CompleteRunRequest,
  CreateTaskRequest,
  ProtocolRequest,
  PublishArtifactRequest,
} from '@pluto/v2-core/protocol-request';
import type {
  RunEvent,
} from '@pluto/v2-core/run-event';
import type {
  SupportedSchemaVersion,
} from '@pluto/v2-core/versioning';

import {
  PlutoAppendMailboxMessageArgsSchema,
  PlutoChangeTaskStateArgsSchema,
  PlutoCompleteRunArgsSchema,
  PlutoCreateTaskArgsSchema,
  PlutoPublishArtifactArgsSchema,
  PlutoReadArtifactArgsSchema,
  PlutoReadStateArgsSchema,
  PlutoReadTranscriptArgsSchema,
  type PlutoCompleteRunArgs,
  type PlutoToolName,
} from './pluto-tool-schemas.js';

export interface PlutoToolHandlerDeps {
  kernel: RunKernel;
  runId: string;
  schemaVersion: SupportedSchemaVersion;
  clock: () => Date;
  idProvider: () => string;
  artifactSidecar: {
    write(artifactId: string, body: string | Uint8Array): Promise<string>;
    read(artifactId: string): Promise<{ path: string; body: string }>;
  };
  transcriptSidecar: {
    read(actorKey: string): Promise<string>;
  };
  promptViewer: {
    forActor(actor: ActorRef): unknown;
  };
}

export interface PlutoToolSession {
  currentActor: ActorRef;
  isLead: boolean;
  runDir?: string;
}

export type PlutoToolResult =
  | {
      ok: true;
      data: unknown;
    }
  | {
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };

type PlutoToolHandler = (session: PlutoToolSession, rawArgs: unknown) => Promise<PlutoToolResult>;
type SchemaIssue = { path: Array<string | number>; message: string };
type ParseResult<T> = { success: true; data: T } | { success: false; error: { issues: SchemaIssue[] } };
type ToolArgsSchema<T> = { safeParse(rawArgs: unknown): ParseResult<T> };

function summarizeSchemaError(error: { issues: SchemaIssue[] }): string {
  return error.issues
    .map((issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

function okText(text: string): PlutoToolResult {
  return {
    ok: true,
    data: {
      content: [{ type: 'text', text }],
    },
  };
}

function okJson(value: unknown): PlutoToolResult {
  return okText(JSON.stringify(value));
}

function errorResult(code: string, message: string, details?: unknown): PlutoToolResult {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function parseArgs<TArgs>(schema: ToolArgsSchema<TArgs>, rawArgs: unknown):
  | { ok: true; data: TArgs }
  | { ok: false; result: PlutoToolResult } {
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      ok: false,
      result: errorResult('PLUTO_TOOL_BAD_ARGS', summarizeSchemaError(parsed.error), parsed.error.issues),
    };
  }

  return {
    ok: true,
    data: parsed.data,
  };
}

function buildRequestEnvelope(
  deps: PlutoToolHandlerDeps,
  actor: ActorRef,
): Pick<ProtocolRequest, 'requestId' | 'runId' | 'actor' | 'idempotencyKey' | 'clientTimestamp' | 'schemaVersion'> {
  return {
    requestId: deps.idProvider(),
    runId: deps.runId,
    actor,
    idempotencyKey: null,
    clientTimestamp: deps.clock().toISOString(),
    schemaVersion: deps.schemaVersion,
  };
}

function buildManagerOwnedCompleteRunRequest(
  deps: PlutoToolHandlerDeps,
  payload: PlutoCompleteRunArgs,
): CompleteRunRequest {
  return {
    ...buildRequestEnvelope(deps, { kind: 'manager' }),
    intent: 'complete_run',
    payload: {
      status: payload.status,
      summary: payload.summary,
    },
  };
}

function acceptedResult(event: RunEvent, expectedKind: RunEvent['kind']): PlutoToolResult {
  if (event.kind === 'request_rejected') {
    return okJson({
      accepted: false,
      reason: event.payload.rejectionReason,
      details: event.payload.detail,
    });
  }

  if (event.kind !== expectedKind) {
    return errorResult('PLUTO_TOOL_INTERNAL', `Expected ${expectedKind}, received ${event.kind}.`, {
      expectedKind,
      actualKind: event.kind,
    });
  }

  const result: Record<string, unknown> = {
    accepted: true,
    eventId: event.eventId,
    sequence: event.sequence,
  };

  if (event.kind === 'task_created') {
    result.taskId = event.payload.taskId;
  }

  if (event.kind === 'artifact_published') {
    result.artifactId = event.payload.artifactId;
  }

  return okJson(result);
}

function acceptedResultWithPath(event: RunEvent, path: string): PlutoToolResult {
  if (event.kind === 'request_rejected') {
    return acceptedResult(event, 'artifact_published');
  }

  if (event.kind !== 'artifact_published') {
    return acceptedResult(event, 'artifact_published');
  }

  return okJson({
    accepted: true,
    eventId: event.eventId,
    sequence: event.sequence,
    artifactId: event.payload.artifactId,
    path,
  });
}

export function makePlutoToolHandlers(deps: PlutoToolHandlerDeps): Record<PlutoToolName, PlutoToolHandler> {
  const submit = (request: ProtocolRequest) => deps.kernel.submit(request).event;

  return {
    async pluto_create_task(session, rawArgs) {
      try {
        const parsed = parseArgs(PlutoCreateTaskArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }

        const request: CreateTaskRequest = {
          ...buildRequestEnvelope(deps, session.currentActor),
          intent: 'create_task',
          payload: parsed.data,
        };

        return acceptedResult(submit(request), 'task_created');
      } catch (error) {
        return errorResult('PLUTO_TOOL_INTERNAL', 'create_task failed.', error);
      }
    },

    async pluto_change_task_state(session, rawArgs) {
      try {
        const parsed = parseArgs(PlutoChangeTaskStateArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }

        const request: Extract<ProtocolRequest, { intent: 'change_task_state' }> = {
          ...buildRequestEnvelope(deps, session.currentActor),
          intent: 'change_task_state',
          payload: parsed.data,
        };

        return acceptedResult(submit(request), 'task_state_changed');
      } catch (error) {
        return errorResult('PLUTO_TOOL_INTERNAL', 'change_task_state failed.', error);
      }
    },

    async pluto_append_mailbox_message(session, rawArgs) {
      try {
        const parsed = parseArgs(PlutoAppendMailboxMessageArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }

        const request: AppendMailboxMessageRequest = {
          ...buildRequestEnvelope(deps, session.currentActor),
          intent: 'append_mailbox_message',
          payload: {
            fromActor: session.currentActor,
            toActor: parsed.data.toActor,
            kind: parsed.data.kind,
            body: parsed.data.body,
          },
        };

        return acceptedResult(submit(request), 'mailbox_message_appended');
      } catch (error) {
        return errorResult('PLUTO_TOOL_INTERNAL', 'append_mailbox_message failed.', error);
      }
    },

    async pluto_publish_artifact(session, rawArgs) {
      try {
        const parsed = parseArgs(PlutoPublishArtifactArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }

        const { body, ...payload } = parsed.data;
        const request: PublishArtifactRequest = {
          ...buildRequestEnvelope(deps, session.currentActor),
          intent: 'publish_artifact',
          payload,
        };

        const event = submit(request);
        if (body === undefined || event.kind !== 'artifact_published') {
          return acceptedResult(event, 'artifact_published');
        }

        const path = await deps.artifactSidecar.write(event.payload.artifactId, body);
        return acceptedResultWithPath(event, path);
      } catch (error) {
        return errorResult('PLUTO_TOOL_INTERNAL', 'publish_artifact failed.', error);
      }
    },

    async pluto_complete_run(session, rawArgs) {
      try {
        const parsed = parseArgs(PlutoCompleteRunArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }

        if (!session.isLead) {
          return errorResult(
            'PLUTO_TOOL_LEAD_ONLY',
            'complete_run is only available to the lead session.',
          );
        }

        return acceptedResult(submit(buildManagerOwnedCompleteRunRequest(deps, parsed.data)), 'run_completed');
      } catch (error) {
        return errorResult('PLUTO_TOOL_INTERNAL', 'complete_run failed.', error);
      }
    },

    async pluto_read_state(session, rawArgs) {
      try {
        const parsed = parseArgs(PlutoReadStateArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }

        return okJson(deps.promptViewer.forActor(session.currentActor));
      } catch (error) {
        return errorResult('PLUTO_TOOL_INTERNAL', 'read_state failed.', error);
      }
    },

    async pluto_read_artifact(_session, rawArgs) {
      try {
        const parsed = parseArgs(PlutoReadArtifactArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }

        return okJson(await deps.artifactSidecar.read(parsed.data.artifactId));
      } catch (error) {
        return errorResult('PLUTO_TOOL_INTERNAL', 'read_artifact failed.', error);
      }
    },

    async pluto_read_transcript(_session, rawArgs) {
      try {
        const parsed = parseArgs(PlutoReadTranscriptArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }

        return okText(await deps.transcriptSidecar.read(parsed.data.actorKey));
      } catch (error) {
        return errorResult('PLUTO_TOOL_INTERNAL', 'read_transcript failed.', error);
      }
    },
  };
}
