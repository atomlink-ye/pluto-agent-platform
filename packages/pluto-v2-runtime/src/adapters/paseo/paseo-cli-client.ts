import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

export type PaseoLabel = `${string}=${string}`;

export interface PaseoAgentSpec {
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly thinking?: string;
  readonly title: string;
  readonly initialPrompt: string;
  readonly labels?: ReadonlyArray<PaseoLabel>;
  readonly cwd?: string;
}

export interface PaseoAgentSession {
  readonly agentId: string;
}

export interface PaseoLogsResult {
  readonly transcriptText: string;
  readonly waitExitCode: number;
}

export interface PaseoUsageEstimate {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

export interface PaseoCliClient {
  spawnAgent(spec: PaseoAgentSpec): Promise<PaseoAgentSession>;
  sendPrompt(agentId: string, prompt: string): Promise<void>;
  waitIdle(agentId: string, timeoutSec: number): Promise<{ exitCode: number }>;
  readTranscript(agentId: string, tailLines: number): Promise<string>;
  usageEstimate(agentId: string): Promise<PaseoUsageEstimate>;
  deleteAgent(agentId: string): Promise<void>;
}

type SpawnFn = typeof spawn;

type ExecResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type JsonRecord = Record<string, unknown>;
type SpawnedReadableProcess = ChildProcessByStdio<null, Readable, Readable>;

const DEFAULT_BIN = 'paseo';
const DEFAULT_TIMEOUT_SEC = 60;
const appendHost = (args: string[], host?: string): string[] => {
  if (!host) {
    return args;
  }
  return [...args, '--host', host];
};

const toJsonRecord = (value: unknown): JsonRecord | null => {
  return value !== null && typeof value === 'object' ? (value as JsonRecord) : null;
};

const parseJson = (text: string): unknown => {
  const trimmed = text.trim();
  return trimmed ? JSON.parse(trimmed) : null;
};

const readString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const readFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const getByPath = (value: unknown, path: ReadonlyArray<string>): unknown => {
  let current: unknown = value;
  for (const segment of path) {
    const record = toJsonRecord(current);
    if (!record || !(segment in record)) {
      return undefined;
    }
    current = record[segment];
  }
  return current;
};

const firstNumberAtPaths = (value: unknown, paths: ReadonlyArray<ReadonlyArray<string>>): number | undefined => {
  for (const path of paths) {
    const numeric = readFiniteNumber(getByPath(value, path));
    if (numeric !== undefined) {
      return numeric;
    }
  }
  return undefined;
};

const parseAgentId = (stdout: string): string | undefined => {
  try {
    const parsed = parseJson(stdout);
    if (typeof parsed === 'string') {
      return readString(parsed);
    }
    return readString(getByPath(parsed, ['agentId']))
      ?? readString(getByPath(parsed, ['id']))
      ?? readString(getByPath(parsed, ['Id']));
  } catch {
    return undefined;
  }
};

const parseWaitExitCode = (stdout: string, processExitCode: number): number => {
  try {
    const parsed = parseJson(stdout);
    return firstNumberAtPaths(parsed, [
      ['exitCode'],
      ['exit_code'],
      ['code'],
      ['result', 'exitCode'],
      ['result', 'exit_code'],
      ['status', 'exitCode'],
      ['status', 'exit_code'],
    ]) ?? processExitCode;
  } catch {
    return processExitCode;
  }
};

const parseUsageEstimate = (stdout: string): PaseoUsageEstimate => {
  try {
    const parsed = parseJson(stdout);
    const inputTokens = firstNumberAtPaths(parsed, [
      ['inputTokens'],
      ['input_tokens'],
      ['promptTokens'],
      ['prompt_tokens'],
      ['usage', 'inputTokens'],
      ['usage', 'input_tokens'],
      ['usage', 'promptTokens'],
      ['usage', 'prompt_tokens'],
      ['usage', 'tokens', 'input'],
      ['usage', 'tokens', 'prompt'],
      ['tokenUsage', 'inputTokens'],
      ['tokenUsage', 'promptTokens'],
      ['metrics', 'inputTokens'],
      ['metrics', 'promptTokens'],
    ]);
    const outputTokens = firstNumberAtPaths(parsed, [
      ['outputTokens'],
      ['output_tokens'],
      ['completionTokens'],
      ['completion_tokens'],
      ['usage', 'outputTokens'],
      ['usage', 'output_tokens'],
      ['usage', 'completionTokens'],
      ['usage', 'completion_tokens'],
      ['usage', 'tokens', 'output'],
      ['usage', 'tokens', 'completion'],
      ['tokenUsage', 'outputTokens'],
      ['tokenUsage', 'completionTokens'],
      ['metrics', 'outputTokens'],
      ['metrics', 'completionTokens'],
    ]);
    const costUsd = firstNumberAtPaths(parsed, [
      ['costUsd'],
      ['cost_usd'],
      ['costUSD'],
      ['cost', 'usd'],
      ['cost', 'amountUsd'],
      ['usage', 'costUsd'],
      ['usage', 'cost_usd'],
      ['usage', 'cost', 'usd'],
      ['billing', 'costUsd'],
      ['billing', 'usd'],
      ['metrics', 'costUsd'],
      ['totals', 'costUsd'],
    ]);
    if (inputTokens === undefined && outputTokens === undefined && costUsd === undefined) {
      return {};
    }
    return { inputTokens, outputTokens, costUsd };
  } catch {
    return {};
  }
};

const execCommand = async (input: {
  readonly processSpawn: SpawnFn;
  readonly bin: string;
  readonly args: string[];
  readonly cwd: string;
  readonly timeoutSec: number;
}): Promise<ExecResult> => {
  const child = input.processSpawn(input.bin, input.args, {
    cwd: input.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as SpawnedReadableProcess;

  return await new Promise<ExecResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`paseo command timed out after ${input.timeoutSec}s: ${input.bin} ${input.args.join(' ')}`));
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
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: exitCode ?? 0,
        stdout,
        stderr,
      });
    });
  });
};

