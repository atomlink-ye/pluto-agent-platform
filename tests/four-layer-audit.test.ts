import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MailboxMessage, Playbook, RunProfile, TaskRecord } from "@/contracts/four-layer.js";
import { runAuditMiddleware } from "@/four-layer/audit-middleware.js";

let artifactRootDir: string;

const basePlaybook: Playbook = {
  schemaVersion: 0,
  kind: "playbook",
  name: "research-review",
  teamLead: "lead",
  members: ["planner", "generator", "evaluator"],
  workflow: "delegate through the task list",
  audit: {
    requiredRoles: ["planner", "generator", "evaluator"],
    finalReportSections: ["implementation_summary", "workflow_steps_executed", "required_role_citations", "deviations"],
  },
};

const baseRunProfile: RunProfile = {
  schemaVersion: 0,
  kind: "run_profile",
  name: "local-dev",
  workspace: { cwd: "/tmp/pluto" },
  artifactContract: {
    requiredFiles: [
      "artifact.md",
      { path: "final-report.md", requiredSections: ["implementation_summary"] },
    ],
  },
  stdoutContract: {
    requiredLines: ["SUMMARY:", "WROTE: artifact.md"],
  },
};

beforeEach(async () => {
  artifactRootDir = await mkdtemp(join(tmpdir(), "pluto-four-layer-audit-"));
  await mkdir(artifactRootDir, { recursive: true });
});

afterEach(async () => {
  await rm(artifactRootDir, { recursive: true, force: true });
});

describe("four-layer audit middleware", () => {
  it("fails when a required role has no completed task", async () => {
    await writeArtifacts();
    await writeTaskList([
      makeTask("task-1", "planner", "completed"),
      makeTask("task-2", "generator", "completed"),
    ]);
    await writeMailboxLog([
      makeCompletion("planner", "task-1", "msg-1"),
      makeCompletion("generator", "task-2", "msg-2"),
      makeFinal(["msg-1", "msg-2"]),
    ]);

    const result = await runAuditMiddleware(makeInput());
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_required_role", role: "evaluator" }),
    ]));
  });

  it("fails when a required role has no completion mailbox message", async () => {
    await writeArtifacts();
    await writeTaskList([
      makeTask("task-1", "planner", "completed"),
      makeTask("task-2", "generator", "completed"),
      makeTask("task-3", "evaluator", "completed"),
    ]);
    await writeMailboxLog([
      makeCompletion("planner", "task-1", "msg-1"),
      makeCompletion("generator", "task-2", "msg-2"),
      makeFinal(["msg-1", "msg-2"]),
    ]);

    const result = await runAuditMiddleware(makeInput());
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_completion_message", role: "evaluator" }),
    ]));
  });

  it("fails when the FINAL summary is missing", async () => {
    await writeArtifacts();
    await writeTaskList(allTasks());
    await writeMailboxLog([
      makeCompletion("planner", "task-1", "msg-1"),
      makeCompletion("generator", "task-2", "msg-2"),
      makeCompletion("evaluator", "task-3", "msg-3"),
    ]);

    const result = await runAuditMiddleware(makeInput());
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_final_summary" }),
    ]));
  });

  it("fails when the FINAL summary omits a completion message id", async () => {
    await writeArtifacts();
    await writeTaskList(allTasks());
    await writeMailboxLog([
      makeCompletion("planner", "task-1", "msg-1"),
      makeCompletion("generator", "task-2", "msg-2"),
      makeCompletion("evaluator", "task-3", "msg-3"),
      makeFinal(["msg-1", "msg-3"]),
    ]);

    const result = await runAuditMiddleware(makeInput());
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_final_citation", role: "generator" }),
    ]));
  });

  it("passes when required roles, completion messages, and FINAL citations align", async () => {
    await writeArtifacts();
    await writeTaskList(allTasks());
    await writeMailboxLog([
      makeCompletion("planner", "task-1", "msg-1"),
      makeCompletion("generator", "task-2", "msg-2"),
      makeCompletion("evaluator", "task-3", "msg-3"),
      makeFinal(["msg-1", "msg-2", "msg-3"]),
    ]);

    const result = await runAuditMiddleware(makeInput());
    expect(result.ok).toBe(true);
    expect(result.status).toBe("succeeded");
  });
});

function makeInput(): Parameters<typeof runAuditMiddleware>[0] {
  return {
    artifactRootDir,
    stdout: "WROTE: artifact.md\nSUMMARY: finished\n",
    playbook: basePlaybook,
    runProfile: baseRunProfile,
    mailboxLogPath: join(artifactRootDir, "mailbox.jsonl"),
    taskListPath: join(artifactRootDir, "tasks.json"),
    teamLeadId: "lead",
  };
}

function makeTask(id: string, assigneeId: string, status: TaskRecord["status"]): TaskRecord {
  return {
    id,
    assigneeId,
    status,
    dependsOn: [],
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
    claimedBy: assigneeId,
    summary: `${assigneeId} task`,
    artifacts: [],
  };
}

function allTasks(): TaskRecord[] {
  return [
    makeTask("task-1", "planner", "completed"),
    makeTask("task-2", "generator", "completed"),
    makeTask("task-3", "evaluator", "completed"),
  ];
}

function makeCompletion(from: string, taskId: string, id: string): MailboxMessage {
  return {
    id,
    to: "lead",
    from,
    createdAt: "2026-05-02T00:00:00.000Z",
    kind: "text",
    summary: `COMPLETE ${taskId}`,
    body: `Task ${taskId} complete`,
    replyTo: taskId,
  };
}

function makeFinal(ids: string[]): MailboxMessage {
  return {
    id: "final-1",
    to: "pluto",
    from: "lead",
    createdAt: "2026-05-02T00:00:01.000Z",
    kind: "text",
    summary: "FINAL",
    body: ids.join("\n"),
  };
}

async function writeTaskList(tasks: TaskRecord[]) {
  await writeFile(join(artifactRootDir, "tasks.json"), JSON.stringify({ nextId: tasks.length + 1, tasks }, null, 2) + "\n", "utf8");
}

async function writeMailboxLog(messages: MailboxMessage[]) {
  await writeFile(join(artifactRootDir, "mailbox.jsonl"), messages.map((message) => JSON.stringify(message)).join("\n") + "\n", "utf8");
}

async function writeArtifacts() {
  await writeFile(join(artifactRootDir, "artifact.md"), "artifact\n", "utf8");
  await writeFile(join(artifactRootDir, "final-report.md"), [
    "# Final Report",
    "",
    "## Implementation Summary",
    "Done.",
  ].join("\n"), "utf8");
}
