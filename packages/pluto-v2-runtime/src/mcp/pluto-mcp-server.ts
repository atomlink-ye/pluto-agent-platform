import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { ActorRefSchema, type ActorRef } from '@pluto/v2-core/actor-ref';

import type { WaitRegistry } from '../api/wait-registry.js';
import type { PlutoToolResult, PlutoToolSession } from '../tools/pluto-tool-handlers.js';
import { PLUTO_TOOL_DESCRIPTORS, PLUTO_TOOL_NAMES, type PlutoToolName } from '../tools/pluto-tool-schemas.js';
import type { TurnLeaseStore } from './turn-lease.js';

const DEFAULT_PROTOCOL_VERSION = '2025-11-25';
const ACTOR_HEADER = 'pluto-run-actor';
const TURN_CONSUMED_RPC_ERROR_CODE = -32004;
const TURN_CONSUMED_ERROR = 'PLUTO_TURN_CONSUMED';
const WAIT_TOOL_NAME = 'pluto_wait_for_event';
const WAIT_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    timeoutSec: {
      type: 'integer',
      minimum: 0,
      maximum: 1200,
    },
  },
  additionalProperties: false,
} as const;

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
  waitService?: {
    registry: WaitRegistry;
    cursorForActor(actor: ActorRef): number;
    onEventDelivered(actor: ActorRef, sequence: number): void;
    defaultTimeoutSec?: number;
    maxTimeoutSec?: number;
    disconnectReason?: string;
    shutdownSignal?: AbortSignal;
    shutdownReason?: string;
  };
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

function isSupportedToolName(value: unknown): value is PlutoToolName | typeof WAIT_TOOL_NAME {
  return isPlutoToolName(value) || value === WAIT_TOOL_NAME;
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

function parseWaitTimeoutSec(rawArgs: unknown, defaults?: { defaultTimeoutSec?: number; maxTimeoutSec?: number }): number {
  const defaultTimeoutSec = defaults?.defaultTimeoutSec ?? 300;
  const maxTimeoutSec = defaults?.maxTimeoutSec ?? 1200;
  if (rawArgs == null) {
    return defaultTimeoutSec;
  }

  if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new Error('wait arguments must be a JSON object');
  }

  const timeoutSec = (rawArgs as { timeoutSec?: unknown }).timeoutSec;
  if (timeoutSec == null) {
    return defaultTimeoutSec;
  }

  if (typeof timeoutSec !== 'number' || !Number.isInteger(timeoutSec) || timeoutSec < 0 || timeoutSec > maxTimeoutSec) {
    throw new Error(`timeoutSec must be an integer between 0 and ${maxTimeoutSec}`);
  }

  return timeoutSec;
}

function waitToolResult(body: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
  };
}

type LeaseWaitResult =
  | { ok: true }
  | { ok: false; reason: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function abortReason(signal: AbortSignal, fallback: string): string {
  return typeof signal.reason === 'string' && signal.reason.length > 0 ? signal.reason : fallback;
}

function waitForAbort(signal: AbortSignal, fallback: string): Promise<string> {
  if (signal.aborted) {
    return Promise.resolve(abortReason(signal, fallback));
  }

  return new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve(abortReason(signal, fallback));
    }, { once: true });
  });
}

