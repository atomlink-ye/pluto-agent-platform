import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentSession, TeamTask } from "../../contracts/types.js";
import type { ProcessRunner } from "./process-runner.js";

export interface CliClientDeps {
  bin: string;
  provider: string;
  model: string;
  mode: string;
  thinking?: string;
  workspaceCwd?: string;
  host?: string;
  logsTail: number;
  waitTimeoutSec: number;
  runner: ProcessRunner;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunContext {
  task: TeamTask;
  runId: string;
}

/**
 * Build arguments for `paseo run` command to start an agent.
 */
export function buildRunArgs(input: {
  provider: string;
  model: string;
  mode: string;
  thinking?: string;
  workspaceCwd?: string;
  title: string;
  labels?: string[];
}): string[] {
  const args = [
    "run",
    "--detach",
    "--json",
    "--provider",
    input.provider,
    "--model",
    input.model,
    "--mode",
    input.mode,
    "--title",
    input.title,
  ];
  for (const label of input.labels ?? []) {
    args.push("--label", label);
  }
  if (input.thinking) args.push("--thinking", input.thinking);
  if (input.workspaceCwd) args.push("--cwd", input.workspaceCwd);
  return args;
}

/**
 * Add host argument if host is set.
 */
export function addHostArg(args: string[], host?: string): string[] {
  return host ? [...args, "--host", host] : args;
}

/**
 * Parse session ID from `paseo run` JSON output.
 */
export function parseAgentId(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.agentId === "string") return parsed.agentId;
      if (typeof parsed.id === "string") return parsed.id;
      if (typeof parsed.Id === "string") return parsed.Id;
    }
  } catch {
    /* fall through */
  }
  const m = trimmed.match(/"(?:agentId|id|Id)"\s*:\s*"([^"]+)"/);
  return m ? m[1] : undefined;
}

/**
 * Find a session in `paseo ls --json` output.
 */
export function findListedSession(stdout: string, sessionId: string): Record<string, unknown> | null {
  const parsed = JSON.parse(stdout) as unknown;
  let entries: unknown[] = [];
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const agents = obj["agents"];
    if (Array.isArray(agents)) {
      entries = agents;
    }
  }
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const listedId = typeof record["agentId"] === "string"
      ? record["agentId"]
      : (typeof record["id"] === "string" ? record["id"] : null);
    if (listedId === sessionId) {
      return record;
    }
  }
  return null;
}

/**
 * Normalize the host string by stripping http(s):// prefix.
 */
export function normalizePaseoHost(host: string | undefined): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^https?:\/\//i, "");
}

/**
 * Send a message to a session using a temporary prompt file.
 * This handles cases where the message is too long for command line.
 */
export async function sendPromptFileMessage(
  input: {
    runner: ProcessRunner;
    bin: string;
    host?: string;
    sessionId: string;
    message: string;
    wait: boolean;
    cwd: string;
  },
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "pluto-paseo-send-"));
  const promptFile = join(tempDir, "prompt.txt");
  try {
    await writeFile(promptFile, input.message, "utf8");
    const sendArgs = ["send", input.sessionId];
    if (!input.wait) sendArgs.push("--no-wait");
    sendArgs.push("--prompt-file", promptFile);
    const args = addHostArg(sendArgs, input.host);
    const result = await input.runner.exec(input.bin, args, { cwd: input.cwd });
    if (result.exitCode !== 0) {
      throw new Error(
        `paseo_send_failed: exit=${result.exitCode} stderr=${result.stderr.slice(0, 400)}`,
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Read agent logs using `paseo logs --filter text`.
 */
export async function readAgentLogs(
  input: {
    runner: ProcessRunner;
    bin: string;
    host?: string;
    agentId: string;
    logsTail: number;
    cwd: string;
  },
): Promise<string> {
  const args = addHostArg(
    ["logs", input.agentId, "--filter", "text", "--tail", String(input.logsTail)],
    input.host,
  );
  const result = await input.runner.exec(input.bin, args, { cwd: input.cwd });
  if (result.exitCode !== 0) {
    throw new Error(
      `paseo_logs_failed:${input.agentId} exit=${result.exitCode} stderr=${result.stderr.slice(0, 400)}`,
    );
  }
  return result.stdout;
}

/**
 * Wait for an agent to become idle.
 */
export async function waitForIdle(
  input: {
    runner: ProcessRunner;
    bin: string;
    host?: string;
    sessionId: string;
    timeoutSec: number;
    cwd: string;
  },
): Promise<{ exitCode: number; stderr: string }> {
  const args = addHostArg(
    ["wait", input.sessionId, "--timeout", String(input.timeoutSec), "--json"],
    input.host,
  );
  const result = await input.runner.exec(input.bin, args, { cwd: input.cwd });
  // Don't throw on error - let the caller check exitCode
  return { exitCode: result.exitCode, stderr: result.stderr };
}

/**
 * List active sessions.
 */
export async function listSessions(
  input: {
    runner: ProcessRunner;
    bin: string;
    host?: string;
    cwd: string;
  },
): Promise<string> {
  const args = addHostArg(["ls", "--json"], input.host);
  const result = await input.runner.exec(input.bin, args, { cwd: input.cwd });
  if (result.exitCode !== 0) {
    throw new Error(`paseo_ls_failed: exit=${result.exitCode} stderr=${result.stderr.slice(0, 400)}`);
  }
  return result.stdout;
}

/**
 * Delete an agent.
 */
export async function deleteAgent(
  input: {
    runner: ProcessRunner;
    bin: string;
    host?: string;
    agentId: string;
    cwd: string;
  },
): Promise<void> {
  const args = addHostArg(["delete", input.agentId], input.host);
  await input.runner.exec(input.bin, args, { cwd: input.cwd }).catch(() => undefined);
}