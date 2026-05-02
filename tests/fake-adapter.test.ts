import { describe, expect, it } from "vitest";
import { FakeAdapter } from "@/adapters/fake/index.js";
import { DEFAULT_TEAM, getRole } from "@/orchestrator/team-config.js";
import type { TeamTask } from "@/contracts/types.js";

const baseTask: TeamTask = {
  id: "task-1",
  title: "Hello team",
  prompt: "Produce a hello-team script.",
  workspacePath: "/tmp/pluto-fake",
  minWorkers: 2,
  orchestrationMode: "lead_marker",
};

describe("FakeAdapter protocol", () => {
  it("emits lead_started without legacy worker-request bridge events", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    await adapter.startRun({ runId: "r1", task: baseTask, team: DEFAULT_TEAM });

    await adapter.createLeadSession({
      runId: "r1",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });

    const events = await adapter.readEvents({ runId: "r1" });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("lead_started");
    expect(types).not.toContain("worker_requested");
  });

  it("emits worker_started + worker_completed when workers are created", async () => {
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      workerOutputs: {
        planner: "token sk-ant-api03-abcdefghijklmnop",
      },
    });
    await adapter.startRun({ runId: "r2", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "r2",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    await adapter.readEvents({ runId: "r2" }); // drain

    await adapter.createWorkerSession({
      runId: "r2",
      role: getRole(DEFAULT_TEAM, "planner"),
      instructions: "plan",
    });

    const events = await adapter.readEvents({ runId: "r2" });
    expect(events.map((e) => e.type)).toEqual(["worker_started", "worker_completed"]);
    expect(events[1]?.payload["output"]).toBe("token [REDACTED]");
    expect(events[1]?.payload["outputRef"]).toBeDefined();
    expect(events[1]?.transient?.rawPayload?.["output"]).toBe(
      "token sk-ant-api03-abcdefghijklmnop",
    );
  });

  it("returns a synthesized lead summary on SUMMARIZE", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    await adapter.startRun({ runId: "r3", task: baseTask, team: DEFAULT_TEAM });
    const lead = await adapter.createLeadSession({
      runId: "r3",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    await adapter.readEvents({ runId: "r3" });

    for (const role of ["planner", "generator"] as const) {
      await adapter.createWorkerSession({
        runId: "r3",
        role: getRole(DEFAULT_TEAM, role),
        instructions: `do ${role} work`,
      });
    }
    await adapter.readEvents({ runId: "r3" }); // drain worker events

    await adapter.sendMessage({
      runId: "r3",
      sessionId: lead.sessionId,
      message: "All workers done. SUMMARIZE.",
    });

    const events = await adapter.readEvents({ runId: "r3" });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("lead_message");
    expect(events[0]?.payload["kind"]).toBe("summary");
    const md = String(events[0]?.payload["markdown"]);
    expect(events[0]?.payload["markdownRef"]).toBeDefined();
    expect(md).toContain("planner");
    expect(md).toContain("generator");
  });

  it("rejects unknown sessionIds in sendMessage", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    await adapter.startRun({ runId: "r4", task: baseTask, team: DEFAULT_TEAM });
    await expect(
      adapter.sendMessage({ runId: "r4", sessionId: "ghost", message: "hi" }),
    ).rejects.toThrow(/fake_adapter_unknown_session/);
  });

  it("rejects mismatched team", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    await expect(
      adapter.startRun({
        runId: "r5",
        task: baseTask,
        team: { ...DEFAULT_TEAM, id: "other" },
      }),
    ).rejects.toThrow(/team_mismatch/);
  });
});
