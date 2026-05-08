#!/usr/bin/env tsx

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { makePaseoCliClient, type PaseoAgentSpec } from '../src/index.js';

type JsonRpcRequest = {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
};

type AttemptMethod = 'env' | 'tempfile';

type AttemptResult = {
  readonly method: AttemptMethod;
  readonly toolCalled: boolean;
  readonly transcriptSawDone: boolean;
  readonly transcript: string;
  readonly error?: string;
};

const DEFAULT_PROVIDER = 'opencode';
const DEFAULT_MODEL = 'openai/gpt-5.4-mini';
const DEFAULT_MODE = 'build';
const DEFAULT_TIMEOUT_SEC = 60;
const WAIT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;
const TRANSCRIPT_TAIL_LINES = 400;
const PROTOCOL_VERSION = '2025-11-25';
const TOOL_NAME = 'pluto_read_state';
const TOOL_RESULT = {
  content: [{ type: 'text', text: 'PLUTO_OK' }],
} as const;

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wantsDone(transcript: string): boolean {
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === 'DONE' || line === 'DONE PLUTO_OK' || line === '[Assistant] DONE' || line === '[Assistant] DONE PLUTO_OK');
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string>): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

async function main(): Promise<void> {
  const scriptDir = resolve(new URL('.', import.meta.url).pathname);
  const repoRoot = process.env.PLUTO_V2_REPO_ROOT?.trim() || resolve(scriptDir, '..', '..', '..');
  const provider = process.env.PASEO_PROVIDER?.trim() || DEFAULT_PROVIDER;
  const model = process.env.PASEO_MODEL?.trim() || DEFAULT_MODEL;
  const mode = process.env.PASEO_MODE?.trim() || DEFAULT_MODE;
  const host = process.env.PASEO_HOST?.trim() || undefined;
  const bin = process.env.PASEO_BIN?.trim() || undefined;
  const runToken = randomUUID();
  const sessionId = randomUUID();
  let negotiatedProtocolVersion = PROTOCOL_VERSION;
  let toolCalled = false;
  const requestMethods: string[] = [];

  const server = createServer(async (request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end('not found');
      return;
    }

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end('method not allowed');
      return;
    }

    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${runToken}`) {
      writeJson(response, 401, { error: 'unauthorized' }, {});
      return;
    }

    const requestedProtocolVersion = request.headers['mcp-protocol-version'];
    if (typeof requestedProtocolVersion === 'string' && requestedProtocolVersion.trim() !== '') {
      negotiatedProtocolVersion = requestedProtocolVersion;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await readRequestBody(request));
    } catch {
      writeJson(response, 400, { error: 'invalid json' }, {});
      return;
    }

    const responseHeaders = {
      'MCP-Protocol-Version': negotiatedProtocolVersion,
      'MCP-Session-Id': sessionId,
    };

    const handleMessage = (message: unknown): JsonRpcResponse | null => {
      if (!message || typeof message !== 'object') {
        return rpcError(null, -32600, 'Invalid Request');
      }

      const requestMessage = message as JsonRpcRequest;
      const method = requestMessage.method;
      if (typeof method !== 'string' || method.length === 0) {
        return rpcError(requestMessage.id, -32600, 'Invalid Request');
      }
      requestMethods.push(method);

      if (method === 'notifications/initialized' || (requestMessage.id === undefined && method.startsWith('notifications/'))) {
        return null;
      }

      switch (method) {
        case 'initialize':
          return rpcResult(requestMessage.id, {
            protocolVersion: negotiatedProtocolVersion,
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'pluto-proof-mcp',
              version: '0.0.0',
            },
          });
        case 'tools/list':
          return rpcResult(requestMessage.id, {
            tools: [
              {
                name: TOOL_NAME,
                description: 'Return the Pluto proof state marker.',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  additionalProperties: false,
                },
              },
            ],
          });
        case 'tools/call': {
          const toolName = requestMessage.params?.name;
          if (toolName !== TOOL_NAME) {
            return rpcError(requestMessage.id, -32602, `Unknown tool: ${String(toolName)}`);
          }
          toolCalled = true;
          return rpcResult(requestMessage.id, TOOL_RESULT);
        }
        default:
          return rpcError(requestMessage.id, -32601, `Unsupported method: ${method}`);
      }
    };

    const messages = Array.isArray(payload) ? payload : [payload];
    const responses = messages
      .map((message) => handleMessage(message))
      .filter((message): message is JsonRpcResponse => message !== null);

    if (responses.length === 0) {
      response.writeHead(202, responseHeaders);
      response.end();
      return;
    }

    writeJson(response, 200, responses.length === 1 ? responses[0] : responses, responseHeaders);
  });

  const started = await new Promise<{ port: number }>((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectStart(new Error('failed to resolve MCP proof server port'));
        return;
      }
      resolveStart({ port: address.port });
    });
  });

  const mcpUrl = `http://127.0.0.1:${started.port}/mcp`;
  const configPayload = {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      pluto: {
        type: 'remote',
        url: mcpUrl,
        enabled: true,
        oauth: false,
        headers: {
          Authorization: `Bearer ${runToken}`,
        },
      },
    },
  };
  const configContent = JSON.stringify(configPayload);
  const client = makePaseoCliClient({
    bin,
    host,
    cwd: repoRoot,
    timeoutDefaultSec: DEFAULT_TIMEOUT_SEC,
  });

  const prompt = [
    'A Pluto MCP server is already configured for this session.',
    `You must call the ${TOOL_NAME} tool exactly once before replying.`,
    'Wait for the tool result first; do not guess or skip the tool call.',
    'After the tool call succeeds, reply with exactly: DONE PLUTO_OK',
    'If the tool is unavailable, reply with exactly: BLOCKED',
  ].join('\n');

  const attempt = async (method: AttemptMethod, specOverrides: Partial<PaseoAgentSpec>): Promise<AttemptResult> => {
    let agentId: string | undefined;
    try {
      const session = await client.spawnAgent({
        provider,
        model,
        mode,
        title: `t4-d0-${method}`,
        initialPrompt: 'Wait for the next prompt and follow it exactly.',
        labels: ['slice=t4-d0', `method=${method}`],
        ...specOverrides,
      });
      agentId = session.agentId;
      await client.sendPrompt(agentId, prompt);
      const deadline = Date.now() + WAIT_TIMEOUT_MS;
      let transcript = '';
      let transcriptSawDone = false;

      while (Date.now() < deadline) {
        try {
          transcript = await client.readTranscript(agentId, TRANSCRIPT_TAIL_LINES);
          transcriptSawDone = wantsDone(transcript);
        } catch {
          // Agent transcript can lag right after spawn.
        }

        if (toolCalled || transcriptSawDone) {
          return {
            method,
            toolCalled,
            transcriptSawDone,
            transcript,
          };
        }

        await delay(POLL_INTERVAL_MS);
      }

      try {
        const finalTranscript = await client.readTranscript(agentId, TRANSCRIPT_TAIL_LINES);
        transcript = finalTranscript;
        transcriptSawDone = wantsDone(finalTranscript);
      } catch {
        // Keep last observed transcript.
      }

      return {
        method,
        toolCalled,
        transcriptSawDone,
        transcript,
        error: 'Timed out waiting for tool call or DONE.',
      };
    } catch (error) {
      return {
        method,
        toolCalled,
        transcriptSawDone: false,
        transcript: '',
        error: normalizeError(error),
      };
    } finally {
      if (agentId) {
        await client.deleteAgent(agentId);
      }
    }
  };

  let tempDir: string | undefined;
  let envResult: AttemptResult | undefined;
  let tempfileResult: AttemptResult | undefined;

  try {
    envResult = await attempt('env', {
      cwd: repoRoot,
      env: {
        OPENCODE_CONFIG_CONTENT: configContent,
      },
    });

    let winningMethod: 'env' | 'tempfile' | 'none' = envResult.toolCalled ? 'env' : 'none';
    let finalResult = envResult;

    if (winningMethod === 'none') {
      tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-t4-d0-'));
      await writeFile(join(tempDir, 'opencode.json'), `${JSON.stringify(configPayload, null, 2)}\n`, 'utf8');
      tempfileResult = await attempt('tempfile', {
        cwd: tempDir,
      });
      if (tempfileResult.toolCalled) {
        winningMethod = 'tempfile';
        finalResult = tempfileResult;
      } else {
        finalResult = tempfileResult;
      }
    }

    const reachedToolDiscovery = requestMethods.includes('tools/list');
    const summaryBlock = [
      'T4-D0 RESULT',
      `method: ${winningMethod}`,
      `server.toolCalled: ${finalResult.toolCalled ? 'true' : 'false'}`,
      `agent transcript saw DONE: ${finalResult.transcriptSawDone ? 'true' : 'false'}`,
      `recommendation: ${winningMethod === 'env'
        ? 'Use OPENCODE_CONFIG_CONTENT injection for T4-S2 and keep temp opencode.json as fallback.'
        : winningMethod === 'tempfile'
          ? 'Adopt temp opencode.json in actor cwd for T4-S2 and keep env injection as a best-effort fallback.'
          : reachedToolDiscovery
            ? 'Both injection methods reached MCP discovery but not tools/call; halt T4 and escalate tool invocation before T4-S2.'
            : 'Neither injection path reached usable MCP discovery; halt T4 and escalate before T4-S2.'}`,
    ].join('\n');

    process.stdout.write(`${summaryBlock}\n`);

    process.stderr.write(`env attempt: toolCalled=${envResult.toolCalled ? 'true' : 'false'} done=${envResult.transcriptSawDone ? 'true' : 'false'}${envResult.error ? ` error=${envResult.error}` : ''}\n`);
    if (envResult.error) {
      process.stderr.write(`env attempt: ${envResult.error}\n`);
    }
    if (tempfileResult) {
      process.stderr.write(`tempfile attempt: toolCalled=${tempfileResult.toolCalled ? 'true' : 'false'} done=${tempfileResult.transcriptSawDone ? 'true' : 'false'}${tempfileResult.error ? ` error=${tempfileResult.error}` : ''}\n`);
    }
    if (tempfileResult?.error) {
      process.stderr.write(`tempfile attempt: ${tempfileResult.error}\n`);
    }
    process.stderr.write(`server methods: ${requestMethods.length > 0 ? requestMethods.join(', ') : '(none)'}\n`);
    if (!envResult.toolCalled && envResult.transcript.trim() !== '') {
      process.stderr.write(`env transcript: ${envResult.transcript.trim().slice(0, 600)}\n`);
    }
    if (tempfileResult && !tempfileResult.toolCalled && tempfileResult.transcript.trim() !== '') {
      process.stderr.write(`tempfile transcript: ${tempfileResult.transcript.trim().slice(0, 600)}\n`);
    }

    process.exitCode = winningMethod === 'none' ? 1 : 0;
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

const entryHref = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;

if (entryHref && import.meta.url === entryHref) {
  main().catch((error) => {
    process.stderr.write(`${normalizeError(error)}\n`);
    process.exitCode = 1;
  });
}
