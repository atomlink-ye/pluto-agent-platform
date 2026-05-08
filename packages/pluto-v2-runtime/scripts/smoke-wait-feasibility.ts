#!/usr/bin/env tsx

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';
import { type Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { makePaseoCliClient, type PaseoAgentSpec, type PaseoCliClient } from '../src/adapters/paseo/paseo-cli-client.ts';

type JsonRpcRequest = {
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

type Recommendation = 'GO' | 'NO-GO' | 'NARROW';
type ObservationOutcome = 'completed' | 'disconnected';

type RequestObservation = {
  readonly actor: string;
  readonly toolName: 'pluto_wait_for_event' | 'pluto_read_state';
  readonly requestedTimeoutSec: number | null;
  readonly startedAtMs: number;
  completedAtMs: number | null;
  disconnectedAtMs: number | null;
  waitedMs: number | null;
  outcome: ObservationOutcome | null;
};

type AgentResult = {
  readonly agentId: string;
  readonly waitExitCode: number | null;
  readonly transcript: string;
  readonly error?: string;
};

type ScenarioResult = {
  readonly available: boolean;
  readonly waitObservation?: RequestObservation;
  readonly readObservation?: RequestObservation;
  readonly actorA?: AgentResult;
  readonly actorB?: AgentResult;
  readonly error?: string;
};

type ExecResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const DEFAULT_PROVIDER = 'opencode';
const DEFAULT_MODEL = 'openai/gpt-5.4-mini';
const DEFAULT_MODE = 'build';
const PROTOCOL_VERSION = '2025-11-25';
const SERVER_MAX_WAIT_SEC = 120;
const SINGLE_FLIGHT_WAIT_SEC = 30;
const LONG_WAIT_TIMEOUT_SEC = 120;
const ACTOR_WAIT_TIMEOUT_SEC = 180;
const TRANSCRIPT_TAIL_LINES = 400;
const OBSERVATION_TIMEOUT_MS = 90_000;

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'MCP-Session-Id': 't5-d2b-proof',
  });
  response.end(JSON.stringify(body));
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolPayload(actor: string, toolName: 'pluto_wait_for_event' | 'pluto_read_state', timeoutSec?: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: `${actor}-${toolName}`,
    method: 'tools/call',
    params: {
      name: toolName,
      ...(timeoutSec === undefined ? {} : { arguments: { timeoutSec } }),
    },
  });
}

function curlCommand(input: {
  readonly url: string;
  readonly token: string;
  readonly actor: string;
  readonly toolName: 'pluto_wait_for_event' | 'pluto_read_state';
  readonly marker: string;
  readonly timeoutSec?: number;
}): string {
  return [
    'curl --silent --show-error --fail',
    `  -X POST '${input.url}'`,
    `  -H 'Authorization: Bearer ${input.token}'`,
    "  -H 'Content-Type: application/json'",
    `  -H 'MCP-Protocol-Version: ${PROTOCOL_VERSION}'`,
    `  -H 'X-Pluto-Proof-Actor: ${input.actor}'`,
    `  --data '${toolPayload(input.actor, input.toolName, input.timeoutSec)}'`,
    `&& printf '\n${input.marker}\n'`,
  ].join(' \\\n');
}

function actorPrompt(command: string): string {
  return [
    'Use the bash tool exactly once.',
    'Run the exact command below with no edits.',
    'After the command finishes, reply with a single status line only.',
    '',
    '```bash',
    command,
    '```',
  ].join('\n');
}

function parseTimeoutSec(rawArgs: unknown): number {
  const candidate = rawArgs && typeof rawArgs === 'object'
    ? (rawArgs as Record<string, unknown>).timeoutSec
    : undefined;
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    ? candidate
    : SINGLE_FLIGHT_WAIT_SEC;
}

