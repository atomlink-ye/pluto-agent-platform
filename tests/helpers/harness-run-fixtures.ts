import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";
import type { TaskRecord } from "@/contracts/four-layer.js";
import type { AgentEvent, TeamConfig } from "@/contracts/types.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const exec = promisify(execFile);

export class CapturingTransport extends FakeMailboxTransport {
  roomRef: string | undefined;

  override async createRoom(input: Parameters<FakeMailboxTransport["createRoom"]>[0]) {
    const room = await super.createRoom(input);
    this.roomRef = room;
    return room;
  }
}

export type CreateHarnessRunOptions<TAdapter extends FakeAdapter = FakeAdapter> = {
  name: string;
  tempDirs?: string[];
  repoRoot?: string;
  selection?: Parameters<typeof runManagerHarness>[0]["selection"];
  workspacePrefix?: string;
  prepareWorkspace?: (workspaceRoot: string) => Promise<void>;
  workspaceSubdirPerRun?: boolean;
  autoDriveDispatch?: boolean;
  createAdapter?: (input: { team: TeamConfig }) => TAdapter;
  createMailboxTransport?: () => CapturingTransport;
  workspacePathResolver?: (workspaceRoot: string, runId: string) => string;
  waitForWorkspace?: (input: {
    workspaceRoot: string;
    workspace: string;
    runDir: string;
    runId: string;
    transport: CapturingTransport;
  }) => Promise<void>;
};

export type HarnessRunFixture<TAdapter extends FakeAdapter = FakeAdapter> = {
  adapter: TAdapter;
  dataDir: string;
  resultPromise: ReturnType<typeof runManagerHarness>;
  roomRef: string;
  runDir: string;
  runId: string;
  transport: CapturingTransport;
  workspace: string;
  workspaceRoot: string;
};

export async function createHarnessRun<TAdapter extends FakeAdapter = FakeAdapter>(
  options: CreateHarnessRunOptions<TAdapter>,
): Promise<HarnessRunFixture<TAdapter>> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), options.workspacePrefix ?? `pluto-harness-${options.name}-`));
  options.tempDirs?.push(workspaceRoot);
  await options.prepareWorkspace?.(workspaceRoot);

  const dataDir = join(workspaceRoot, ".pluto");
  const runId = `run-${options.name}`;
  let idSequence = 0;
  let adapter!: TAdapter;

  const transport = options.createMailboxTransport?.() ?? new CapturingTransport();
  const resultPromise = runManagerHarness({
    rootDir: options.repoRoot ?? process.cwd(),
    selection: options.selection ?? { scenario: "hello-team", runProfile: "fake-smoke" },
    workspaceOverride: workspaceRoot,
    workspaceSubdirPerRun: options.workspaceSubdirPerRun,
    dataDir,
    idGen: () => {
      idSequence += 1;
      return idSequence === 1 ? runId : `${runId}-id-${idSequence}`;
    },
    autoDriveDispatch: options.autoDriveDispatch ?? true,
    createAdapter: ({ team }) => {
      const createdAdapter = options.createAdapter?.({ team }) ?? (new FakeAdapter({ team }) as TAdapter);
      adapter = createdAdapter;
      return createdAdapter;
    },
    createMailboxTransport: () => transport,
  });

  const runDir = join(dataDir, "runs", runId);
  await waitFor(async () => {
    await access(join(runDir, "tasks.json"));
    return Boolean(transport.roomRef);
  });

  const workspace = options.workspacePathResolver?.(workspaceRoot, runId) ?? workspaceRoot;
  await options.waitForWorkspace?.({ workspaceRoot, workspace, runDir, runId, transport });

  return {
    adapter,
    dataDir,
    resultPromise,
    roomRef: transport.roomRef!,
    runDir,
    runId,
    transport,
    workspace,
    workspaceRoot,
  };
}

export async function waitForEvent(
  runDir: string,
  predicate: (event: AgentEvent) => boolean,
  timeoutMs = 5_000,
): Promise<AgentEvent> {
  await waitFor(async () => (await readEvents(runDir)).some(predicate), timeoutMs);
  return (await readEvents(runDir)).find(predicate)!;
}

export async function waitForTasks(runDir: string, expectedCount: number): Promise<TaskRecord[]> {
  await waitFor(async () => (await readTasks(runDir)).length === expectedCount);
  return await readTasks(runDir);
}

export async function readEvents(runDir: string): Promise<AgentEvent[]> {
  return await readJsonLines<AgentEvent>(join(runDir, "events.jsonl"));
}

export async function readTasks(runDir: string): Promise<TaskRecord[]> {
  const raw = await readFile(join(runDir, "tasks.json"), "utf8");
  return (JSON.parse(raw) as { tasks?: TaskRecord[] }).tasks ?? [];
}

export async function readJsonLines<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export function taskByAssignee(tasks: TaskRecord[], assigneeId: string): TaskRecord {
  const task = tasks.find((entry) => entry.assigneeId === assigneeId);
  if (!task) {
    throw new Error(`task not found for ${assigneeId}`);
  }
  return task;
}

export async function invokeRuntimeHelper<T>(workspace: string, roleId: string, args: string[]): Promise<T> {
  const helperPath = join(workspace, ".pluto-runtime", "pluto-mailbox");
  const { stdout } = await exec(helperPath, ["--role", roleId, ...args], { cwd: workspace, timeout: 15_000 });
  return JSON.parse(stdout) as T;
}

export async function invokeRuntimeHelperText(workspace: string, roleId: string, args: string[]): Promise<string> {
  const helperPath = join(workspace, ".pluto-runtime", "pluto-mailbox");
  const { stdout } = await exec(helperPath, ["--role", roleId, ...args], { cwd: workspace, timeout: 15_000 });
  return stdout;
}

export async function invokeRuntimeHelperFailure(
  workspace: string,
  roleId: string,
  args: string[],
  timeout = 15_000,
): Promise<{ stderr: string; killed: boolean }> {
  const helperPath = join(workspace, ".pluto-runtime", "pluto-mailbox");
  try {
    await exec(helperPath, ["--role", roleId, ...args], { cwd: workspace, timeout });
    throw new Error("expected helper command to fail");
  } catch (error) {
    const failure = error as { stderr?: string; killed?: boolean };
    return {
      stderr: failure.stderr ?? "",
      killed: failure.killed === true,
    };
  }
}

export async function withEnv<T>(entries: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(entries)) {
    original.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    let ready = false;
    try {
      ready = await predicate();
    } catch {
      ready = false;
    }

    if (ready) {
      return;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }

    await pause(25);
  }
}

export async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
