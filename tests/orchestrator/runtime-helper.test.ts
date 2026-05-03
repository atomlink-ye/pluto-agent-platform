import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";
import type { MailboxEnvelope, MailboxMessage, TaskRecord, WorkerCompleteBody } from "@/contracts/four-layer.js";
import type { AgentEvent, TeamConfig } from "@/contracts/types.js";
import { FileBackedTaskList } from "@/four-layer/index.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";
import {
  materializeRuntimeHelperWorkspace,
  runtimeHelperContextPath,
  startRuntimeHelperServer,
  type RuntimeHelperSendMessageRequest,
  type RuntimeHelperServerHandle,
} from "@/orchestrator/runtime-helper.js";

const exec = promisify(execFile);
const repoRoot = process.cwd();
const tempDirs: string[] = [];
const activeServers: RuntimeHelperServerHandle[] = [];

afterEach(async () => {
  await Promise.allSettled(activeServers.splice(0).map((server) => server.stop()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function startTrackedRuntimeHelperServer(
  options: Parameters<typeof startRuntimeHelperServer>[0],
): RuntimeHelperServerHandle {
  const server = startRuntimeHelperServer(options);
  let stopped = false;
  const tracked: RuntimeHelperServerHandle = {
    hasPendingWait: server.hasPendingWait.bind(server),
    resolvePendingWaitsForRole: server.resolvePendingWaitsForRole.bind(server),
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      const index = activeServers.indexOf(tracked);
      if (index >= 0) {
        activeServers.splice(index, 1);
      }
      await server.stop();
    },
  };
  activeServers.push(tracked);
  return tracked;
}

describe.sequential("runtime helper MVP", () => {
  it("keeps run-local helper contexts while refreshing shared contexts when the same workspace is reused", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-isolation-"));
    const runDir1 = join(workspace, ".pluto", "runs", "run-isolation-1");
    const runDir2 = join(workspace, ".pluto", "runs", "run-isolation-2");
    tempDirs.push(workspace);

    await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir: runDir1,
      runId: "run-isolation-1",
      leadRoleId: "lead",
      roleIds: ["lead", "planner", "generator", "evaluator"],
      taskListPath: join(runDir1, "tasks.json"),
    });

    const firstContextRaw = await readFile(runtimeHelperContextPath(workspace, "lead"), "utf8");
    const firstRunLocalContextRaw = await readFile(runtimeHelperContextPath(workspace, "lead", "run-isolation-1"), "utf8");
    const firstContext = JSON.parse(firstContextRaw) as { runId: string; taskListPath: string; requestsPath: string };
    const firstRunLocalContext = JSON.parse(firstRunLocalContextRaw) as { runId: string; taskListPath: string; requestsPath: string };
    expect(firstContext.runId).toBe("run-isolation-1");
    expect(firstContext.taskListPath).toBe(join(runDir1, "tasks.json"));
    expect(firstRunLocalContext).toMatchObject(firstContext);

    await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir: runDir2,
      runId: "run-isolation-2",
      leadRoleId: "lead",
      roleIds: ["lead", "planner", "generator", "evaluator"],
      taskListPath: join(runDir2, "tasks.json"),
    });

    const secondContextRaw = await readFile(runtimeHelperContextPath(workspace, "lead"), "utf8");
    const secondRunLocalContextRaw = await readFile(runtimeHelperContextPath(workspace, "lead", "run-isolation-2"), "utf8");
    const preservedFirstRunLocalContextRaw = await readFile(runtimeHelperContextPath(workspace, "lead", "run-isolation-1"), "utf8");
    const secondContext = JSON.parse(secondContextRaw) as { runId: string; taskListPath: string; requestsPath: string };
    const secondRunLocalContext = JSON.parse(secondRunLocalContextRaw) as { runId: string; taskListPath: string; requestsPath: string };
    const preservedFirstRunLocalContext = JSON.parse(preservedFirstRunLocalContextRaw) as { runId: string; taskListPath: string; requestsPath: string };
    expect(secondContext.runId).toBe("run-isolation-2");
    expect(secondContext.taskListPath).toBe(join(runDir2, "tasks.json"));
    expect(secondContext.requestsPath).not.toBe(firstContext.requestsPath);
    expect(secondContext.runId).not.toBe(firstContext.runId);
    expect(secondRunLocalContext).toMatchObject(secondContext);
    expect(preservedFirstRunLocalContext).toMatchObject(firstRunLocalContext);
  });

  it("does not materialize per-role helper executables", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-no-role-execs-"));
    const runDir = join(workspace, ".pluto", "runs", "run-no-role-execs");
    tempDirs.push(workspace);

    await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir,
      runId: "run-no-role-execs",
      leadRoleId: "lead",
      roleIds: ["lead", "planner", "evaluator"],
      taskListPath: join(runDir, "tasks.json"),
    });

    await expect(access(join(workspace, ".pluto-runtime", "pluto-mailbox"))).resolves.toBeUndefined();
    await expect(access(join(workspace, ".pluto-runtime", "roles", "lead", "pluto-mailbox"))).rejects.toBeTruthy();
    await expect(access(join(workspace, ".pluto-runtime", "roles", "planner", "pluto-mailbox"))).rejects.toBeTruthy();
    await expect(access(join(workspace, ".pluto-runtime", "roles", "evaluator", "pluto-mailbox"))).rejects.toBeTruthy();
  });

  it("deletes stale per-role helper executables from reused workspaces", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-clean-roles-"));
    const runDir = join(workspace, ".pluto", "runs", "run-clean-roles");
    const staleRoleDir = join(workspace, ".pluto-runtime", "roles", "lead");
    tempDirs.push(workspace);

    await mkdir(staleRoleDir, { recursive: true });
    await writeFile(join(staleRoleDir, "pluto-mailbox"), "stale wrapper\n", "utf8");

    await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir,
      runId: "run-clean-roles",
      leadRoleId: "lead",
      roleIds: ["lead", "planner"],
      taskListPath: join(runDir, "tasks.json"),
    });

    await expect(access(join(workspace, ".pluto-runtime", "pluto-mailbox"))).resolves.toBeUndefined();
    await expect(access(join(workspace, ".pluto-runtime", "roles"))).rejects.toBeTruthy();
  });

  it("materializes a shared helper CLI that can list tasks and author typed envelopes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-"));
    const runDir = join(workspace, ".pluto", "runs", "run-helper");
    tempDirs.push(workspace);

    const taskList = new FileBackedTaskList({ runDir });
    await taskList.ensure();
    const task = await taskList.create({ assigneeId: "planner", summary: "planner: hello" });
    const evaluatorTask = await taskList.create({ assigneeId: "evaluator", summary: "evaluator: hello" });
    const helper = await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir,
      runId: "run-helper",
      leadRoleId: "lead",
      roleIds: ["lead", "planner", "evaluator"],
      taskListPath: taskList.path(),
    });

    const sent: Array<Record<string, unknown>> = [];
    const server = startTrackedRuntimeHelperServer({
      taskListPath: taskList.path(),
      requestsPath: helper.requestsPath,
      responsesDir: helper.responsesDir,
      roleSessionId: (roleId) => `${roleId}-session`,
      sendMessage: async (input) => {
        sent.push({ ...input } as Record<string, unknown>);
        return {
          id: `message-${sent.length}`,
          to: input.to,
          from: input.from,
          createdAt: new Date().toISOString(),
          kind: input.kind ?? "text",
          body: input.body,
          ...(input.summary ? { summary: input.summary } : {}),
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          transportMessageId: `transport-${sent.length}`,
        } satisfies MailboxMessage;
      },
      recordMailboxMessage: async () => undefined,
    });

    try {
      const listedTasks = await invokeRuntimeHelper<TaskRecord[]>(workspace, "lead", ["tasks"]);
      const helpText = await invokeRuntimeHelperText(workspace, "lead", ["help"]);
      const waitPromise = invokeRuntimeHelper<{ ok: boolean; status: string; taskId: string }>(workspace, "lead", [
        "wait",
        "--task",
        task.id,
        "--status",
        "completed",
        "--timeout",
        "3000",
      ]);
      await delay(100);
      await taskList.claim(task.id, "planner");
      await taskList.complete(task.id, []);
      const waited = await waitPromise;

      expect(listedTasks.map((entry) => entry.id)).toEqual([task.id, evaluatorTask.id]);
      expect(waited).toMatchObject({ ok: true, status: "completed", taskId: task.id });
      expect(helpText).toContain("Run: run-helper");
      expect(helpText).toContain(`Task list path: ${taskList.path()}`);
      expect(helpText).toContain("Examples:");
      expect(helpText).toContain("The canonical helper command is always ./.pluto-runtime/pluto-mailbox. Do not encode the role into the executable path.");
      expect(helpText).toContain("Inside Pluto-run agent sessions, role/run/context are injected automatically. Outside that runtime, add --role <roleId> (preferred) or --context <path>.");
      expect(helpText).toContain("./.pluto-runtime/pluto-mailbox wait --task <taskId> --status completed --timeout 600000");
      expect(helpText).toContain("./.pluto-runtime/pluto-mailbox --role lead tasks");
      expect(helpText).toContain("Wait vs direct-send:");
      expect(helpText).toContain("spawn --task <taskId> --role <roleId>");
      expect(helpText).toContain("Use this helper instead of editing mailbox.jsonl or tasks.json directly.");

      const spawn = await invokeRuntimeHelper<{ ok: boolean }>(workspace, "lead", [
        "spawn",
        "--task",
        task.id,
        "--role",
        "planner",
        "--rationale",
        "draft plan",
      ]);
      const complete = await invokeRuntimeHelper<{ ok: boolean }>(workspace, "planner", [
        "complete",
        "--task",
        task.id,
        "--summary",
        "done",
      ]);
      await taskList.claim(evaluatorTask.id, "evaluator");
      const verdict = await invokeRuntimeHelper<{ ok: boolean }>(workspace, "evaluator", [
        "verdict",
        "--task",
        evaluatorTask.id,
        "--verdict",
        "pass",
        "--rationale",
        "looks good",
      ]);

      expect(spawn.ok).toBe(true);
      expect(complete.ok).toBe(true);
      expect(verdict.ok).toBe(true);
      expect(sent).toHaveLength(3);
      expect(sent[0]).toMatchObject({
        from: "lead",
        to: "lead",
        kind: "spawn_request",
        taskId: task.id,
      });
      expect(sent[1]).toMatchObject({
        from: "planner",
        to: "lead",
        kind: "worker_complete",
        taskId: task.id,
      });
      expect(sent[2]).toMatchObject({
        from: "evaluator",
        to: "lead",
        kind: "evaluator_verdict",
        taskId: evaluatorTask.id,
      });

      const usage = await readJsonLines<{ roleId: string; command: string }>(helper.usageLogPath);
      expect(usage.some((entry) => entry.roleId === "lead" && entry.command === "tasks")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "lead" && entry.command === "help")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "lead" && entry.command === "wait")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "lead" && entry.command === "spawn")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "planner" && entry.command === "complete")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "evaluator" && entry.command === "verdict")).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it("lets helper wait time out on the requested task timeout instead of the fixed client timeout", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-wait-timeout-"));
    const runDir = join(workspace, ".pluto", "runs", "run-helper-wait-timeout");
    tempDirs.push(workspace);

    const taskList = new FileBackedTaskList({ runDir });
    await taskList.ensure();
    const task = await taskList.create({ assigneeId: "planner", summary: "planner: hello" });
    const helper = await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir,
      runId: "run-helper-wait-timeout",
      leadRoleId: "lead",
      roleIds: ["lead", "planner"],
      taskListPath: taskList.path(),
    });

    const server = startTrackedRuntimeHelperServer({
      taskListPath: taskList.path(),
      requestsPath: helper.requestsPath,
      responsesDir: helper.responsesDir,
      roleSessionId: () => undefined,
      sendMessage: async () => {
        throw new Error("unused");
      },
      recordMailboxMessage: async () => undefined,
    });

    try {
      const failure = await invokeRuntimeHelperFailure(workspace, "lead", [
        "wait",
        "--task",
        task.id,
        "--status",
        "completed",
        "--timeout",
        "250",
      ], 2_000);

      expect(failure.killed).toBe(false);
      expect(failure.stderr).toContain(`runtime_helper_wait_timeout:${task.id}`);
    } finally {
      await server.stop();
    }
  });

  it("resolves shared-cli context from runtime-injected environment", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-env-"));
    const runDir = join(workspace, ".pluto", "runs", "run-helper-env");
    tempDirs.push(workspace);

    const taskList = new FileBackedTaskList({ runDir });
    await taskList.ensure();
    const task = await taskList.create({ assigneeId: "planner", summary: "planner: hello" });
    await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir,
      runId: "run-helper-env",
      leadRoleId: "lead",
      roleIds: ["lead", "planner"],
      taskListPath: taskList.path(),
    });

    const helperPath = join(workspace, ".pluto-runtime", "pluto-mailbox");
    const contextPath = join(workspace, ".pluto-runtime", "contexts", "planner.json");
    const { stdout } = await exec(helperPath, ["tasks"], {
      cwd: workspace,
      timeout: 15_000,
      env: {
        ...process.env,
        PLUTO_RUNTIME_HELPER_CONTEXT: contextPath,
        PLUTO_RUNTIME_HELPER_ROLE: "planner",
        PLUTO_RUNTIME_HELPER_RUN_ID: "run-helper-env",
      },
    });

    expect((JSON.parse(stdout) as TaskRecord[]).map((entry) => entry.id)).toEqual([task.id]);
  });

  it("resolves helper context from injected run-local env and rejects mismatched role/run overrides", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-run-local-env-"));
    const runDirA = join(workspace, ".pluto", "runs", "run-helper-env-a");
    const runDirB = join(workspace, ".pluto", "runs", "run-helper-env-b");
    tempDirs.push(workspace);

    const taskListA = new FileBackedTaskList({ runDir: runDirA });
    await taskListA.ensure();
    const taskA = await taskListA.create({ assigneeId: "planner", summary: "planner: run A" });
    await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir: runDirA,
      runId: "run-helper-env-a",
      leadRoleId: "lead",
      roleIds: ["lead", "planner"],
      taskListPath: taskListA.path(),
    });

    const helperPath = join(workspace, ".pluto-runtime", "pluto-mailbox");
    const runAPlannerContextPath = runtimeHelperContextPath(workspace, "planner", "run-helper-env-a");
    const success = await exec(helperPath, ["tasks"], {
      cwd: workspace,
      timeout: 15_000,
      env: {
        ...process.env,
        PLUTO_RUNTIME_HELPER_CONTEXT: runAPlannerContextPath,
        PLUTO_RUNTIME_HELPER_ROLE: "planner",
        PLUTO_RUNTIME_HELPER_RUN_ID: "run-helper-env-a",
      },
    });
    expect((JSON.parse(success.stdout) as TaskRecord[]).map((entry) => entry.id)).toEqual([taskA.id]);

    const taskListB = new FileBackedTaskList({ runDir: runDirB });
    await taskListB.ensure();
    await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir: runDirB,
      runId: "run-helper-env-b",
      leadRoleId: "lead",
      roleIds: ["lead", "planner"],
      taskListPath: taskListB.path(),
    });

    const envBeatsCli = await exec(helperPath, [
      "--context",
      runtimeHelperContextPath(workspace, "lead", "run-helper-env-b"),
      "--role",
      "lead",
      "--run",
      "run-helper-env-b",
      "tasks",
    ], {
      cwd: workspace,
      timeout: 15_000,
      env: {
        ...process.env,
        PLUTO_RUNTIME_HELPER_CONTEXT: runAPlannerContextPath,
        PLUTO_RUNTIME_HELPER_ROLE: "planner",
        PLUTO_RUNTIME_HELPER_RUN_ID: "run-helper-env-a",
      },
    });
    expect((JSON.parse(envBeatsCli.stdout) as TaskRecord[]).map((entry) => entry.id)).toEqual([taskA.id]);

    await expect(exec(helperPath, ["tasks"], {
      cwd: workspace,
      timeout: 15_000,
      env: {
        ...process.env,
        PLUTO_RUNTIME_HELPER_CONTEXT: runAPlannerContextPath,
        PLUTO_RUNTIME_HELPER_ROLE: "planner",
        PLUTO_RUNTIME_HELPER_RUN_ID: "run-helper-env-b",
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("runtime_helper_context_run_mismatch:run-helper-env-b:run-helper-env-a"),
    });

    await expect(exec(helperPath, ["tasks"], {
      cwd: workspace,
      timeout: 15_000,
      env: {
        ...process.env,
        PLUTO_RUNTIME_HELPER_CONTEXT: runAPlannerContextPath,
        PLUTO_RUNTIME_HELPER_ROLE: "lead",
        PLUTO_RUNTIME_HELPER_RUN_ID: "run-helper-env-a",
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("runtime_helper_context_role_mismatch:lead:planner"),
    });
  });

  it("acknowledges spawn before slow mailbox logging can trigger a false timeout", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-spawn-ack-"));
    const runDir = join(workspace, ".pluto", "runs", "run-helper-spawn-ack");
    tempDirs.push(workspace);

    const taskList = new FileBackedTaskList({ runDir });
    await taskList.ensure();
    const task = await taskList.create({ assigneeId: "planner", summary: "planner: hello" });
    const helper = await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir,
      runId: "run-helper-spawn-ack",
      leadRoleId: "lead",
      roleIds: ["lead", "planner"],
      taskListPath: taskList.path(),
    });

    const sent: RuntimeHelperSendMessageRequest[] = [];
    const server = startTrackedRuntimeHelperServer({
      taskListPath: taskList.path(),
      requestsPath: helper.requestsPath,
      responsesDir: helper.responsesDir,
      roleSessionId: () => "lead-session",
      sendMessage: async (input) => {
        sent.push(input);
        return {
          id: "message-1",
          to: input.to,
          from: input.from,
          createdAt: new Date().toISOString(),
          kind: input.kind ?? "text",
          body: input.body,
          transportMessageId: "transport-1",
        } satisfies MailboxMessage;
      },
      recordMailboxMessage: async () => {
        await delay(1_000);
      },
    });

    try {
      const spawn = await withEnv({ PLUTO_RUNTIME_HELPER_RESPONSE_TIMEOUT_MS: "500" }, async () => {
        return await invokeRuntimeHelper<{ ok: boolean; messageId: string }>(workspace, "lead", [
          "spawn",
          "--task",
          task.id,
          "--role",
          "planner",
        ]);
      });

      expect(spawn).toMatchObject({ ok: true, messageId: "message-1" });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ from: "lead", to: "lead", taskId: task.id, kind: "spawn_request" });
    } finally {
      await server.stop();
    }
  });

  it("infers spawn success from claimed task state when the helper response arrives too late", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-spawn-infer-"));
    const runDir = join(workspace, ".pluto", "runs", "run-helper-spawn-infer");
    tempDirs.push(workspace);

    const taskList = new FileBackedTaskList({ runDir });
    await taskList.ensure();
    const task = await taskList.create({ assigneeId: "planner", summary: "planner: hello" });
    const helper = await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir,
      runId: "run-helper-spawn-infer",
      leadRoleId: "lead",
      roleIds: ["lead", "planner"],
      taskListPath: taskList.path(),
    });

    const server = startTrackedRuntimeHelperServer({
      taskListPath: taskList.path(),
      requestsPath: helper.requestsPath,
      responsesDir: helper.responsesDir,
      roleSessionId: () => "lead-session",
      sendMessage: async (input) => {
        await taskList.claim(task.id, "planner");
        await delay(250);
        return {
          id: "message-1",
          to: input.to,
          from: input.from,
          createdAt: new Date().toISOString(),
          kind: input.kind ?? "text",
          body: input.body,
          transportMessageId: "transport-1",
        } satisfies MailboxMessage;
      },
      recordMailboxMessage: async () => undefined,
    });

    try {
      const spawn = await withEnv({ PLUTO_RUNTIME_HELPER_RESPONSE_TIMEOUT_MS: "100" }, async () => {
        return await invokeRuntimeHelper<{ ok: boolean; taskId: string; inferred?: boolean; targetRole?: string }>(workspace, "lead", [
          "spawn",
          "--task",
          task.id,
          "--role",
          "planner",
        ]);
      });

      expect(spawn).toMatchObject({ ok: true, taskId: task.id, inferred: true, targetRole: "planner" });
    } finally {
      await server.stop();
    }
  });

  it("rejects invalid wait status and times out when target status is not reached", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-runtime-helper-wait-"));
    const runDir = join(workspace, ".pluto", "runs", "run-helper");
    tempDirs.push(workspace);

    const taskList = new FileBackedTaskList({ runDir });
    await taskList.ensure();
    const task = await taskList.create({ assigneeId: "planner", summary: "planner: hello" });
    const helper = await materializeRuntimeHelperWorkspace({
      enabled: true,
      workspaceDir: workspace,
      runDir,
      runId: "run-helper",
      leadRoleId: "lead",
      roleIds: ["lead", "planner"],
      taskListPath: taskList.path(),
    });

    const server = startTrackedRuntimeHelperServer({
      taskListPath: taskList.path(),
      requestsPath: helper.requestsPath,
      responsesDir: helper.responsesDir,
      roleSessionId: () => undefined,
      sendMessage: async (input) => {
        return {
          id: "manual",
          to: input.to,
          from: input.from,
          createdAt: new Date().toISOString(),
          kind: input.kind ?? "text",
          body: input.body,
          ...(input.summary ? { summary: input.summary } : {}),
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          transportMessageId: `transport-manual`,
        } satisfies MailboxMessage;
      },
      recordMailboxMessage: async () => undefined,
    });

    try {
      await expect(invokeRuntimeHelper(workspace, "lead", ["wait", "--task", task.id, "--status", "unsupported", "--timeout", "10"]))
        .rejects
        .toThrow("invalid_task_status:unsupported");

      await expect(invokeRuntimeHelper(workspace, "lead", ["wait", "--task", task.id, "--status", "completed", "--timeout", "25"]))
        .rejects
        .toThrow("runtime_helper_wait_timeout");
    } finally {
      await server.stop();
    }
  });

  it("lets lead and workers author the mailbox chain through the runtime helper MVP", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat", PLUTO_RUNTIME_HELPER_MVP: "1" }, async () => {
      const run = await createRuntimeHelperHarnessRun("helper-happy-path");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      expect(run.workspace).toBe(join(run.workspaceRoot, ".pluto-run-workspaces", run.runId));

      const listedTasks = await invokeRuntimeHelper<TaskRecord[]>(run.workspace, "lead", ["tasks"]);
      expect(listedTasks.map((task) => task.id)).toEqual([plannerTask.id, generatorTask.id, evaluatorTask.id]);

      await invokeRuntimeHelper<{ ok: boolean }>(run.workspace, "lead", [
        "spawn",
        "--task",
        plannerTask.id,
        "--role",
        "planner",
        "--rationale",
        "plan hello-team",
      ]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "planner");
      await invokeRuntimeHelper<{ ok: boolean }>(run.workspace, "planner", [
        "complete",
        "--task",
        plannerTask.id,
        "--summary",
        "planner done",
      ]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === plannerTask.id);

      await invokeRuntimeHelper<{ ok: boolean }>(run.workspace, "lead", [
        "spawn",
        "--task",
        generatorTask.id,
        "--role",
        "generator",
        "--rationale",
        "draft artifact",
      ]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "generator");
      await invokeRuntimeHelper<{ ok: boolean }>(run.workspace, "generator", [
        "complete",
        "--task",
        generatorTask.id,
        "--summary",
        "generator done",
      ]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === generatorTask.id);

      await invokeRuntimeHelper<{ ok: boolean }>(run.workspace, "lead", [
        "spawn",
        "--task",
        evaluatorTask.id,
        "--role",
        "evaluator",
        "--rationale",
        "review artifact",
      ]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "evaluator");
      await invokeRuntimeHelper<{ ok: boolean }>(run.workspace, "evaluator", [
        "verdict",
        "--task",
        evaluatorTask.id,
        "--verdict",
        "pass",
        "--rationale",
        "looks good",
      ]);
      await waitForEvent(run.runDir, (event) => event.type === "evaluator_verdict_received" && event.payload["taskId"] === evaluatorTask.id);
      await invokeRuntimeHelper<{ ok: boolean }>(run.workspace, "evaluator", [
        "complete",
        "--task",
        evaluatorTask.id,
        "--summary",
        "evaluator done",
      ]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === evaluatorTask.id);

      await invokeRuntimeHelper<{ ok: boolean }>(run.workspace, "lead", [
        "finalize",
        "--summary",
        "helper-authored happy path complete",
        "--completed-task",
        plannerTask.id,
        "--completed-task",
        generatorTask.id,
        "--completed-task",
        evaluatorTask.id,
      ]);

      const result = await run.resultPromise;
      const usage = await readJsonLines<{ roleId: string; command: string; requestId?: string; payload?: unknown }>(join(run.runDir, "runtime-helper-usage.jsonl"));
      const events = await readEvents(run.runDir);

      expect(result.run.status).toBe("succeeded");
      const leadSpawnRequestIds = new Set(
        usage
          .filter((entry) => entry.roleId === "lead" && entry.command === "spawn" && entry.requestId && "payload" in entry)
          .map((entry) => entry.requestId),
      );
      expect(leadSpawnRequestIds.size).toBe(3);
      expect(usage.some((entry) => entry.roleId === "lead" && entry.command === "finalize")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "planner" && entry.command === "complete")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "generator" && entry.command === "complete")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "evaluator" && entry.command === "verdict")).toBe(true);
      expect(usage.some((entry) => entry.roleId === "evaluator" && entry.command === "complete")).toBe(true);
      expect(events.some((event) => event.type === "final_reconciliation_received" && event.payload["orchestrationSource"] === "teamlead_chat")).toBe(true);
      expect(events.some((event) => event.type === "run_completed")).toBe(true);
      expect(events.some((event) => event.type === "mailbox_message" && event.payload["authoringChannel"] === "runtime_helper" && event.payload["kind"] === "final_reconciliation")).toBe(true);
    });
  });

  it("satisfies helper waits directly and suppresses redundant lead-session noise while the lead stays busy", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat", PLUTO_RUNTIME_HELPER_MVP: "1" }, async () => {
      let adapter: FakeAdapter | undefined;
      const run = await createRuntimeHelperHarnessRun("lead-wait-noise", {
        createAdapter: ({ team }) => {
          adapter = new FakeAdapter({ team });
          return adapter;
        },
      });
      const leadStarted = await waitForEvent(run.runDir, (event) => event.type === "lead_started");
      const leadSessionId = leadStarted.sessionId!;
      adapter!.setSessionIdle(leadSessionId, false);

      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      await invokeRuntimeHelper(run.workspace, "lead", ["spawn", "--task", plannerTask.id, "--role", "planner", "--rationale", "plan hello-team"]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "planner");
      const plannerWait = invokeRuntimeHelper<{ ok: boolean; status: string; taskId: string }>(run.workspace, "lead", [
        "wait",
        "--task",
        plannerTask.id,
        "--status",
        "completed",
        "--timeout",
        "15000",
      ]);
      await delay(100);
      await invokeRuntimeHelper(run.workspace, "planner", ["complete", "--task", plannerTask.id, "--summary", "planner done"]);
      await expect(plannerWait).resolves.toMatchObject({ ok: true, status: "completed", taskId: plannerTask.id });

      await invokeRuntimeHelper(run.workspace, "lead", ["spawn", "--task", generatorTask.id, "--role", "generator", "--rationale", "draft artifact"]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "generator");
      const generatorWait = invokeRuntimeHelper<{ ok: boolean; status: string; taskId: string }>(run.workspace, "lead", [
        "wait",
        "--task",
        generatorTask.id,
        "--status",
        "completed",
        "--timeout",
        "15000",
      ]);
      await delay(100);
      await invokeRuntimeHelper(run.workspace, "generator", ["complete", "--task", generatorTask.id, "--summary", "generator done"]);
      await expect(generatorWait).resolves.toMatchObject({ ok: true, status: "completed", taskId: generatorTask.id });

      await invokeRuntimeHelper(run.workspace, "lead", ["spawn", "--task", evaluatorTask.id, "--role", "evaluator", "--rationale", "review artifact"]);
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "evaluator");
      await invokeRuntimeHelper(run.workspace, "evaluator", ["verdict", "--task", evaluatorTask.id, "--verdict", "pass", "--rationale", "looks good"]);
      const evaluatorWait = invokeRuntimeHelper<{ ok: boolean; status: string; taskId: string }>(run.workspace, "lead", [
        "wait",
        "--task",
        evaluatorTask.id,
        "--status",
        "completed",
        "--timeout",
        "15000",
      ]);
      await delay(100);
      await invokeRuntimeHelper(run.workspace, "evaluator", ["complete", "--task", evaluatorTask.id, "--summary", "evaluator done"]);
      await expect(evaluatorWait).resolves.toMatchObject({ ok: true, status: "completed", taskId: evaluatorTask.id });

      await invokeRuntimeHelper(run.workspace, "lead", [
        "finalize",
        "--summary",
        "helper wait busy lead complete",
        "--completed-task",
        plannerTask.id,
        "--completed-task",
        generatorTask.id,
        "--completed-task",
        evaluatorTask.id,
      ]);

      const result = await run.resultPromise;
      const events = await readEvents(run.runDir);
      const leadSentMessages = adapter!.getSentMessages().filter((entry) => entry.sessionId === leadSessionId);

      expect(result.run.status).toBe("succeeded");
      expect(events.some((event) => event.type === "mailbox_message_delivered" && event.roleId === "lead" && event.payload["deliveryMode"] === "runtime_helper_wait")).toBe(true);
      expect(events.some((event) => event.type === "mailbox_message_queued" && event.roleId === "lead")).toBe(false);
      expect(leadSentMessages.some((entry) => entry.message.includes('"kind":"worker_complete"'))).toBe(false);
      expect(leadSentMessages.some((entry) => entry.message.includes('"kind":"evaluator_verdict"'))).toBe(false);
      expect(leadSentMessages.some((entry) => entry.message.includes('"kind":"final_reconciliation"'))).toBe(false);
    });
  });

  it("disables synthetic worker completion in the opt-in harness path", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat", PLUTO_RUNTIME_HELPER_MVP: "1" }, async () => {
      const run = await createRuntimeHelperHarnessRun("no-synthetic-complete");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      expect((await readEvents(run.runDir)).some((event) => event.type === "spawn_request_received")).toBe(false);

      await postSpawnRequest(run, { from: "lead", targetRole: "planner", taskId: plannerTask.id });
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "planner");
      await waitFor(async () => taskByAssignee(await readTasks(run.runDir), "planner").status === "in_progress");
      expect((await readEvents(run.runDir)).some((event) => event.type === "worker_complete_received" && event.payload["taskId"] === plannerTask.id)).toBe(false);

      await postWorkerComplete(run, { from: "planner", taskId: plannerTask.id, status: "succeeded", summary: "planner done" });
      await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === plannerTask.id);
      await postSpawnRequest(run, { from: "lead", targetRole: "generator", taskId: generatorTask.id });
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "generator");
      await postWorkerComplete(run, { from: "generator", taskId: generatorTask.id, status: "succeeded", summary: "generator done" });
      await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === generatorTask.id);
      await postSpawnRequest(run, { from: "lead", targetRole: "evaluator", taskId: evaluatorTask.id });
      await waitForEvent(run.runDir, (event) => event.type === "worker_completed" && event.roleId === "evaluator");
      await postWorkerComplete(run, { from: "evaluator", taskId: evaluatorTask.id, status: "succeeded", summary: "evaluator done" });
      await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === evaluatorTask.id);
      await postFinalReconciliation(run, [plannerTask.id, generatorTask.id, evaluatorTask.id]);

      const result = await run.resultPromise;
      expect(result.run.status).toBe("failed_audit");
    });
  });
});