async function waitForObservation(
  observations: RequestObservation[],
  predicate: (observation: RequestObservation) => boolean,
  timeoutMs = OBSERVATION_TIMEOUT_MS,
): Promise<RequestObservation> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = observations.find(predicate);
    if (match) {
      return match;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for server observation after ${timeoutMs}ms.`);
}

async function readTranscriptBestEffort(client: PaseoCliClient, agentId: string): Promise<string> {
  try {
    return await client.readTranscript(agentId, TRANSCRIPT_TAIL_LINES);
  } catch {
    return '';
  }
}

async function waitForAgent(client: PaseoCliClient, agentId: string, timeoutSec: number): Promise<AgentResult> {
  try {
    const wait = await client.waitIdle(agentId, timeoutSec);
    return {
      agentId,
      waitExitCode: wait.exitCode,
      transcript: await readTranscriptBestEffort(client, agentId),
    };
  } catch (error) {
    return {
      agentId,
      waitExitCode: null,
      transcript: await readTranscriptBestEffort(client, agentId),
      error: normalizeError(error),
    };
  }
}

type SpawnedReadableProcess = ChildProcessByStdio<null, Readable, Readable>;

async function execPaseo(input: {
  readonly cwd: string;
  readonly bin: string;
  readonly host?: string;
  readonly args: string[];
  readonly timeoutSec: number;
}): Promise<ExecResult> {
  const child = spawn(input.bin, [...input.args, ...(input.host ? ['--host', input.host] : [])], {
    cwd: input.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as SpawnedReadableProcess;

  return await new Promise<ExecResult>((resolveResult, rejectResult) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGKILL');
      rejectResult(new Error(`paseo command timed out after ${input.timeoutSec}s: ${input.bin} ${input.args.join(' ')}`));
    }, input.timeoutSec * 1000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      rejectResult(error);
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolveResult({ exitCode: exitCode ?? 0, stdout, stderr });
    });
  });
}

async function stopAgent(cwd: string, bin: string, host: string | undefined, agentId: string): Promise<void> {
  const result = await execPaseo({
    cwd,
    bin,
    host,
    args: ['stop', agentId, '--json'],
    timeoutSec: 30,
  });
  if (result.exitCode !== 0) {
    throw new Error(`paseo stop failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
  }
}

async function runLocalFallback(baseUrl: string, token: string, observations: RequestObservation[]): Promise<{
  singleFlightPass: boolean;
  readBeforeWaitMs: number | null;
  cancellationClean: boolean;
}> {
  const callTool = async (
    actor: string,
    toolName: 'pluto_wait_for_event' | 'pluto_read_state',
    timeoutSec?: number,
    signal?: AbortSignal,
  ): Promise<number> => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        'X-Pluto-Proof-Actor': actor,
      },
      body: toolPayload(actor, toolName, timeoutSec),
    });
    await response.text();
    return Date.now();
  };

  const waitPromise = callTool('local-a', 'pluto_wait_for_event', 5);
  await delay(250);
  const readFinishedAtMs = await callTool('local-b', 'pluto_read_state');
  const waitFinishedAtMs = await waitPromise;

  const abortController = new AbortController();
  const cancelPromise = callTool('local-cancel', 'pluto_wait_for_event', 30, abortController.signal).catch(() => null);
  await delay(1_000);
  abortController.abort();
  await cancelPromise;
  const cancelled = await waitForObservation(
    observations,
    (observation) => observation.actor === 'local-cancel' && observation.outcome === 'disconnected',
    5_000,
  );

  return {
    singleFlightPass: readFinishedAtMs < waitFinishedAtMs,
    readBeforeWaitMs: waitFinishedAtMs - readFinishedAtMs,
    cancellationClean: cancelled.disconnectedAtMs !== null,
  };
}

