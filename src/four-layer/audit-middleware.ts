import { readFile } from "node:fs/promises";

import type { MailboxMessage, Playbook, RunProfile, TaskRecord } from "../contracts/four-layer.js";
import { runAcceptanceChecks } from "./acceptance-runner.js";

export type AuditIssueCode =
  | "missing_required_role"
  | "missing_completion_message"
  | "missing_final_summary"
  | "missing_final_citation"
  | "invalid_task_list"
  | "invalid_mailbox_log"
  | "missing_required_file"
  | "missing_required_section"
  | "missing_stdout_line"
  | "invalid_stdout_pattern"
  | "unreadable_required_file";

export interface AuditIssue {
  code: AuditIssueCode;
  message: string;
  path?: string;
  role?: string;
  section?: string;
  requirement?: string;
}

export interface AuditMiddlewareInput {
  artifactRootDir: string;
  stdout: string;
  playbook: Pick<Playbook, "audit">;
  runProfile: Pick<RunProfile, "artifactContract" | "stdoutContract">;
  mailboxLogPath: string;
  taskListPath: string;
  teamLeadId: string;
}

export interface AuditMiddlewareResult {
  ok: boolean;
  status: "succeeded" | "failed_audit";
  issues: AuditIssue[];
}

export async function runAuditMiddleware(input: AuditMiddlewareInput): Promise<AuditMiddlewareResult> {
  const acceptance = await runAcceptanceChecks({
    artifactRootDir: input.artifactRootDir,
    stdout: input.stdout,
    runProfile: input.runProfile,
  });
  const issues: AuditIssue[] = acceptance.issues.map((issue) => ({
    code: issue.code as AuditIssueCode,
    message: issue.message,
    ...(issue.path ? { path: issue.path } : {}),
    ...(issue.section ? { section: issue.section } : {}),
    ...(issue.requirement ? { requirement: issue.requirement } : {}),
  }));
  const requiredRoles = input.playbook.audit?.requiredRoles ?? [];
  const tasks = await readTasks(input.taskListPath, issues);
  const mailbox = await readMailbox(input.mailboxLogPath, issues);

  if (tasks && mailbox) {
    const completionMessages = new Map<string, MailboxMessage>();
    for (const role of requiredRoles) {
      const completedTask = tasks.find((task) => task.assigneeId === role && task.status === "completed");
      if (!completedTask) {
        issues.push({
          code: "missing_required_role",
          message: `required role missing completed task: ${role}`,
          role,
          path: input.taskListPath,
        });
        continue;
      }
      const completionMessage = mailbox.find((message) =>
        message.from === role
        && message.to === input.teamLeadId
        && typeof message.summary === "string"
        && message.summary.startsWith("COMPLETE ")
        && includesTaskId(message, completedTask.id),
      );
      if (!completionMessage) {
        issues.push({
          code: "missing_completion_message",
          message: `required role missing completion mailbox message: ${role}`,
          role,
          path: input.mailboxLogPath,
        });
        continue;
      }
      completionMessages.set(role, completionMessage);
    }

    const finalSummary = [...mailbox].reverse().find((message) => message.from === input.teamLeadId && message.summary === "FINAL");
    if (!finalSummary) {
      issues.push({
        code: "missing_final_summary",
        message: "missing FINAL summary mailbox message from the team lead",
        path: input.mailboxLogPath,
      });
    } else {
      const finalBody = typeof finalSummary.body === "string" ? finalSummary.body : JSON.stringify(finalSummary.body);
      for (const role of requiredRoles) {
        const completionMessage = completionMessages.get(role);
        if (!completionMessage) continue;
        if (!finalBody.includes(completionMessage.id)) {
          issues.push({
            code: "missing_final_citation",
            message: `FINAL summary missing completion message id for role ${role}`,
            role,
            path: input.mailboxLogPath,
          });
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "succeeded" : "failed_audit",
    issues,
  };
}

async function readTasks(taskListPath: string, issues: AuditIssue[]): Promise<TaskRecord[] | null> {
  try {
    const raw = await readFile(taskListPath, "utf8");
    const parsed = JSON.parse(raw) as { tasks?: TaskRecord[] };
    if (!Array.isArray(parsed.tasks)) {
      issues.push({ code: "invalid_task_list", message: "tasks.json missing tasks array", path: taskListPath });
      return null;
    }
    return parsed.tasks;
  } catch (error) {
    issues.push({
      code: "invalid_task_list",
      message: `unable to read tasks.json: ${error instanceof Error ? error.message : String(error)}`,
      path: taskListPath,
    });
    return null;
  }
}

async function readMailbox(mailboxLogPath: string, issues: AuditIssue[]): Promise<MailboxMessage[] | null> {
  try {
    const raw = await readFile(mailboxLogPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as MailboxMessage);
  } catch (error) {
    issues.push({
      code: "invalid_mailbox_log",
      message: `unable to read mailbox log: ${error instanceof Error ? error.message : String(error)}`,
      path: mailboxLogPath,
    });
    return null;
  }
}

function includesTaskId(message: MailboxMessage, taskId: string): boolean {
  if (message.replyTo === taskId) return true;
  if (typeof message.body === "string") return message.body.includes(taskId);
  if (typeof message.body === "object" && message.body !== null) {
    return JSON.stringify(message.body).includes(taskId);
  }
  return false;
}