class CapturingTransport extends FakeMailboxTransport {
  roomRef: string | undefined;

  override async createRoom(input: Parameters<FakeMailboxTransport["createRoom"]>[0]) {
    const room = await super.createRoom(input);
    this.roomRef = room;
    return room;
  }
}

async function createRuntimeHelperHarnessRun(
  name: string,
  options?: {
    createAdapter?: (input: { team: TeamConfig }) => FakeAdapter;
  },
) {
  const workspace = await mkdtemp(join(tmpdir(), `pluto-runtime-helper-harness-${name}-`));
  const dataDir = join(workspace, ".pluto");
  const runId = `run-${name}`;
  let idSequence = 0;
  tempDirs.push(workspace);

  const transport = new CapturingTransport();
  let adapter: FakeAdapter | undefined;
  const resultPromise = runManagerHarness({
    rootDir: repoRoot,
    selection: { scenario: "hello-team", runProfile: "fake-smoke" },
    workspaceOverride: workspace,
    dataDir,
    idGen: () => {
      idSequence += 1;
      return idSequence === 1 ? runId : `${runId}-id-${idSequence}`;
    },
    autoDriveDispatch: false,
    createAdapter: ({ team }) => {
      adapter = options?.createAdapter?.({ team }) ?? new FakeAdapter({ team });
      return adapter;
    },
    createMailboxTransport: () => transport,
  });

  const runDir = join(dataDir, "runs", runId);
  await waitFor(async () => {
    await access(join(runDir, "tasks.json"));
    return Boolean(transport.roomRef);
  });

  const workspaceDir = join(workspace, ".pluto-run-workspaces", runId);
  await waitFor(async () => {
    await access(join(workspaceDir, ".pluto-runtime", "pluto-mailbox"));
    return true;
  });

  return {
    adapter: adapter!,
    resultPromise,
    roomRef: transport.roomRef!,
    runDir,
    runId,
    transport,
    workspace: workspaceDir,
    workspaceRoot: workspace,
  };
}

