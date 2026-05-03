import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TaskRecord } from "../contracts/four-layer.js";
import {
  captureRuntimeOwnedFileSnapshot,
  persistRuntimeOwnedFileSnapshot,
  readRuntimeOwnedFileSnapshot,
  runtimeOwnedSnapshotPath,
  type RuntimeOwnedFileSnapshot,
} from "./runtime-owned-files.js";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

interface StoredTaskState {
  nextId: number;
  tasks: TaskRecord[];
}

export interface TaskListStoreOptions {
  runDir: string;
  clock?: () => Date;
}

export class FileBackedTaskList {
  private readonly runDir: string;
  private readonly clock: () => Date;

  constructor(options: TaskListStoreOptions) {
    this.runDir = options.runDir;
    this.clock = options.clock ?? (() => new Date());
  }

  path(): string {
    return join(this.runDir, "tasks.json");
  }

  runtimeSnapshotPath(): string {
    return runtimeOwnedSnapshotPath(this.runDir, "tasklist");
  }

  async ensure(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    try {
      await readFile(this.path(), "utf8");
    } catch {
      await writeFile(this.path(), JSON.stringify({ nextId: 1, tasks: [] }, null, 2) + "\n", "utf8");
      await this.captureRuntimeSnapshot();
    }
  }

  async list(): Promise<TaskRecord[]> {
    await this.ensure();
    const state = await this.readState();
    return state.tasks;
  }

  async read(taskId: string): Promise<TaskRecord | null> {
    const tasks = await this.list();
    return tasks.find((task) => task.id === taskId) ?? null;
  }

  async create(input: { summary: string; assigneeId?: string; dependsOn?: string[]; artifacts?: string[] }): Promise<TaskRecord> {
    await this.ensure();
    return withFileLock(`${this.path()}.lock`, async () => {
      const state = await this.readState();
      const now = this.clock().toISOString();
      const task: TaskRecord = {
        id: `task-${state.nextId}`,
        status: "pending",
        dependsOn: input.dependsOn ?? [],
        createdAt: now,
        updatedAt: now,
        summary: input.summary,
        artifacts: input.artifacts ?? [],
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
      };
      state.nextId += 1;
      state.tasks.push(task);
      await this.writeState(state);
      return task;
    });
  }

  async claim(taskId: string, agentId: string): Promise<TaskRecord> {
    await this.ensure();
    return withFileLock(`${this.path()}.lock`, async () => {
      const state = await this.readState();
      if (state.tasks.some((task) => task.status === "in_progress" && task.claimedBy === agentId)) {
        throw new Error(`agent_busy:${agentId}`);
      }
      const task = state.tasks.find((entry) => entry.id === taskId);
      if (!task) {
        throw new Error(`task_not_found:${taskId}`);
      }
      const blockers = task.dependsOn
        .map((dependencyId) => state.tasks.find((entry) => entry.id === dependencyId))
        .filter((dependency): dependency is TaskRecord => dependency !== undefined)
        .filter((dependency) => dependency.status !== "completed");
      if (blockers.length > 0) {
        throw new Error(`task_blocked:${taskId}`);
      }
      task.status = "in_progress";
      task.claimedBy = agentId;
      task.updatedAt = this.clock().toISOString();
      await this.writeState(state);
      return task;
    });
  }

  async update(taskId: string, mutate: (task: TaskRecord) => TaskRecord): Promise<TaskRecord> {
    await this.ensure();
    return withFileLock(`${this.taskLockPath(taskId)}`, async () => {
      const state = await this.readState();
      const index = state.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) {
        throw new Error(`task_not_found:${taskId}`);
      }
      const next = mutate({ ...state.tasks[index]! });
      next.updatedAt = this.clock().toISOString();
      state.tasks[index] = next;
      await this.writeState(state);
      return next;
    });
  }

  async complete(taskId: string, artifacts: string[] = []): Promise<TaskRecord> {
    return this.update(taskId, (task) => ({
      ...task,
      status: "completed",
      artifacts,
    }));
  }

  async delete(taskId: string): Promise<void> {
    await this.ensure();
    await withFileLock(`${this.path()}.lock`, async () => {
      const state = await this.readState();
      state.tasks = state.tasks.filter((task) => task.id !== taskId);
      await this.writeState(state);
    });
  }

  async readRuntimeSnapshot(): Promise<RuntimeOwnedFileSnapshot | null> {
    return readRuntimeOwnedFileSnapshot(this.runtimeSnapshotPath());
  }

  private taskLockPath(taskId: string): string {
    return join(this.runDir, `${taskId}.lock`);
  }

  private async readState(): Promise<StoredTaskState> {
    const raw = await readFile(this.path(), "utf8");
    const parsed = JSON.parse(raw) as StoredTaskState;
    return {
      nextId: typeof parsed.nextId === "number" ? parsed.nextId : 1,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    };
  }

  private async writeState(state: StoredTaskState): Promise<void> {
    await writeFile(this.path(), JSON.stringify(state, null, 2) + "\n", "utf8");
    await this.captureRuntimeSnapshot();
  }

  private async captureRuntimeSnapshot(): Promise<void> {
    // Best-effort: audit guard is emit-only, so snapshot I/O failure must not
    // fail the surrounding task-list write.
    try {
      const snapshot = await captureRuntimeOwnedFileSnapshot(this.path(), this.clock().toISOString());
      await persistRuntimeOwnedFileSnapshot(this.runtimeSnapshotPath(), snapshot);
    } catch {
      // intentionally swallowed
    }
  }
}

async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        return await fn();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}
