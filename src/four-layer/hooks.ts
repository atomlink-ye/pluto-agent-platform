import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import type { RunProfileAcceptanceCommand, TaskRecord } from "../contracts/four-layer.js";
import { FileBackedTaskList } from "./task-list.js";

const exec = promisify(execCallback);

export type HookName = "TaskCreated" | "TaskCompleted" | "TeammateIdle";

export interface HookResponse {
  exitCode: number;
  message?: string;
}

export type HookHandler<TContext> = (context: TContext) => Promise<HookResponse>;

export interface HookRunResult {
  blocked: boolean;
  messages: string[];
}

export async function runHooks<TContext>(handlers: ReadonlyArray<HookHandler<TContext>>, context: TContext): Promise<HookRunResult> {
  const messages: string[] = [];
  for (const handler of handlers) {
    const response = await handler(context);
    if (response.message) {
      messages.push(response.message);
    }
    if (response.exitCode === 2) {
      return { blocked: true, messages };
    }
  }
  return { blocked: false, messages };
}

export function createAcceptanceHook(input: {
  workspaceDir: string;
  acceptanceCommands: ReadonlyArray<RunProfileAcceptanceCommand>;
  taskList: FileBackedTaskList;
}): HookHandler<{ task: TaskRecord }> {
  return async () => {
    const tasks = await input.taskList.list();
    if (tasks.some((task) => task.status !== "completed")) {
      return { exitCode: 0 };
    }
    for (const command of input.acceptanceCommands) {
      const cmd = typeof command === "string" ? command : command.cmd;
      const blockerOk = typeof command === "string" ? false : command.blockerOk ?? false;
      try {
        await exec(cmd, { cwd: input.workspaceDir, env: process.env, maxBuffer: 1024 * 1024 });
      } catch (error) {
        if (!blockerOk) {
          const message = error instanceof Error ? error.message : String(error);
          return { exitCode: 2, message: `TaskCompleted hook failed: ${cmd} (${message})` };
        }
      }
    }
    return { exitCode: 0 };
  };
}

export function createIdleNudgeHook(input: {
  roleId: string;
  taskList: FileBackedTaskList;
}): HookHandler<{ roleId: string }> {
  return async () => {
    const tasks = await input.taskList.list();
    const available = tasks.find(
      (task) => task.status === "pending" && (!task.assigneeId || task.assigneeId === input.roleId),
    );
    if (!available) {
      return { exitCode: 0 };
    }
    return { exitCode: 2, message: `TeammateIdle: task ${available.id} is available for ${input.roleId}` };
  };
}