async function main(): Promise<void> {
  const scriptDir = resolve(new URL('.', import.meta.url).pathname);
  const repoRoot = process.env.PLUTO_V2_REPO_ROOT?.trim() || resolve(scriptDir, '..', '..', '..');
  const provider = process.env.PASEO_PROVIDER?.trim() || DEFAULT_PROVIDER;
  const model = process.env.PASEO_MODEL?.trim() || DEFAULT_MODEL;
  const mode = process.env.PASEO_MODE?.trim() || DEFAULT_MODE;
  const host = process.env.PASEO_HOST?.trim() || undefined;
  const bin = process.env.PASEO_BIN?.trim() || 'paseo';
  const token = randomUUID();
  const observations: RequestObservation[] = [];
  const client = makePaseoCliClient({ bin, host, cwd: repoRoot, timeoutDefaultSec: 60 });

  const baseSpec: Omit<PaseoAgentSpec, 'title'> = {
    provider,
    model,
    mode,
    cwd: repoRoot,
    initialPrompt: 'Wait for the next prompt and follow it exactly.',
    labels: ['slice=t5-d2b'],
  };

  const createActor = async (title: string): Promise<string> => {
    const session = await client.spawnAgent({ ...baseSpec, title });
    return session.agentId;
  };

  const deleteActors = async (...agentIds: Array<string | undefined>): Promise<void> => {
    await Promise.all(agentIds.filter((agentId): agentId is string => Boolean(agentId)).map((agentId) => client.deleteAgent(agentId)));
  };

  const server = createServer(async (request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end('not found');
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'POST' }).end('method not allowed');
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      writeJson(response, 401, { error: 'unauthorized' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await readBody(request));
    } catch {
      writeJson(response, 400, { error: 'invalid json' });
      return;
    }

    const rpcRequest = payload as JsonRpcRequest;
    const actor = typeof request.headers['x-pluto-proof-actor'] === 'string' ? request.headers['x-pluto-proof-actor'] : 'unknown';
    if (rpcRequest.method !== 'tools/call') {
      writeJson(response, 200, rpcError(rpcRequest.id, -32601, `Unsupported method: ${String(rpcRequest.method)}`));
      return;
    }

    const requestedTool = rpcRequest.params?.name;
    if (requestedTool !== 'pluto_wait_for_event' && requestedTool !== 'pluto_read_state') {
      writeJson(response, 200, rpcError(rpcRequest.id, -32602, `Unknown tool: ${String(requestedTool)}`));
      return;
    }

    const observation: RequestObservation = {
      actor,
      toolName: requestedTool,
      requestedTimeoutSec: requestedTool === 'pluto_wait_for_event' ? parseTimeoutSec(rpcRequest.params?.arguments) : null,
      startedAtMs: Date.now(),
      completedAtMs: null,
      disconnectedAtMs: null,
      waitedMs: null,
      outcome: null,
    };
    observations.push(observation);

    let disconnected = false;
    response.on('close', () => {
      if (response.writableEnded || disconnected) {
        return;
      }
      disconnected = true;
      observation.disconnectedAtMs = Date.now();
      observation.waitedMs = observation.disconnectedAtMs - observation.startedAtMs;
      observation.outcome = 'disconnected';
    });

    if (requestedTool === 'pluto_read_state') {
      observation.completedAtMs = Date.now();
      observation.waitedMs = observation.completedAtMs - observation.startedAtMs;
      observation.outcome = 'completed';
      writeJson(response, 200, rpcResult(rpcRequest.id, {
        content: [{ type: 'text', text: `STATE_OK ${actor}` }],
      }));
      return;
    }

    const waitSec = Math.min(observation.requestedTimeoutSec ?? SINGLE_FLIGHT_WAIT_SEC, SERVER_MAX_WAIT_SEC);
    await delay(waitSec * 1000);
    if (disconnected) {
      return;
    }
    observation.completedAtMs = Date.now();
    observation.waitedMs = observation.completedAtMs - observation.startedAtMs;
    observation.outcome = 'completed';
    writeJson(response, 200, rpcResult(rpcRequest.id, {
      kind: 'timeout',
      waited_ms: observation.waitedMs,
    }));
  });

  const started = await new Promise<{ port: number }>((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectStart(new Error('failed to resolve proof server port'));
        return;
      }
      resolveStart({ port: address.port });
    });
  });

  const baseUrl = `http://127.0.0.1:${started.port}/mcp`;

  const runSingleFlight = async (): Promise<ScenarioResult> => {
    let actorAId: string | undefined;
    let actorBId: string | undefined;
    try {
      [actorAId, actorBId] = await Promise.all([createActor('t5-d2b-a'), createActor('t5-d2b-b')]);
      await client.sendPrompt(actorAId, actorPrompt(curlCommand({
        url: baseUrl,
        token,
        actor: 'actor-a',
        toolName: 'pluto_wait_for_event',
        timeoutSec: SINGLE_FLIGHT_WAIT_SEC,
        marker: 'T5_D2B_A_DONE',
      })));
      const waitObservation = await waitForObservation(
        observations,
        (observation) => observation.actor === 'actor-a' && observation.toolName === 'pluto_wait_for_event',
      );
      await client.sendPrompt(actorBId, actorPrompt(curlCommand({
        url: baseUrl,
        token,
        actor: 'actor-b',
        toolName: 'pluto_read_state',
        marker: 'T5_D2B_B_DONE',
      })));
      const readObservation = await waitForObservation(
        observations,
        (observation) => observation.actor === 'actor-b' && observation.toolName === 'pluto_read_state' && observation.outcome === 'completed',
      );
      const [actorA, actorB] = await Promise.all([
        waitForAgent(client, actorAId, ACTOR_WAIT_TIMEOUT_SEC),
        waitForAgent(client, actorBId, ACTOR_WAIT_TIMEOUT_SEC),
      ]);
      return { available: true, waitObservation, readObservation, actorA, actorB };
    } catch (error) {
      return { available: false, error: normalizeError(error) };
    } finally {
      await deleteActors(actorAId, actorBId);
    }
  };

  const runCancellation = async (): Promise<ScenarioResult> => {
    let actorAId: string | undefined;
    let actorBId: string | undefined;
    try {
      actorAId = await createActor('t5-d2b-a2');
      await client.sendPrompt(actorAId, actorPrompt(curlCommand({
        url: baseUrl,
        token,
        actor: 'actor-a2',
        toolName: 'pluto_wait_for_event',
        timeoutSec: LONG_WAIT_TIMEOUT_SEC,
        marker: 'T5_D2B_A2_DONE',
      })));
      await waitForObservation(
        observations,
        (observation) => observation.actor === 'actor-a2' && observation.toolName === 'pluto_wait_for_event',
      );
      await delay(5_000);
      await stopAgent(repoRoot, bin, host, actorAId);
      const waitObservation = await waitForObservation(
        observations,
        (observation) => observation.actor === 'actor-a2' && observation.toolName === 'pluto_wait_for_event' && observation.outcome !== null,
        30_000,
      );

      actorBId = await createActor('t5-d2b-b2');
      await client.sendPrompt(actorBId, actorPrompt(curlCommand({
        url: baseUrl,
        token,
        actor: 'actor-b2',
        toolName: 'pluto_read_state',
        marker: 'T5_D2B_B2_DONE',
      })));
      const readObservation = await waitForObservation(
        observations,
        (observation) => observation.actor === 'actor-b2' && observation.toolName === 'pluto_read_state' && observation.outcome === 'completed',
      );
      const [actorA, actorB] = await Promise.all([
        waitForAgent(client, actorAId, 30),
        waitForAgent(client, actorBId, ACTOR_WAIT_TIMEOUT_SEC),
      ]);
      return { available: true, waitObservation, readObservation, actorA, actorB };
    } catch (error) {
      return { available: false, error: normalizeError(error) };
    } finally {
      await deleteActors(actorAId, actorBId);
    }
  };

  const runTimeoutProbe = async (): Promise<ScenarioResult> => {
    let actorAId: string | undefined;
    try {
      actorAId = await createActor('t5-d2b-a3');
      await client.sendPrompt(actorAId, actorPrompt(curlCommand({
        url: baseUrl,
        token,
        actor: 'actor-a3',
        toolName: 'pluto_wait_for_event',
        timeoutSec: LONG_WAIT_TIMEOUT_SEC,
        marker: 'T5_D2B_A3_DONE',
      })));
      await waitForObservation(
        observations,
        (observation) => observation.actor === 'actor-a3' && observation.toolName === 'pluto_wait_for_event',
      );
      const [waitObservation, actorA] = await Promise.all([
        waitForObservation(
          observations,
          (observation) => observation.actor === 'actor-a3' && observation.toolName === 'pluto_wait_for_event' && observation.outcome !== null,
          (LONG_WAIT_TIMEOUT_SEC + 30) * 1000,
        ),
        waitForAgent(client, actorAId, LONG_WAIT_TIMEOUT_SEC + 60),
      ]);
      return { available: true, waitObservation, actorA };
    } catch (error) {
      return { available: false, error: normalizeError(error) };
    } finally {
      await deleteActors(actorAId);
    }
  };

  try {
    const singleFlight = await runSingleFlight();
    const cancellation = singleFlight.available ? await runCancellation() : { available: false, error: 'skipped after live single-flight was unavailable' };
    const timeoutProbe = singleFlight.available ? await runTimeoutProbe() : { available: false, error: 'skipped after live single-flight was unavailable' };
    const fallback = await runLocalFallback(baseUrl, token, observations);

    const singleFlightPass = singleFlight.available
      && singleFlight.waitObservation?.completedAtMs != null
      && singleFlight.readObservation?.completedAtMs != null
      && singleFlight.readObservation.completedAtMs < singleFlight.waitObservation.completedAtMs;
    const cancellationClean = cancellation.available
      && cancellation.waitObservation?.outcome === 'disconnected'
      && cancellation.readObservation?.outcome === 'completed';

    const timeoutObservation = timeoutProbe.waitObservation;
    const timeoutChain = timeoutObservation?.outcome === 'completed'
      ? `server wait cap @ ${Math.round((timeoutObservation.waitedMs ?? 0) / 1000)}s`
      : timeoutObservation?.outcome === 'disconnected'
        ? `OpenCode or Paseo disconnected first @ ${Math.round((timeoutObservation.waitedMs ?? 0) / 1000)}s`
        : `node server defaults requestTimeout=${server.requestTimeout / 1000}s headersTimeout=${server.headersTimeout / 1000}s timeout=${server.timeout / 1000}s`;

    const recommendation: Recommendation = !singleFlight.available
      ? 'NARROW'
      : !singleFlightPass
        ? 'NO-GO'
        : !cancellationClean || timeoutObservation?.outcome === 'disconnected'
          ? 'NARROW'
          : 'GO';

    const deltaMs = singleFlightPass
      ? (singleFlight.waitObservation?.completedAtMs ?? 0) - (singleFlight.readObservation?.completedAtMs ?? 0)
      : fallback.readBeforeWaitMs;
    const deltaLabel = deltaMs === null
      ? 'untested'
      : `${deltaMs}ms${singleFlight.available ? '' : ' (node-http fallback only)'}`;

    const summary = [
      'T5-D2b RESULT',
      `single-flight session: ${singleFlightPass ? 'pass' : singleFlight.available ? 'fail' : 'partial'}`,
      `B-completes-before-A-wait: ${singleFlightPass || (!singleFlight.available && fallback.singleFlightPass) ? `yes, ${deltaLabel}` : `no, ${deltaLabel}`}`,
      `A-cancellation cleanup: ${cancellationClean ? 'clean' : cancellation.available ? 'leaks' : fallback.cancellationClean ? 'partial' : 'leaks'}`,
      `tightest-timeout-in-chain: ${timeoutChain}`,
      `recommendation: ${recommendation}`,
    ].join('\n');

    process.stdout.write(`${summary}\n`);
    process.stderr.write(`live single-flight available: ${singleFlight.available ? 'yes' : 'no'}\n`);
    if (singleFlight.error) {
      process.stderr.write(`live single-flight error: ${singleFlight.error}\n`);
    }
    if (cancellation.error) {
      process.stderr.write(`live cancellation error: ${cancellation.error}\n`);
    }
    if (timeoutProbe.error) {
      process.stderr.write(`live timeout probe error: ${timeoutProbe.error}\n`);
    }
    process.stderr.write(`local fallback single-flight: ${fallback.singleFlightPass ? 'pass' : 'fail'}\n`);
    process.stderr.write(`observations: ${JSON.stringify(observations, null, 2)}\n`);
    process.stderr.write(`actor-a transcript: ${(singleFlight.actorA?.transcript ?? '').slice(0, 800)}\n`);
    process.stderr.write(`actor-b transcript: ${(singleFlight.actorB?.transcript ?? '').slice(0, 800)}\n`);
    process.stderr.write(`actor-a2 transcript: ${(cancellation.actorA?.transcript ?? '').slice(0, 800)}\n`);
    process.stderr.write(`actor-b2 transcript: ${(cancellation.actorB?.transcript ?? '').slice(0, 800)}\n`);
    process.stderr.write(`actor-a3 transcript: ${(timeoutProbe.actorA?.transcript ?? '').slice(0, 800)}\n`);
    process.exitCode = recommendation === 'GO' ? 0 : recommendation === 'NO-GO' ? 1 : 2;
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
  }
}

main().catch((error) => {
  process.stderr.write(`${normalizeError(error)}\n`);
  process.exitCode = 1;
});