async function invokeRuntimeHelper<T>(workspace: string, roleId: string, args: string[]): Promise<T> {
  const helperPath = join(workspace, ".pluto-runtime", "pluto-mailbox");
  const { stdout } = await exec(helperPath, ["--role", roleId, ...args], { cwd: workspace, timeout: 15_000 });
  return JSON.parse(stdout) as T;
}

async function invokeRuntimeHelperText(workspace: string, roleId: string, args: string[]): Promise<string> {
  const helperPath = join(workspace, ".pluto-runtime", "pluto-mailbox");
  const { stdout } = await exec(helperPath, ["--role", roleId, ...args], { cwd: workspace, timeout: 15_000 });
  return stdout;
}

async function invokeRuntimeHelperFailure(
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

async function postSpawnRequest(
  run: Awaited<ReturnType<typeof createRuntimeHelperHarnessRun>>,
  input: { from: string; targetRole: string; taskId: string },
) {
  const message = createMailboxMessage({
    id: `${input.from}-${input.targetRole}-${input.taskId}`,
    to: "lead",
    from: input.from,
    kind: "spawn_request",
    body: {
      schemaVersion: "v1",
      targetRole: input.targetRole,
      taskId: input.taskId,
      rationale: `dispatch ${input.targetRole}`,
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function postWorkerComplete(
  run: Awaited<ReturnType<typeof createRuntimeHelperHarnessRun>>,
  input: { from: string; taskId: string; status: WorkerCompleteBody["status"]; summary: string },
) {
  const message = createMailboxMessage({
    id: `${input.from}-complete-${input.taskId}`,
    to: "lead",
    from: input.from,
    kind: "worker_complete",
    body: {
      schemaVersion: "v1",
      taskId: input.taskId,
      status: input.status,
      summary: input.summary,
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function postFinalReconciliation(
  run: Awaited<ReturnType<typeof createRuntimeHelperHarnessRun>>,
  completedTaskIds: string[],
) {
  const message = createMailboxMessage({
    id: `lead-final-${completedTaskIds.length}`,
    to: "lead",
    from: "lead",
    kind: "final_reconciliation",
    body: {
      schemaVersion: "v1",
      summary: "manual finalization",
      completedTaskIds,
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function waitForTasks(runDir: string, expectedCount: number): Promise<TaskRecord[]> {
  await waitFor(async () => (await readTasks(runDir)).length === expectedCount);
  return await readTasks(runDir);
}

async function waitForEvent(runDir: string, predicate: (event: AgentEvent) => boolean, timeoutMs = 5_000): Promise<AgentEvent> {
  await waitFor(async () => (await readEvents(runDir)).some(predicate), timeoutMs);
  return (await readEvents(runDir)).find(predicate)!;
}

async function readEvents(runDir: string): Promise<AgentEvent[]> {
  return await readJsonLines<AgentEvent>(join(runDir, "events.jsonl"));
}

async function readTasks(runDir: string): Promise<TaskRecord[]> {
  const raw = await readFile(join(runDir, "tasks.json"), "utf8");
  return (JSON.parse(raw) as { tasks?: TaskRecord[] }).tasks ?? [];
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function taskByAssignee(tasks: TaskRecord[], assigneeId: string): TaskRecord {
  const task = tasks.find((entry) => entry.assigneeId === assigneeId);
  if (!task) {
    throw new Error(`task not found for ${assigneeId}`);
  }
  return task;
}

function createMailboxMessage(input: {
  id: string;
  to: string;
  from: string;
  kind: MailboxMessage["kind"];
  body: MailboxMessage["body"];
}): MailboxMessage {
  return {
    id: input.id,
    to: input.to,
    from: input.from,
    createdAt: new Date().toISOString(),
    kind: input.kind,
    body: input.body,
  };
}

function buildEnvelope(runId: string, body: MailboxMessage): MailboxEnvelope {
  return {
    schemaVersion: "v1",
    fromRole: body.from,
    toRole: body.to,
    runId,
    ...(typeof body.body === "object" && body.body !== null && "taskId" in body.body && typeof body.body.taskId === "string"
      ? { taskId: body.body.taskId }
      : {}),
    body,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
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
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function withEnv<T>(entries: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(entries)) {
    original.set(key, process.env[key]);
    process.env[key] = value;
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
