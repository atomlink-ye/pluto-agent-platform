import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { MailboxMessage, MailboxMessageBody, MailboxMessageKind } from "../contracts/four-layer.js";

export const PLUTO_RUNTIME_HELPER_MVP_ENV = "PLUTO_RUNTIME_HELPER_MVP";
export const PLUTO_RUNTIME_HELPER_CONTEXT_ENV = "PLUTO_RUNTIME_HELPER_CONTEXT";
export const PLUTO_RUNTIME_HELPER_ROLE_ENV = "PLUTO_RUNTIME_HELPER_ROLE";
export const PLUTO_RUNTIME_HELPER_RUN_ENV = "PLUTO_RUNTIME_HELPER_RUN_ID";

const HELPER_ROOT_DIR = ".pluto-runtime";
const HELPER_ENTRYPOINT = "pluto-mailbox";
const HELPER_MAIN_SCRIPT = "pluto-mailbox.mjs";
const HELPER_CONTEXT_INDEX = "context-index.json";
const REQUEST_POLL_MS = 75;

export interface RuntimeHelperMaterialization {
  enabled: boolean;
  rootDir: string;
  requestsPath: string;
  responsesDir: string;
  usageLogPath: string;
}

interface RuntimeHelperContext {
  runId: string;
  roleId: string;
  leadRoleId: string;
  taskListPath: string;
  requestsPath: string;
  responsesDir: string;
  usageLogPath: string;
}

interface RuntimeHelperContextIndex {
  schemaVersion: "v1";
  runId: string;
  leadRoleId: string;
  contexts: Record<string, string>;
}

export interface RuntimeHelperSendMessageRequest {
  to: string;
  kind?: MailboxMessageKind;
  body: MailboxMessageBody;
  summary?: string;
  replyTo?: string;
  taskId?: string;
}

export interface RuntimeHelperRequest {
  schemaVersion: "v1";
  id: string;
  requestedAt: string;
  roleId: string;
  command: "send" | "spawn" | "complete" | "verdict" | "finalize";
  action: "send_message";
  payload: RuntimeHelperSendMessageRequest;
}

export interface RuntimeHelperWaitRequest {
  schemaVersion: "v1";
  id: string;
  requestedAt: string;
  roleId: string;
  command: "wait";
  action: "wait_task";
  payload: {
    taskId: string;
    targetStatus: string;
    timeoutMs: number;
  };
}

interface RuntimeHelperResponse {
  ok: boolean;
  requestId: string;
  messageId?: string;
  transportMessageId?: string;
  error?: string;
  command?: string;
  taskId?: string;
  targetStatus?: string;
  status?: string;
  waitedMs?: number;
}

type PendingRuntimeHelperWait = {
  requestId: string;
  roleId: string;
  taskId: string;
  targetStatus: string;
  startedAtMs: number;
  deadlineMs: number;
};

export interface RuntimeHelperServerOptions {
  taskListPath: string;
  requestsPath: string;
  responsesDir: string;
  pollMs?: number;
  clock?: () => Date;
  roleSessionId: (roleId: string) => string | undefined;
  sendMessage: (input: RuntimeHelperSendMessageRequest & { from: string }) => Promise<MailboxMessage>;
  recordMailboxMessage: (
    message: MailboxMessage,
    roleId?: string,
    sessionId?: string,
    extraPayload?: Record<string, unknown>,
  ) => Promise<void>;
}

export interface RuntimeHelperServerHandle {
  hasPendingWait(roleId: string): boolean;
  resolvePendingWaitsForRole(roleId: string): Promise<boolean>;
  stop(): Promise<void>;
}

interface RuntimeHelperTaskSnapshot {
  id: string;
  status: string;
  claimedBy?: string;
  assigneeId?: string;
}

async function readTaskSnapshotFile(taskListPath: string, taskId: string): Promise<RuntimeHelperTaskSnapshot | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const raw = await readFile(taskListPath, "utf8");
      const tasks = (JSON.parse(raw)?.tasks ?? []) as RuntimeHelperTaskSnapshot[];
      return tasks.find((entry) => entry.id === taskId) ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT") && !message.includes("Unexpected end of JSON input")) {
        throw error;
      }
      if (attempt === 4) {
        throw error;
      }
      await delay(20);
    }
  }
  return null;
}

