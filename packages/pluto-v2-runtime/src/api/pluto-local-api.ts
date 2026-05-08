import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { ACTOR_ROLE_VALUES, ActorRefSchema, type ActorRef } from '@pluto/v2-core';

import type { PlutoToolHandlers } from '../mcp/pluto-mcp-server.js';
import type { TurnLeaseStore } from '../mcp/turn-lease.js';
import type { PlutoToolResult, PlutoToolSession } from '../tools/pluto-tool-handlers.js';
import type { PlutoToolName } from '../tools/pluto-tool-schemas.js';

const ACTOR_HEADER = 'pluto-run-actor';

const MUTATING_TOOLS = new Set<PlutoToolName>([
  'pluto_create_task',
  'pluto_change_task_state',
  'pluto_append_mailbox_message',
  'pluto_publish_artifact',
  'pluto_complete_run',
]);

type LocalApiResponseKind = 'json' | 'artifact' | 'transcript';

type LocalApiRoute = {
  readonly toolName: PlutoToolName;
  readonly args: unknown;
  readonly responseKind: LocalApiResponseKind;
};

export interface PlutoLocalApiConfig {
  bindHost?: '127.0.0.1';
  port?: number;
  bearerToken: string;
  handlers: PlutoToolHandlers;
  leaseStore: TurnLeaseStore;
  onRequest?: (request: {
    method: string;
    path: string;
    toolName?: PlutoToolName;
    lease?: ActorRef;
  }) => void;
}

export interface PlutoLocalApiHandle {
  url: string;
  port: number;
  shutdown(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function writeText(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end(body);
}

function isLeadActor(actor: ActorRef): boolean {
  return actor.kind === 'role' && actor.role === 'lead';
}

function actorFromShorthand(value: string): ActorRef | null {
  const normalized = value.trim();
  if (normalized === 'manager') {
    return { kind: 'manager' };
  }

  if (normalized === 'system') {
    return { kind: 'system' };
  }

  const role = normalized.startsWith('role:') ? normalized.slice('role:'.length) : normalized;
  if ((ACTOR_ROLE_VALUES as readonly string[]).includes(role)) {
    return {
      kind: 'role',
      role: role as (typeof ACTOR_ROLE_VALUES)[number],
    };
  }

  return null;
}

function parseActorHeader(rawHeader: string | string[] | undefined):
  | { ok: true; actor: ActorRef }
  | { ok: false; message: string } {
  if (typeof rawHeader !== 'string' || rawHeader.trim() === '') {
    return {
      ok: false,
      message: `${ACTOR_HEADER} header is required.`,
    };
  }

  const shorthandActor = actorFromShorthand(rawHeader);
  if (shorthandActor != null) {
    return {
      ok: true,
      actor: shorthandActor,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawHeader);
  } catch {
    return {
      ok: false,
      message: `${ACTOR_HEADER} header must be valid ActorRef JSON or shorthand.`,
    };
  }

  if (typeof parsed === 'string') {
    const actor = actorFromShorthand(parsed);
    if (actor != null) {
      return {
        ok: true,
        actor,
      };
    }
  }

  const actor = ActorRefSchema.safeParse(parsed);
  if (!actor.success) {
    return {
      ok: false,
      message: `${ACTOR_HEADER} header must contain a valid ActorRef.`,
    };
  }

  return {
    ok: true,
    actor: actor.data,
  };
}

function parseJsonText(text: string): unknown {
  return JSON.parse(text);
}

function textFromToolResult(result: PlutoToolResult): string {
  if (!result.ok) {
    throw new Error('Expected an ok tool result.');
  }

  const content = (result.data as { content?: Array<{ type?: string; text?: string }> }).content;
  const firstChunk = content?.[0];
  if (firstChunk?.type !== 'text' || typeof firstChunk.text !== 'string') {
    throw new Error('Pluto tool result is missing its text payload.');
  }

  return firstChunk.text;
}

function statusCodeForToolError(result: Extract<PlutoToolResult, { ok: false }>): number {
  switch (result.error.code) {
    case 'PLUTO_TOOL_BAD_ARGS':
      return 400;
    case 'PLUTO_TOOL_LEAD_ONLY':
      return 403;
    case 'PLUTO_TOOL_INTERNAL':
      return 500;
    default:
      return 400;
  }
}

function routeFor(method: string, pathname: string, body: unknown): LocalApiRoute | null {
  switch (`${method} ${pathname}`) {
    case 'POST /v1/tools/create-task':
      return {
        toolName: 'pluto_create_task',
        args: body,
        responseKind: 'json',
      };
    case 'POST /v1/tools/change-task-state':
      return {
        toolName: 'pluto_change_task_state',
        args: body,
        responseKind: 'json',
      };
    case 'POST /v1/tools/append-mailbox-message':
      return {
        toolName: 'pluto_append_mailbox_message',
        args: body,
        responseKind: 'json',
      };
    case 'POST /v1/tools/publish-artifact':
      return {
        toolName: 'pluto_publish_artifact',
        args: body,
        responseKind: 'json',
      };
    case 'POST /v1/tools/complete-run':
      return {
        toolName: 'pluto_complete_run',
        args: body,
        responseKind: 'json',
      };
    case 'GET /v1/state':
      return {
        toolName: 'pluto_read_state',
        args: {},
        responseKind: 'json',
      };
  }

  if (method === 'GET' && pathname.startsWith('/v1/artifacts/')) {
    return {
      toolName: 'pluto_read_artifact',
      args: {
        artifactId: decodeURIComponent(pathname.slice('/v1/artifacts/'.length)),
      },
      responseKind: 'artifact',
    };
  }

  if (method === 'GET' && pathname.startsWith('/v1/transcripts/')) {
    return {
      toolName: 'pluto_read_transcript',
      args: {
        actorKey: decodeURIComponent(pathname.slice('/v1/transcripts/'.length)),
      },
      responseKind: 'transcript',
    };
  }

  return null;
}

async function readRouteBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== 'POST') {
    return undefined;
  }

