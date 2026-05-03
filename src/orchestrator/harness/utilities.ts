import { randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AgentEvent } from "../../contracts/types.js";
import type { DispatchOrchestrationSource, EvaluatorVerdictBody, RunProfileAcceptanceCommand, RunStatus } from "../../contracts/four-layer.js";

const exec = promisify(execCallback);

export async function executeAcceptanceCommand(
  command: RunProfileAcceptanceCommand,
  commandCwd: string,
  runDir: string,
  index: number,
  clock: () => Date,
): Promise<CommandExecutionResult> {
  const spec = typeof command === "string" ? { cmd: command, blockerOk: false } : { cmd: command.cmd, blockerOk: command.blockerOk ?? false };
  const startedAt = clock().toISOString();
  try {
    const { stdout, stderr } = await exec(spec.cmd, { cwd: commandCwd, env: process.env, maxBuffer: 1024 * 1024 });
    const stdoutPath = join(runDir, `command-${index}.stdout.log`);
    const stderrPath = join(runDir, `command-${index}.stderr.log`);
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, stderr, "utf8");
    return { cmd: spec.cmd, exitCode: 0, summary: "ok", stdout, stderr, stdoutPath, stderrPath, blockerOk: spec.blockerOk, startedAt, finishedAt: clock().toISOString() };
  } catch (error) {
    const stdout = typeof error === "object" && error !== null && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
    const exitCode = typeof error === "object" && error !== null && "code" in error ? Number((error as { code?: number }).code ?? 1) : 1;
    const stdoutPath = join(runDir, `command-${index}.stdout.log`);
    const stderrPath = join(runDir, `command-${index}.stderr.log`);
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, stderr, "utf8");
    return { cmd: spec.cmd, exitCode, summary: spec.blockerOk ? "blocker_ok" : "failed", stdout, stderr, stdoutPath, stderrPath, blockerOk: spec.blockerOk, startedAt, finishedAt: clock().toISOString() };
  }
}

export function resolveRunStatus(issues: string[], auditOk: boolean): RunStatus {
  if (!auditOk) return "failed_audit";
  if (issues.length > 0) return "failed";
  return "succeeded";
}

export function buildCompletionMessageBody(taskId: string, output: string): string {
  return [`Task ${taskId} complete.`, `Summary: ${firstNonEmptyLine(output) || "completed"}`].join("\n");
}

export function findWorkerCompletedEvent(events: ReadonlyArray<AgentEvent>, roleId: string): AgentEvent | undefined {
  return [...events].reverse().find((event) => event.type === "worker_completed" && event.roleId === roleId);
}

export function extractStructuredWorkerMessage(
  output: string,
  taskId: string,
): { kind: "evaluator_verdict"; body: EvaluatorVerdictBody; summary: string } | null {
  const typedEnvelopeMatch = /evaluator_verdict\s*[\r\n]+body:\s*\{([\s\S]*?)\}/i.exec(output);
  if (typedEnvelopeMatch) {
    const bodyBlock = typedEnvelopeMatch[1] ?? "";
    const taskIdMatch = /taskId:\s*"([^"]+)"/i.exec(bodyBlock);
    const verdictMatch = /verdict:\s*"(pass|fail)"/i.exec(bodyBlock);
    if (taskIdMatch?.[1] && verdictMatch?.[1]) {
      const rationaleMatch = /rationale:\s*"([\s\S]*?)"/i.exec(bodyBlock);
      const failedRubricRefMatch = /failedRubricRef:\s*"([^"]+)"/i.exec(bodyBlock);
      const verdictBody: EvaluatorVerdictBody = {
        schemaVersion: "v1",
        taskId: taskIdMatch[1] || taskId,
        verdict: verdictMatch[1] as EvaluatorVerdictBody["verdict"],
        ...(rationaleMatch?.[1] ? { rationale: rationaleMatch[1] } : {}),
        ...(failedRubricRefMatch?.[1] ? { failedRubricRef: failedRubricRefMatch[1] } : {}),
      };
      return {
        kind: "evaluator_verdict",
        body: verdictBody,
        summary: `VERDICT ${verdictBody.taskId} ${verdictBody.verdict.toUpperCase()}`,
      };
    }
  }

  const candidates = [
    ...Array.from(output.matchAll(/```json\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
    ...output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0),
  ];
  for (const candidate of [...candidates].reverse()) {
    if (!candidate.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const kind = parsed["kind"] === "evaluator_verdict"
        ? "evaluator_verdict"
        : (parsed["type"] === "evaluator_verdict" ? "evaluator_verdict" : null);
      const body = typeof parsed["body"] === "object" && parsed["body"] !== null
        ? parsed["body"] as Record<string, unknown>
        : null;
      if (!kind || !body || body["schemaVersion"] !== "v1") {
        continue;
      }
      if ((body["verdict"] !== "pass" && body["verdict"] !== "fail") || typeof body["taskId"] !== "string") {
        continue;
      }
      const verdictBody: EvaluatorVerdictBody = {
        schemaVersion: "v1",
        taskId: String(body["taskId"] || taskId),
        verdict: body["verdict"],
        ...(typeof body["rationale"] === "string" ? { rationale: body["rationale"] } : {}),
        ...(typeof body["failedRubricRef"] === "string" ? { failedRubricRef: body["failedRubricRef"] } : {}),
      };
      return {
        kind,
        body: verdictBody,
        summary: `VERDICT ${verdictBody.taskId} ${verdictBody.verdict.toUpperCase()}`,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function resolveDispatchMode(value: string | undefined): DispatchOrchestrationSource {
  return value === "static_loop" ? "static_loop" : "teamlead_chat";
}

export async function readWorkspaceArtifact(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function bestEffortCleanup(
  operation: () => Promise<unknown> | undefined,
  timeoutMs: number,
): Promise<void> {
  const pending = operation();
  if (!pending) {
    return;
  }
  await Promise.race([
    pending.catch(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

export interface CommandExecutionResult {
  cmd: string;
  exitCode: number;
  summary: string;
  stdout: string;
  stderr: string;
  stdoutPath: string;
  stderrPath: string;
  blockerOk: boolean;
  startedAt: string;
  finishedAt: string;
}

function firstNonEmptyLine(value: string): string {
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    return line.replace(/^#+\s*/, "");
  }
  return "";
}