export function resolveRuntimeHelperMvpEnabled(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }
  const raw = process.env[PLUTO_RUNTIME_HELPER_MVP_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function runtimeHelperCliPath(workspaceDir: string): string {
  return join(workspaceDir, HELPER_ROOT_DIR, HELPER_ENTRYPOINT);
}

export function runtimeHelperContextPath(workspaceDir: string, roleId: string, runId?: string): string {
  if (runId) {
    return join(workspaceDir, HELPER_ROOT_DIR, "runs", runId, "contexts", `${roleId}.json`);
  }
  return join(workspaceDir, HELPER_ROOT_DIR, "contexts", `${roleId}.json`);
}

export async function materializeRuntimeHelperWorkspace(input: {
  enabled: boolean;
  workspaceDir: string;
  runDir: string;
  runId: string;
  leadRoleId: string;
  roleIds: string[];
  taskListPath: string;
}): Promise<RuntimeHelperMaterialization> {
  const rootDir = join(input.workspaceDir, HELPER_ROOT_DIR);
  const runRootDir = join(rootDir, "runs", input.runId);
  const requestsPath = join(input.runDir, "runtime-helper-requests.jsonl");
  const responsesDir = join(input.runDir, "runtime-helper-responses");
  const usageLogPath = join(input.runDir, "runtime-helper-usage.jsonl");

  if (!input.enabled) {
    return {
      enabled: false,
      rootDir,
      requestsPath,
      responsesDir,
      usageLogPath,
    };
  }

  await rm(join(rootDir, "roles"), { recursive: true, force: true });
  await mkdir(rootDir, { recursive: true });
  await mkdir(join(rootDir, "contexts"), { recursive: true });
  await mkdir(join(runRootDir, "contexts"), { recursive: true });
  await mkdir(responsesDir, { recursive: true });
  await writeFile(requestsPath, "", "utf8");
  await writeFile(usageLogPath, "", "utf8");

  const entrypointPath = join(rootDir, HELPER_ENTRYPOINT);
  await writeFile(entrypointPath, renderRuntimeHelperEntrypoint(), "utf8");
  await chmod(entrypointPath, 0o755);

  const mainScriptPath = join(rootDir, HELPER_MAIN_SCRIPT);
  await writeFile(mainScriptPath, renderRuntimeHelperScript(), "utf8");
  await chmod(mainScriptPath, 0o755);

  const contextIndex: RuntimeHelperContextIndex = {
    schemaVersion: "v1",
    runId: input.runId,
    leadRoleId: input.leadRoleId,
    contexts: {},
  };

  for (const roleId of input.roleIds) {
    const context: RuntimeHelperContext = {
      runId: input.runId,
      roleId,
      leadRoleId: input.leadRoleId,
      taskListPath: input.taskListPath,
      requestsPath,
      responsesDir,
      usageLogPath,
    };
    const relativeContextPath = join("contexts", `${roleId}.json`);
    const serializedContext = JSON.stringify(context, null, 2) + "\n";
    await writeFile(join(rootDir, relativeContextPath), serializedContext, "utf8");
    await writeFile(runtimeHelperContextPath(input.workspaceDir, roleId, input.runId), serializedContext, "utf8");
    contextIndex.contexts[roleId] = relativeContextPath;
  }

  await writeFile(join(rootDir, HELPER_CONTEXT_INDEX), JSON.stringify(contextIndex, null, 2) + "\n", "utf8");

  return {
    enabled: true,
    rootDir,
    requestsPath,
    responsesDir,
    usageLogPath,
  };
}

export function startRuntimeHelperServer(options: RuntimeHelperServerOptions): RuntimeHelperServerHandle {
  const pollMs = options.pollMs ?? REQUEST_POLL_MS;
  const clock = options.clock ?? (() => new Date());
  const seenRequestIds = new Set<string>();
  const pendingWaits = new Map<string, PendingRuntimeHelperWait>();
  const pendingWaitIdsByRole = new Map<string, Set<string>>();
  let activePoll: Promise<void> | null = null;

  const poll = async () => {
    if (activePoll) {
      return await activePoll;
    }
    activePoll = processPendingRequests().finally(() => {
      activePoll = null;
    });
    return await activePoll;
  };

  const timer = setInterval(() => {
    void poll();
  }, pollMs);
  timer.unref();
  void poll();

  return {
    hasPendingWait(roleId: string) {
      return (pendingWaitIdsByRole.get(roleId)?.size ?? 0) > 0;
    },
    async resolvePendingWaitsForRole(roleId: string) {
      return await flushPendingWaits({ roleId });
    },
    async stop() {
      clearInterval(timer);
      await poll();
      await flushPendingWaits({ stop: true });
    },
  };

  async function processPendingRequests(): Promise<void> {
    while (true) {
      let raw = "";
      try {
        raw = await readFile(options.requestsPath, "utf8");
      } catch {
        return;
      }

      let processedNewRequest = false;
      const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
      for (const line of lines) {
        let request: RuntimeHelperRequest | RuntimeHelperWaitRequest;
        try {
          request = JSON.parse(line) as RuntimeHelperRequest | RuntimeHelperWaitRequest;
        } catch {
          continue;
        }
        if (seenRequestIds.has(request.id)) {
          continue;
        }
        seenRequestIds.add(request.id);
        processedNewRequest = true;
        await handleRequest(request);
      }
      await flushPendingWaits();
      if (!processedNewRequest) {
        return;
      }
    }
  }

  async function handleRequest(request: RuntimeHelperRequest | RuntimeHelperWaitRequest): Promise<void> {
    try {
      if (request.action === "send_message") {
        const sessionId = options.roleSessionId(request.roleId);
        if (request.command === "complete" || request.command === "verdict") {
          if (!sessionId) {
            throw new Error(`runtime_helper_role_session_missing:${request.roleId}`);
          }
          const taskId = request.payload.taskId;
          if (taskId) {
            const snapshot = await readTaskSnapshotFile(options.taskListPath, taskId);
            if (!snapshot) {
              throw new Error(`runtime_helper_task_not_found:${taskId}`);
            }
            if (snapshot.claimedBy !== request.roleId) {
              throw new Error(`runtime_helper_task_not_claimed:${taskId}:${request.roleId}:${snapshot.claimedBy ?? "none"}`);
            }
          }
        }
        const message = await options.sendMessage({
          ...request.payload,
          from: request.roleId,
        });
        await writeResponse({
          ok: true,
          requestId: request.id,
          messageId: message.id,
          transportMessageId: message.transportMessageId,
        });
        try {
          await options.recordMailboxMessage(
            message,
            request.roleId,
            sessionId,
            {
              authoringChannel: "runtime_helper",
              runtimeHelperRequestId: request.id,
              runtimeHelperCommand: request.command,
              runtimeHelperProcessedAt: clock().toISOString(),
            },
          );
        } catch {
          // The helper command already succeeded once the mailbox transport accepted the message.
          // Avoid surfacing a false helper timeout to the role after successful processing.
        }
        return;
      }

      if (request.action === "wait_task") {
        const startedAtMs = clock().getTime();
        const pendingWait: PendingRuntimeHelperWait = {
          requestId: request.id,
          roleId: request.roleId,
          taskId: request.payload.taskId,
          targetStatus: request.payload.targetStatus,
          startedAtMs,
          deadlineMs: startedAtMs + request.payload.timeoutMs,
        };
        if (!(await maybeResolveWait(pendingWait))) {
          pendingWaits.set(request.id, pendingWait);
          const idsForRole = pendingWaitIdsByRole.get(request.roleId) ?? new Set<string>();
          idsForRole.add(request.id);
          pendingWaitIdsByRole.set(request.roleId, idsForRole);
        }
        return;
      }

      throw new Error("unsupported_runtime_helper_action");
    } catch (error) {
      await writeResponse({
        ok: false,
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function writeResponse(response: RuntimeHelperResponse): Promise<void> {
    await mkdir(options.responsesDir, { recursive: true });
    await writeFile(join(options.responsesDir, `${response.requestId}.json`), JSON.stringify(response, null, 2) + "\n", "utf8");
  }

  async function flushPendingWaits(input?: { roleId?: string; stop?: boolean }): Promise<boolean> {
    let resolvedAny = false;
    const candidateIds = input?.roleId
      ? Array.from(pendingWaitIdsByRole.get(input.roleId) ?? [])
      : Array.from(pendingWaits.keys());
    for (const requestId of candidateIds) {
      const pending = pendingWaits.get(requestId);
      if (!pending) {
        continue;
      }
      if (await maybeResolveWait(pending, input?.stop === true)) {
        dropPendingWait(pending);
        resolvedAny = true;
      }
    }
    return resolvedAny;
  }

  function dropPendingWait(pending: PendingRuntimeHelperWait): void {
    pendingWaits.delete(pending.requestId);
    const idsForRole = pendingWaitIdsByRole.get(pending.roleId);
    if (!idsForRole) {
      return;
    }
    idsForRole.delete(pending.requestId);
    if (idsForRole.size === 0) {
      pendingWaitIdsByRole.delete(pending.roleId);
    }
  }

  async function maybeResolveWait(pending: PendingRuntimeHelperWait, forceTimeout = false): Promise<boolean> {
    const nowMs = clock().getTime();
    const snapshot = await readTaskSnapshotFile(options.taskListPath, pending.taskId).catch(() => null);
    if (!snapshot) {
      await writeResponse({
        ok: false,
        requestId: pending.requestId,
        error: `runtime_helper_task_not_found:${pending.taskId}`,
      });
      return true;
    }
    if (snapshot.status === pending.targetStatus) {
      await writeResponse({
        ok: true,
        requestId: pending.requestId,
        command: "wait",
        taskId: pending.taskId,
        targetStatus: pending.targetStatus,
        status: snapshot.status,
        waitedMs: Math.max(0, nowMs - pending.startedAtMs),
      });
      return true;
    }
    if (forceTimeout || nowMs >= pending.deadlineMs) {
      await writeResponse({
        ok: false,
        requestId: pending.requestId,
        error: `runtime_helper_wait_timeout:${pending.taskId}`,
        command: "wait",
        taskId: pending.taskId,
        targetStatus: pending.targetStatus,
        status: snapshot.status,
        waitedMs: Math.max(0, nowMs - pending.startedAtMs),
      });
      return true;
    }
    return false;
  }
}

function renderRuntimeHelperEntrypoint(): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"',
    'exec node "$SCRIPT_DIR/pluto-mailbox.mjs" "$@"',
    "",
  ].join("\n");
}

function renderRuntimeHelperScript(): string {
  return `#!/usr/bin/env node
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_RESPONSE_TIMEOUT_MS = 20000;
const DEFAULT_WAIT_TIMEOUT_MS = 600000;
const WAIT_RESPONSE_GRACE_MS = 1000;
const WAIT_TIMEOUT_STATUSES = ["pending", "in_progress", "completed"];
const DEFAULT_WAIT_STATUS = "completed";
const TASK_SNAPSHOT_RETRY_MS = 20;
const TASK_SNAPSHOT_RETRIES = 5;

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseCli(argv);
  const context = await resolveContext({
    helperRoot: dirname(process.argv[1] ?? process.cwd()),
    contextPath: parsed.contextPath,
    roleId: parsed.roleId,
    runId: parsed.runId,
  });
  if (!parsed.command || parsed.command === "help") {
    await logUsage(context, { command: "help", at: new Date().toISOString() });
    process.stdout.write(renderHelp(context) + "\\n");
    return;
  }

  switch (parsed.command) {
    case "tasks": {
      await logUsage(context, { command: "tasks", at: new Date().toISOString() });
      const raw = await readFile(context.taskListPath, "utf8");
      const tasks = JSON.parse(raw)?.tasks ?? [];
      process.stdout.write(JSON.stringify(tasks, null, 2) + "\\n");
      return;
    }
    case "send": {
      const options = parseOptions(parsed.commandArgs);
      const to = requiredOption(options, "to");
      const kind = singleOption(options, "kind") ?? "text";
      const summary = singleOption(options, "summary");
      const replyTo = singleOption(options, "reply-to");
      const taskId = singleOption(options, "task-id");
      const bodyJson = singleOption(options, "body-json");
      const bodyText = singleOption(options, "body");
      if (!bodyJson && !bodyText) {
        throw new Error("send_requires_body_json_or_body");
      }
      const body = bodyJson ? JSON.parse(bodyJson) : bodyText;
      const response = await sendRequest(context, "send", "send_message", {
        to,
        kind,
        body,
        ...(summary ? { summary } : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(taskId ? { taskId } : {}),
      });
      process.stdout.write(JSON.stringify(response, null, 2) + "\\n");
      return;
    }
    case "spawn": {
      const options = parseOptions(parsed.commandArgs);
      const taskId = requiredOption(options, "task");
      const targetRole = requiredOption(options, "role");
      const rationale = singleOption(options, "rationale");
      const response = await sendRequest(context, "spawn", "send_message", {
        to: context.leadRoleId,
        kind: "spawn_request",
        summary: \`SPAWN \${taskId}\`,
        taskId,
        body: {
          schemaVersion: "v1",
          targetRole,
          taskId,
          ...(rationale ? { rationale } : {}),
        },
      });
      process.stdout.write(JSON.stringify(response, null, 2) + "\\n");
      return;
    }
    case "complete": {
      const options = parseOptions(parsed.commandArgs);
      const taskId = requiredOption(options, "task");
      const status = singleOption(options, "status") ?? "succeeded";
      const summary = singleOption(options, "summary");
      const artifactRef = singleOption(options, "artifact-ref");
      const response = await sendRequest(context, "complete", "send_message", {
        to: context.leadRoleId,
        kind: "worker_complete",
        summary: \`COMPLETE \${taskId}\`,
        taskId,
        body: {
          schemaVersion: "v1",
          taskId,
          status,
          ...(summary ? { summary } : {}),
          ...(artifactRef ? { artifactRef } : {}),
        },
      });
      process.stdout.write(JSON.stringify(response, null, 2) + "\\n");
      return;
    }
    case "verdict": {
      const options = parseOptions(parsed.commandArgs);
      const taskId = requiredOption(options, "task");
      const verdict = requiredOption(options, "verdict");
      const rationale = singleOption(options, "rationale");
      const failedRubricRef = singleOption(options, "failed-rubric-ref");
      const response = await sendRequest(context, "verdict", "send_message", {
        to: context.leadRoleId,
        kind: "evaluator_verdict",
        summary: \`VERDICT \${taskId}\`,
        taskId,
        body: {
          schemaVersion: "v1",
          taskId,
          verdict,
          ...(rationale ? { rationale } : {}),
          ...(failedRubricRef ? { failedRubricRef } : {}),
        },
      });
      process.stdout.write(JSON.stringify(response, null, 2) + "\\n");
      return;
    }
    case "finalize": {
      const options = parseOptions(parsed.commandArgs);
      const summary = requiredOption(options, "summary");
      const completedTaskIds = optionValues(options, "completed-task");
      if (completedTaskIds.length === 0) {
        throw new Error("finalize_requires_completed_task");
      }
      const response = await sendRequest(context, "finalize", "send_message", {
        to: context.leadRoleId,
        kind: "final_reconciliation",
        summary: "FINAL_RECONCILIATION",
        body: {
          schemaVersion: "v1",
          summary,
          completedTaskIds,
        },
      });
      process.stdout.write(JSON.stringify(response, null, 2) + "\\n");
      return;
    }
    case "wait": {
      const options = parseOptions(parsed.commandArgs);
      const taskId = requiredOption(options, "task");
      const status = optionalOption(options, "status") ?? undefined;
      if (status && !WAIT_TIMEOUT_STATUSES.includes(status)) {
        throw new Error("invalid_task_status:" + status);
      }
      const timeout = parsePositiveInteger(optionalOption(options, "timeout") ?? String(DEFAULT_WAIT_TIMEOUT_MS), "timeout", true);
      const finalStatus = await sendRequest(context, "wait", "wait_task", {
        taskId,
        targetStatus: status ?? DEFAULT_WAIT_STATUS,
        timeoutMs: timeout,
      }, timeout + WAIT_RESPONSE_GRACE_MS);
      process.stdout.write(JSON.stringify(finalStatus, null, 2) + "\\n");
      return;
    }
    default:
      throw new Error(\`unknown_runtime_helper_command:\${parsed.command}\`);
  }
}

function parseCli(argv) {
  let contextPath = "";
  let roleId = "";
  let runId = "";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      return { contextPath, roleId, runId, command: "help", commandArgs: [] };
    }
    if (token === "--context") {
      contextPath = argv[index + 1] ?? "";
      if (!contextPath) {
        throw new Error("missing_value_for:--context");
      }
      index += 1;
      continue;
    }
    if (token === "--role") {
      roleId = argv[index + 1] ?? "";
      if (!roleId) {
        throw new Error("missing_value_for:--role");
      }
      index += 1;
      continue;
    }
    if (token === "--run") {
      runId = argv[index + 1] ?? "";
      if (!runId) {
        throw new Error("missing_value_for:--run");
      }
      index += 1;
      continue;
    }
    return {
      contextPath,
      roleId,
      runId,
      command: token,
      commandArgs: argv.slice(index + 1),
    };
  }
  return { contextPath, roleId, runId, command: "help", commandArgs: [] };
}

async function resolveContext(input) {
  const explicitContextPath = process.env.PLUTO_RUNTIME_HELPER_CONTEXT || input.contextPath;
  const expectedRunId = process.env.PLUTO_RUNTIME_HELPER_RUN_ID || input.runId;
  const expectedRoleId = process.env.PLUTO_RUNTIME_HELPER_ROLE || process.env.PLUTO_ROLE_ID || input.roleId;
  if (explicitContextPath) {
    const context = JSON.parse(await readFile(explicitContextPath, "utf8"));
    if (expectedRoleId && context.roleId !== expectedRoleId) {
      throw new Error("runtime_helper_context_role_mismatch:" + String(expectedRoleId) + ":" + String(context.roleId));
    }
    if (expectedRunId && context.runId !== expectedRunId) {
      throw new Error("runtime_helper_context_run_mismatch:" + String(expectedRunId) + ":" + String(context.runId));
    }
    return context;
  }

  const rawIndex = await readFile(join(input.helperRoot, "context-index.json"), "utf8");
  const contextIndex = JSON.parse(rawIndex);
  const runId = expectedRunId || contextIndex.runId;
  if (!runId) {
    throw new Error("missing_runtime_helper_run");
  }
  if (runId !== contextIndex.runId) {
    throw new Error("runtime_helper_run_not_found:" + String(runId));
  }

  const roleId = expectedRoleId;
  if (!roleId) {
    throw new Error("missing_runtime_helper_role");
  }

  const relativeContextPath = contextIndex.contexts?.[roleId];
  if (!relativeContextPath) {
    throw new Error("runtime_helper_role_not_found:" + String(roleId));
  }

  const context = JSON.parse(await readFile(join(input.helperRoot, relativeContextPath), "utf8"));
  if (context.roleId !== roleId) {
    throw new Error("runtime_helper_context_role_mismatch:" + String(roleId) + ":" + String(context.roleId));
  }
  if (context.runId !== runId) {
    throw new Error("runtime_helper_context_run_mismatch:" + String(runId) + ":" + String(context.runId));
  }
  return context;
}

function parseOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith("--")) {
      throw new Error(\`unexpected_argument:\${token ?? ""}\`);
    }
    const key = token.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(\`missing_value_for:\${token}\`);
    }
    const bucket = values.get(key) ?? [];
    bucket.push(value);
    values.set(key, bucket);
    index += 1;
  }
  return values;
}

function optionalOption(options, key) {
  const values = optionValues(options, key);
  return values.length > 0 ? values[values.length - 1] : undefined;
}

function parsePositiveInteger(value, field, allowZero = false) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error("invalid_positive_integer:" + String(field) + ":" + String(value));
  }
  return parsed;
}

function optionValues(options, key) {
  return options.get(key) ?? [];
}

function singleOption(options, key) {
  const values = optionValues(options, key);
  return values.length > 0 ? values[values.length - 1] : undefined;
}

function requiredOption(options, key) {
  const value = singleOption(options, key);
  if (!value) {
    throw new Error(\`missing_required_option:--\${key}\`);
  }
  return value;
}

async function sendRequest(context, command, action, payload, responseTimeoutMs = resolveDefaultResponseTimeoutMs()) {
  const requestId = \`runtime-helper-\${Date.now()}-\${Math.random().toString(16).slice(2, 10)}\`;
  const request = {
    schemaVersion: "v1",
    id: requestId,
    requestedAt: new Date().toISOString(),
    roleId: context.roleId,
    command,
    action,
    payload,
  };
  await logUsage(context, {
    command,
    requestId,
    roleId: context.roleId,
    payload,
    at: new Date().toISOString(),
  });
  await appendFile(context.requestsPath, JSON.stringify(request) + "\\n", "utf8");
  const responsePath = join(context.responsesDir, requestId + ".json");
  const startedAt = Date.now();
  while (Date.now() - startedAt <= responseTimeoutMs) {
    const response = await readResponse(responsePath);
    if (response) {
      return await finalizeResponse(context, command, requestId, response);
    }
    await delay(50);
  }
  const response = await readResponse(responsePath);
  if (response) {
    return await finalizeResponse(context, command, requestId, response);
  }
  const inferredSuccess = await maybeInferTimedOutSuccess(context, command, requestId, payload);
  if (inferredSuccess) {
    return await finalizeResponse(context, command, requestId, inferredSuccess);
  }
  throw new Error("runtime_helper_timeout:" + command);
}

async function maybeInferTimedOutSuccess(context, command, requestId, payload) {
  if (command !== "spawn" || !payload || typeof payload !== "object") {
    return null;
  }
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  const targetRole = typeof payload.body?.targetRole === "string" ? payload.body.targetRole : "";
  if (!taskId || !targetRole) {
    return null;
  }
  const snapshot = await readTaskSnapshot(context.taskListPath, taskId);
  if (!snapshot) {
    return null;
  }
  const claimedBy = typeof snapshot.claimedBy === "string" ? snapshot.claimedBy : undefined;
  const status = typeof snapshot.status === "string" ? snapshot.status : undefined;
  if (claimedBy !== targetRole || (status !== "in_progress" && status !== "completed")) {
    return null;
  }
  return {
    ok: true,
    requestId,
    command,
    taskId,
    status,
    targetRole,
    inferred: true,
  };
}

function resolveDefaultResponseTimeoutMs() {
  const configured = process.env.PLUTO_RUNTIME_HELPER_RESPONSE_TIMEOUT_MS;
  return configured ? parsePositiveInteger(configured, "response-timeout") : DEFAULT_RESPONSE_TIMEOUT_MS;
}

async function readResponse(responsePath) {
  try {
    const raw = await readFile(responsePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof Error) || (!error.message.includes("ENOENT") && !error.message.includes("Unexpected end of JSON input"))) {
      throw error;
    }
    return null;
  }
}

async function readTaskSnapshot(taskListPath, taskId) {
  for (let attempt = 0; attempt < TASK_SNAPSHOT_RETRIES; attempt += 1) {
    try {
      const raw = await readFile(taskListPath, "utf8");
      const tasks = JSON.parse(raw)?.tasks ?? [];
      return tasks.find((entry) => entry?.id === taskId) ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT") && !message.includes("Unexpected end of JSON input")) {
        throw error;
      }
      if (attempt === TASK_SNAPSHOT_RETRIES - 1) {
        return null;
      }
      await delay(TASK_SNAPSHOT_RETRY_MS);
    }
  }
  return null;
}

async function finalizeResponse(context, command, requestId, response) {
  await logUsage(context, {
    command,
    requestId,
    ok: response.ok === true,
    response,
    completedAt: new Date().toISOString(),
  });
  if (!response.ok) {
    throw new Error(response.error ?? "runtime_helper_request_failed");
  }
  return response;
}

function renderHelp(context) {
  const helper = "./.pluto-runtime/pluto-mailbox";
  return [
    "Pluto runtime helper",
    "",
    "Resolved role: " + String(context.roleId),
    "Run: " + String(context.runId),
    "Helper: " + helper,
    "Task list path: " + String(context.taskListPath),
    "Requests log: " + String(context.requestsPath),
    "Responses dir: " + String(context.responsesDir),
    "",
    "Use this helper instead of editing mailbox.jsonl or tasks.json directly.",
    "The canonical helper command is always " + helper + ". Do not encode the role into the executable path.",
    "Inside Pluto-run agent sessions, role/run/context are injected automatically. Outside that runtime, add --role <roleId> (preferred) or --context <path>.",
    "Treat the printed task/request/response paths as debug evidence, not alternate command locations.",
    "Start with \`tasks\` to discover the real task ids for this run, then use the matching command below.",
    "",
    "Examples:",
    "  " + helper + " tasks",
    "  " + helper + " wait --task <taskId> --status completed --timeout 600000",
    "  " + helper + " --role " + String(context.roleId) + " tasks",
    "  " + helper + " spawn --task <taskId> --role planner --rationale plan-next-step",
    "",
    "Commands:",
    "  tasks",
    "    Print the current shared task list for this run. This is the source of truth for task ids and statuses.",
    "  wait --task <taskId> [--status <pending|in_progress|completed>] [--timeout <ms>]",
    "    Block on Pluto's side until the task reaches that status (default: completed, timeout: 600000ms). Prefer this over sleeping or polling mailbox/task files.",
    "  spawn --task <taskId> --role <roleId> [--rationale <text>]",
    "    Lead command. Send a spawn_request back to " + String(context.leadRoleId) + " so Pluto claims the task and starts that teammate session.",
    "  complete --task <taskId> [--status <succeeded|failed>] [--summary <text>] [--artifact-ref <ref>]",
    "    Worker command. Post worker_complete back to " + String(context.leadRoleId) + " when your assigned task is done.",
    "  verdict --task <taskId> --verdict <pass|fail> [--rationale <text>] [--failed-rubric-ref <ref>]",
    "    Evaluator command. Post evaluator_verdict back to " + String(context.leadRoleId) + " before or alongside completion when evaluation is required.",
    "  finalize --summary <text> --completed-task <taskId> [--completed-task <taskId> ...]",
    "    Lead command. Post final_reconciliation back to " + String(context.leadRoleId) + " after the required tasks are complete.",
    "  send --to <role> --kind <kind> (--body <text> | --body-json <json>) [--summary <text>] [--reply-to <id>] [--task-id <id>]",
    "    Generic escape hatch for a typed mailbox envelope through Pluto's runtime API when the specialized commands do not fit.",
    "",
    "Wait vs direct-send:",
    "  \`wait\` is not a local sleep. It asks Pluto to watch task state for you.",
    "  If a role is currently blocked in helper wait, Pluto can satisfy that wait directly when the relevant task transition is semantically handled.",
    "  If the role is not waiting, Pluto may still fall back to direct session delivery through Paseo for the same mailbox traffic.",
    "  If a message was queued while a role was busy, Pluto re-checks the helper wait/semantic path before doing a later direct send.",
    "",
    "Expected role behavior:",
    "  - Lead: inspect tasks, use the exact returned task ids, spawn teammates, optionally wait for task completion, then finalize.",
    "  - Workers: do the assigned task, optionally wait for dependency/task progress in your lane, then complete.",
    "  - Evaluator: send verdict before or alongside completion when required, then complete if you own a task.",
    "  - Prefer the higher-level commands over \`send\` when they match your intent.",
    "  - Never guess playbook stage ids, and never edit mailbox.jsonl or tasks.json directly; this helper is the runtime API surface.",
  ].join("\\n");
}

async function logUsage(context, payload) {
  try {
    await mkdir(dirname(context.usageLogPath), { recursive: true });
    await appendFile(context.usageLogPath, JSON.stringify({ runId: context.runId, roleId: context.roleId, ...payload }) + "\\n", "utf8");
  } catch {
    // best effort only
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
`;
}