const ensureSuccess = (result: ExecResult, commandName: string): void => {
  if (result.exitCode === 0) {
    return;
  }
  const stderr = result.stderr.trim();
  throw new Error(`${commandName} failed with exit code ${result.exitCode}${stderr ? `: ${stderr}` : ''}`);
};

export function makePaseoCliClient(deps: {
  bin?: string;
  host?: string;
  cwd: string;
  processSpawn?: typeof spawn;
  timeoutDefaultSec?: number;
}): PaseoCliClient {
  const bin = deps.bin ?? DEFAULT_BIN;
  const processSpawn = deps.processSpawn ?? spawn;
  const timeoutDefaultSec = deps.timeoutDefaultSec ?? DEFAULT_TIMEOUT_SEC;

  const run = (args: string[], timeoutSec = timeoutDefaultSec): Promise<ExecResult> => {
    return execCommand({
      processSpawn,
      bin,
      args: appendHost(args, deps.host),
      cwd: deps.cwd,
      timeoutSec,
    });
  };

  return {
    async spawnAgent(spec): Promise<PaseoAgentSession> {
      const args = [
        'run',
        '--detach',
        '--json',
        '--provider',
        spec.provider,
        '--model',
        spec.model,
        '--mode',
        spec.mode,
      ];
      if (spec.thinking) {
        args.push('--thinking', spec.thinking);
      }
      args.push('--title', spec.title);
      for (const label of spec.labels ?? []) {
        args.push('--label', label);
      }
      if (spec.cwd) {
        args.push('--cwd', spec.cwd);
      }

      const result = await execCommand({
        processSpawn,
        bin,
        args: [...appendHost(args, deps.host), spec.initialPrompt],
        cwd: deps.cwd,
        timeoutSec: timeoutDefaultSec,
      });
      ensureSuccess(result, 'paseo run');
      const agentId = parseAgentId(result.stdout);
      if (!agentId) {
        throw new Error('paseo run did not return an agentId');
      }
      return { agentId };
    },

    async sendPrompt(agentId, prompt): Promise<void> {
      const tempDir = await mkdtemp(join(tmpdir(), 'pluto-v2-paseo-'));
      const promptPath = join(tempDir, 'prompt.txt');
      try {
        await writeFile(promptPath, prompt, 'utf8');
        const result = await run(['send', agentId, '--no-wait', '--prompt-file', promptPath]);
        ensureSuccess(result, 'paseo send');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },

    async waitIdle(agentId, timeoutSec): Promise<{ exitCode: number }> {
      const result = await run(
        ['wait', agentId, '--timeout', String(timeoutSec), '--json'],
        Math.max(timeoutSec, timeoutDefaultSec),
      );
      return { exitCode: parseWaitExitCode(result.stdout, result.exitCode) };
    },

    async readTranscript(agentId, tailLines): Promise<string> {
      const result = await run(['logs', agentId, '--filter', 'text', '--tail', String(tailLines)]);
      ensureSuccess(result, 'paseo logs');
      return result.stdout;
    },

    async usageEstimate(agentId): Promise<PaseoUsageEstimate> {
      const result = await run(['inspect', agentId, '--json']);
      ensureSuccess(result, 'paseo inspect');
      return parseUsageEstimate(result.stdout);
    },

    async deleteAgent(agentId): Promise<void> {
      try {
        await run(['delete', agentId]);
      } catch {
        // Best-effort cleanup: ignore spawn and command failures.
      }
    },
  };
}

export const __internal = {
  appendHost,
  parseAgentId,
  parseUsageEstimate,
  parseWaitExitCode,
  readPromptFile: readFile,
};