async function waitForLease(args: {
  leaseStore: TurnLeaseStore;
  actor: ActorRef;
  response: ServerResponse;
  disconnectReason: string;
  shutdownSignal?: AbortSignal;
  shutdownReason?: string;
}): Promise<LeaseWaitResult> {
  const shutdownPromise = args.shutdownSignal == null
    ? null
    : waitForAbort(args.shutdownSignal, args.shutdownReason ?? 'run_shutdown');

  while (!args.leaseStore.matches(args.actor)) {
    if (args.response.writableEnded || args.response.destroyed) {
      return {
        ok: false,
        reason: args.disconnectReason,
      };
    }

    if (shutdownPromise == null) {
      await sleep(5);
      continue;
    }

    const shutdown = await Promise.race([
      sleep(5).then(() => null),
      shutdownPromise.then((reason) => ({ reason })),
    ]);
    if (shutdown != null) {
      return {
        ok: false,
        reason: shutdown.reason,
      };
    }
  }

  return { ok: true };
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
          : rpcRequest.method === 'tools/call' && rpcRequest.params?.name === WAIT_TOOL_NAME
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
              tools: [
                ...PLUTO_TOOL_DESCRIPTORS.map((descriptor) => ({
                  name: descriptor.name,
                  description: descriptor.description,
                  inputSchema: descriptor.inputSchema,
                })),
                {
                  name: WAIT_TOOL_NAME,
                  description: 'Suspend until a new actor-visible Pluto event arrives.',
                  inputSchema: WAIT_TOOL_INPUT_SCHEMA,
                },
              ],
            });
          case 'tools/call': {
            const requestedToolName = rpcRequest.params?.name;
            if (!isSupportedToolName(requestedToolName)) {
              return rpcError(rpcRequest.id, -32602, `Unknown tool: ${String(requestedToolName)}`);
            }

            const parsedActor = parseActorHeader(actorHeader);
            if (!parsedActor.ok) {
              return rpcError(rpcRequest.id, -32002, parsedActor.message);
            }

            if (requestedToolName === WAIT_TOOL_NAME) {
              const waitService = config.waitService;
              if (waitService == null) {
                return rpcError(rpcRequest.id, -32003, 'PLUTO_WAIT_UNAVAILABLE: wait-for-event is not configured for this runtime.');
              }

              let timeoutSec: number;
              try {
                timeoutSec = parseWaitTimeoutSec(rpcRequest.params?.arguments, waitService);
              } catch (error) {
                return rpcError(
                  rpcRequest.id,
                  -32602,
                  error instanceof Error ? error.message : 'invalid wait arguments',
                );
              }

              const disconnectReason = waitService.disconnectReason ?? 'http_disconnect';
              const socket = request.socket;
              const onDisconnect = () => {
                if (response.writableEnded || response.destroyed) {
                  return;
                }

                waitService.registry.cancelForActor(parsedActor.actor, disconnectReason);
              };
              const disconnectPoll = setInterval(() => {
                if (socket?.destroyed || request.destroyed || response.destroyed) {
                  onDisconnect();
                }
              }, 25);
              const onRequestClose = () => {
                if (request.destroyed) {
                  onDisconnect();
                }
              };

              request.once('aborted', onDisconnect);
              request.once('close', onRequestClose);
              response.once('close', onDisconnect);
              socket?.once('close', onDisconnect);

              try {
                const result = await waitService.registry.arm({
                  actor: parsedActor.actor,
                  fromSequence: waitService.cursorForActor(parsedActor.actor),
                  timeoutMs: timeoutSec * 1000,
                });

                if (result.outcome === 'event') {
                  const leaseWait = await waitForLease({
                    leaseStore: config.leaseStore,
                    actor: parsedActor.actor,
                    response,
                    disconnectReason,
                    shutdownSignal: waitService.shutdownSignal,
                    shutdownReason: waitService.shutdownReason,
                  });
                  if (!leaseWait.ok) {
                    return rpcResult(rpcRequest.id, waitToolResult({
                      outcome: 'cancelled',
                      reason: leaseWait.reason,
                    }));
                  }

                  waitService.onEventDelivered(parsedActor.actor, result.payload.latestEvent.sequence);
                  return rpcResult(rpcRequest.id, waitToolResult({
                    outcome: 'event',
                    latestEvent: result.payload.latestEvent,
                    delta: result.payload.delta,
                  }));
                }

                return rpcResult(rpcRequest.id, waitToolResult(result));
              } finally {
                clearInterval(disconnectPoll);
                request.off('aborted', onDisconnect);
                request.off('close', onRequestClose);
                response.off('close', onDisconnect);
                socket?.off('close', onDisconnect);
              }
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

            if (MUTATING_TOOLS.has(requestedToolName) && !config.leaseStore.consumeMutation()) {
              return rpcError(
                rpcRequest.id,
                TURN_CONSUMED_RPC_ERROR_CODE,
                `${TURN_CONSUMED_ERROR}: First mutating tool call already consumed this turn.`,
                {
                  code: TURN_CONSUMED_ERROR,
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