  const text = await readBody(request);
  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text);
}

async function runRoute(args: {
  config: PlutoLocalApiConfig;
  route: LocalApiRoute;
  session: PlutoToolSession;
}): Promise<{ status: number; body: unknown; contentType: 'json' | 'text' }> {
  if (MUTATING_TOOLS.has(args.route.toolName) && !args.config.leaseStore.matches(args.session.currentActor)) {
    return {
      status: 409,
      body: {
        error: {
          code: 'PLUTO_LEASE_MISMATCH',
          message: `Lease mismatch for ${args.route.toolName}. Current mutating turn belongs to another actor.`,
          actor: args.session.currentActor,
          lease: args.config.leaseStore.current(),
        },
      },
      contentType: 'json',
    };
  }

  if (MUTATING_TOOLS.has(args.route.toolName) && !args.config.leaseStore.consumeMutation()) {
    return {
      status: 409,
      body: {
        error: {
          code: 'PLUTO_TURN_CONSUMED',
          message: 'First mutating tool call already consumed this turn.',
          actor: args.session.currentActor,
          lease: args.config.leaseStore.current(),
        },
      },
      contentType: 'json',
    };
  }

  const result = await args.config.handlers[args.route.toolName](args.session, args.route.args);
  if (!result.ok) {
    return {
      status: statusCodeForToolError(result),
      body: {
        error: result.error,
      },
      contentType: 'json',
    };
  }

  const text = textFromToolResult(result);
  switch (args.route.responseKind) {
    case 'json':
      return {
        status: 200,
        body: parseJsonText(text),
        contentType: 'json',
      };
    case 'artifact': {
      const payload = parseJsonText(text) as { body?: unknown };
      if (typeof payload.body !== 'string') {
        throw new Error('Artifact response is missing its sidecar body.');
      }
      return {
        status: 200,
        body: payload.body,
        contentType: 'text',
      };
    }
    case 'transcript':
      return {
        status: 200,
        body: text,
        contentType: 'text',
      };
  }
}

export async function startPlutoLocalApi(
  config: PlutoLocalApiConfig,
): Promise<PlutoLocalApiHandle> {
  const bindHost = config.bindHost ?? '127.0.0.1';
  if (bindHost !== '127.0.0.1') {
    throw new Error('Pluto local API must bind to 127.0.0.1 only.');
  }

  const port = config.port ?? 0;
  const requestId = randomUUID();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    if (!pathname.startsWith('/v1/')) {
      response.writeHead(404).end('not found');
      return;
    }

    if (request.headers.authorization !== `Bearer ${config.bearerToken}`) {
      writeJson(response, 401, { error: 'unauthorized' });
      return;
    }

    const parsedActor = parseActorHeader(request.headers[ACTOR_HEADER]);
    if (!parsedActor.ok) {
      writeJson(response, 403, {
        error: {
          code: 'PLUTO_ACTOR_REQUIRED',
          message: parsedActor.message,
        },
      });
      return;
    }

    let routeBody: unknown;
    try {
      routeBody = await readRouteBody(request);
    } catch {
      writeJson(response, 400, {
        error: {
          code: 'PLUTO_BAD_JSON',
          message: 'invalid json',
        },
      });
      return;
    }

    const route = routeFor(request.method ?? 'GET', pathname, routeBody);
    config.onRequest?.({
      method: request.method ?? 'GET',
      path: pathname,
      toolName: route?.toolName,
      lease: config.leaseStore.current() ?? undefined,
    });
    if (route == null) {
      response.writeHead(404, { 'x-pluto-request-id': requestId }).end('not found');
      return;
    }

    try {
      const result = await runRoute({
        config,
        route,
        session: {
          currentActor: parsedActor.actor,
          isLead: isLeadActor(parsedActor.actor),
        },
      });
      if (result.contentType === 'json') {
        writeJson(response, result.status, result.body);
        return;
      }

      writeText(response, result.status, String(result.body));
    } catch (error) {
      writeJson(response, 500, {
        error: {
          code: 'PLUTO_LOCAL_API_INTERNAL',
          message: error instanceof Error ? error.message : 'local api request failed',
        },
      });
    }
  });

  const started = await new Promise<{ port: number }>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve Pluto local API port.'));
        return;
      }

      resolve({ port: address.port });
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, bindHost);
  });

  let shutdownPromise: Promise<void> | null = null;

  return {
    url: `http://127.0.0.1:${started.port}/v1`,
    port: started.port,
    shutdown() {
      if (shutdownPromise) {
        return shutdownPromise;
      }

      shutdownPromise = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      return shutdownPromise;
    },
  };
}
