import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { ActorRefSchema, type ActorRef } from '@pluto/v2-core';

import type { PlutoToolResult, PlutoToolSession } from '../tools/pluto-tool-handlers.js';
import { PLUTO_TOOL_DESCRIPTORS, PLUTO_TOOL_NAMES, type PlutoToolName } from '../tools/pluto-tool-schemas.js';
import type { TurnLeaseStore } from './turn-lease.js';

const DEFAULT_PROTOCOL_VERSION = '2025-11-25';
const ACTOR_HEADER = 'pluto-run-actor';

const MUTATING_TOOLS = new Set<PlutoToolName>([
  'pluto_create_task',
  'pluto_change_task_state',
  'pluto_append_mailbox_message',
  'pluto_publish_artifact',
  'pluto_complete_run',
]);

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  readonly jsonrpc?: string;
  readonly id?: JsonRpcId;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

export type PlutoToolHandlers = Record<
  PlutoToolName,
  (session: PlutoToolSession, rawArgs: unknown) => Promise<PlutoToolResult>
>;

export interface PlutoMcpServerConfig {
  bindHost?: '127.0.0.1';
  port?: number;
  bearerToken: string;
  handlers: PlutoToolHandlers;
  leaseStore: TurnLeaseStore;
  onRequest?: (req: { method: string; toolName?: string; lease?: ActorRef }) => void;
}

export interface PlutoMcpServerHandle {
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

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function rpcResult(id: JsonRpcId | undefined, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined && typeof request.method === 'string' && request.method.startsWith('notifications/');
}

function isPlutoToolName(value: unknown): value is PlutoToolName {
  return typeof value === 'string' && PLUTO_TOOL_NAMES.includes(value as PlutoToolName);
}

function isLeadActor(actor: ActorRef): boolean {
  return actor.kind === 'role' && actor.role === 'lead';
}

function parseActorHeader(rawHeader: string | string[] | undefined):
  | { ok: true; actor: ActorRef }
  | { ok: false; message: string } {
  if (typeof rawHeader !== 'string' || rawHeader.trim() === '') {
    return {
      ok: false,
      message: `${ACTOR_HEADER} header is required for tools/call.`,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawHeader);
  } catch {
    return {
      ok: false,
      message: `${ACTOR_HEADER} header must be valid JSON.`,
    };
  }

  const parsedActor = ActorRefSchema.safeParse(parsedJson);
  if (!parsedActor.success) {
    return {
      ok: false,
      message: `${ACTOR_HEADER} header must contain a valid ActorRef.`,
    };
  }

  return {
    ok: true,
    actor: parsedActor.data,
  };
}

function toRpcToolError(id: JsonRpcId | undefined, result: Extract<PlutoToolResult, { ok: false }>): JsonRpcResponse {
  return rpcError(id, -32003, `${result.error.code}: ${result.error.message}`, result.error);
}

export async function startPlutoMcpServer(
  config: PlutoMcpServerConfig,
): Promise<PlutoMcpServerHandle> {
  const bindHost = config.bindHost ?? '127.0.0.1';
  if (bindHost !== '127.0.0.1') {
    throw new Error('Pluto MCP server must bind to 127.0.0.1 only.');
  }

  const port = config.port ?? 0;
  const sessionId = randomUUID();
  let negotiatedProtocolVersion = DEFAULT_PROTOCOL_VERSION;

  const server = createServer(async (request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end('not found');
      return;
    }

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end('method not allowed');
      return;
    }

    if (request.headers.authorization !== `Bearer ${config.bearerToken}`) {
      writeJson(response, 401, { error: 'unauthorized' });
      return;
    }

    const requestedProtocolVersion = request.headers['mcp-protocol-version'];
    if (typeof requestedProtocolVersion === 'string' && requestedProtocolVersion.trim() !== '') {
      negotiatedProtocolVersion = requestedProtocolVersion;
    }

    const responseHeaders = {
      'MCP-Protocol-Version': negotiatedProtocolVersion,
      'MCP-Session-Id': sessionId,
    };

    let payload: unknown;
    try {
      payload = JSON.parse(await readBody(request));
    } catch {
      writeJson(response, 400, { error: 'invalid json' }, responseHeaders);
      return;
    }

    const actorHeader = request.headers[ACTOR_HEADER];

    const messages = Array.isArray(payload) ? payload : [payload];
    const responses = await Promise.all(
      messages.map(async (message): Promise<JsonRpcResponse | null> => {
        if (!message || typeof message !== 'object') {
          return rpcError(null, -32600, 'Invalid Request');
        }

        const rpcRequest = message as JsonRpcRequest;
        if (typeof rpcRequest.method !== 'string' || rpcRequest.method.length === 0) {
          return rpcError(rpcRequest.id, -32600, 'Invalid Request');
        }

        const toolName = rpcRequest.method === 'tools/call' && isPlutoToolName(rpcRequest.params?.name)
          ? rpcRequest.params.name
          : undefined;
        config.onRequest?.({
          method: rpcRequest.method,
          toolName,
          lease: config.leaseStore.current() ?? undefined,
        });

        if (rpcRequest.method === 'notifications/initialized' || isNotification(rpcRequest)) {
          return null;
        }

        switch (rpcRequest.method) {
          case 'initialize':
            return rpcResult(rpcRequest.id, {
              protocolVersion: negotiatedProtocolVersion,
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'pluto-mcp-server',
                version: '0.1.0',
              },
            });
          case 'tools/list':
            return rpcResult(rpcRequest.id, {
              tools: PLUTO_TOOL_DESCRIPTORS.map((descriptor) => ({
                name: descriptor.name,
                description: descriptor.description,
                inputSchema: descriptor.inputSchema,
              })),
            });
          case 'tools/call': {
            const requestedToolName = rpcRequest.params?.name;
            if (!isPlutoToolName(requestedToolName)) {
              return rpcError(rpcRequest.id, -32602, `Unknown tool: ${String(requestedToolName)}`);
            }

            const parsedActor = parseActorHeader(actorHeader);
            if (!parsedActor.ok) {
              return rpcError(rpcRequest.id, -32002, parsedActor.message);
            }

            if (MUTATING_TOOLS.has(requestedToolName) && !config.leaseStore.matches(parsedActor.actor)) {
              return rpcError(
                rpcRequest.id,
                -32001,
                `Lease mismatch for ${requestedToolName}. Current mutating turn belongs to another actor.`,
                {
                  actor: parsedActor.actor,
                  lease: config.leaseStore.current(),
                },
              );
            }

            const toolResult = await config.handlers[requestedToolName](
              {
                currentActor: parsedActor.actor,
                isLead: isLeadActor(parsedActor.actor),
              },
              rpcRequest.params?.arguments ?? {},
            );

            if (!toolResult.ok) {
              return toRpcToolError(rpcRequest.id, toolResult);
            }

            return rpcResult(rpcRequest.id, toolResult.data);
          }
          default:
            return rpcError(rpcRequest.id, -32601, `Unsupported method: ${rpcRequest.method}`);
        }
      }),
    );

    const filteredResponses = responses.filter((item): item is JsonRpcResponse => item !== null);
    if (filteredResponses.length === 0) {
      response.writeHead(202, responseHeaders);
      response.end();
      return;
    }

    writeJson(
      response,
      200,
      filteredResponses.length === 1 ? filteredResponses[0] : filteredResponses,
      responseHeaders,
    );
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
        reject(new Error('Failed to resolve Pluto MCP server port.'));
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
    url: `http://127.0.0.1:${started.port}/mcp`,
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
