import { describe, expect, it } from "vitest";

import { PaseoOpenCodeAdapter } from "@/adapters/paseo-opencode/paseo-opencode-adapter.js";
import type { ProcessRunner } from "@/adapters/paseo-opencode/process-runner.js";
import { DEFAULT_TEAM, getRole } from "@/orchestrator/team-config.js";
import type { TeamTask } from "@/contracts/types.js";

const baseTask: TeamTask = {
  id: "task-live-1",
  title: "Hello team",
  prompt: "Produce a hello-team artifact.",
  workspacePath: "/tmp/pluto-live",
  minWorkers: 2,
};

describe("PaseoOpenCodeAdapter — log text extraction", () => {
  it("extracts the assistant turn after the last [User] line", () => {
    const raw = [
      "[User] Hello",
      "Hi there",
      "[Thought] thinking…",
      "[User] Reply with PASS.",
      "PASS",
      "[Thought] short answer",
    ].join("\n");
    expect(PaseoOpenCodeAdapter.extractAssistantTextFromLogs(raw)).toBe("PASS");
  });

  it("preserves multi-line assistant text and drops trailing blank lines", () => {
    const raw = [
      "[User] Tell me a joke",
      "Knock knock.",
      "Who's there?",
      "Banana.",
      "",
      "[Thought] follow-up",
    ].join("\n");
    expect(
      PaseoOpenCodeAdapter.extractAssistantTextFromLogs(raw),
    ).toBe("Knock knock.\nWho's there?\nBanana.");
  });

  it("returns empty string when no assistant text is present", () => {
    const raw = "[User] hi\n[Thought] empty";
    expect(PaseoOpenCodeAdapter.extractAssistantTextFromLogs(raw)).toBe("");
  });

  it("strips an echoed multi-line user prompt before assistant text", () => {
    const echoed = [
      "Instructions from the Team Lead:",
      "Say hello as the planner.",
      "",
      "Reply with your contribution only.",
    ].join("\n");
    const raw = [
      "[User]",
      echoed,
      "Hello from planner.",
      "[Thought] done",
    ].join("\n");
    expect(PaseoOpenCodeAdapter.extractAssistantTextFromLogs(raw, echoed)).toBe(
      "Hello from planner.",
    );
  });

  it("strips a compact echoed SUMMARIZE marker before final markdown", () => {
    const raw = [
      "[User]",
      "SUMMARIZE",
      "## Hello team",
      "lead: hello",
      "[Thought] done",
    ].join("\n");
    expect(PaseoOpenCodeAdapter.extractAssistantTextFromLogs(raw, "SUMMARIZE | details")).toBe(
      "## Hello team\nlead: hello",
    );
  });

  it("strips an echoed worker prompt even when paseo omits the role system prompt", () => {
    const fullPrompt = [
      "You are the planner.",
      "",
      "Instructions from the Team Lead:",
      "Plan a hello file.",
      "",
      "Reply with your contribution only. Keep it concise (under 15 lines).",
    ].join("\n");
    const raw = [
      "[User]",
      "Instructions from the Team Lead:",
      "Plan a hello file.",
      "",
      "Reply with your contribution only. Keep it concise (under 15 lines).",
      "Plan: four hello lines.",
      "[Thought] I should not leak this thought.",
      "This reasoning line should also be dropped.",
    ].join("\n");
    expect(PaseoOpenCodeAdapter.extractAssistantTextFromLogs(raw, fullPrompt)).toBe(
      "Plan: four hello lines.",
    );
  });
});

describe("PaseoOpenCodeAdapter — protocol with mocked runner", () => {
  function makeRunner(impl: {
    run?: (args: string[]) => { stdout?: string; stderr?: string; exitCode?: number | null };
    onArgs?: (cmd: string, args: string[]) => void;
    extra?: (cmd: string, args: string[]) => { stdout?: string; stderr?: string; exitCode?: number | null } | undefined;
  }): ProcessRunner {
    return {
      async exec(_cmd, args) {
        impl.onArgs?.(_cmd, args);
        const sub = args[0];
        if (sub === "run") {
          const r = impl.run?.(args) ?? {};
          return {
            stdout: r.stdout ?? `{"agentId":"agent-${args[args.length - 2] ?? "x"}"}`,
            stderr: r.stderr ?? "",
            exitCode: r.exitCode ?? 0,
          };
        }
        if (sub === "wait") {
          return { stdout: '{"status":"idle"}', stderr: "", exitCode: 0 };
        }
        if (sub === "send") {
          return { stdout: '{"sent":true}', stderr: "", exitCode: 0 };
        }
        if (sub === "logs") {
          const r = impl.extra?.(_cmd, args);
          return {
            stdout: r?.stdout ?? "[User] task\nworker output\n[Thought] done",
            stderr: r?.stderr ?? "",
            exitCode: r?.exitCode ?? 0,
          };
        }
        if (sub === "delete") {
          return { stdout: "DELETED", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: `unknown subcommand:${sub}`, exitCode: 1 };
      },
      follow(_cmd, _args, _opts) {
        return { dispose: async () => undefined };
      },
    };
  }

  it("uses provider/mode build by default and passes --cwd", async () => {
    const captured: string[][] = [];
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({ onArgs: (_c, a) => captured.push(a) }),
      idGen: () => "fixed-id",
    });
    await adapter.startRun({ runId: "r1", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "r1",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    const runArgs = captured.find((a) => a[0] === "run");
    expect(runArgs).toBeDefined();
    expect(runArgs).toContain("--mode");
    const modeIdx = runArgs!.indexOf("--mode");
    expect(runArgs![modeIdx + 1]).toBe("build");
    const provIdx = runArgs!.indexOf("--provider");
    expect(runArgs![provIdx + 1]).toBe("opencode/minimax-m2.5-free");
    const cwdIdx = runArgs!.indexOf("--cwd");
    expect(runArgs![cwdIdx + 1]).toBe("/tmp/pluto-live");
  });

  it("emits worker_started + worker_completed and parses worker output from logs", async () => {
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({
        extra: (_c, args) => {
          // logs response per worker: include a [User] then assistant text.
          if (args[0] === "logs") {
            return { stdout: "[User] Plan\nstep 1\nstep 2\n[Thought] ok" };
          }
          return undefined;
        },
      }),
    });
    await adapter.startRun({ runId: "r2", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createWorkerSession({
      runId: "r2",
      role: getRole(DEFAULT_TEAM, "planner"),
      instructions: "Plan",
    });
    const events = await adapter.readEvents({ runId: "r2" });
    expect(events.map((e) => e.type)).toEqual(["worker_started", "worker_completed"]);
    expect(events[1]?.payload["output"]).toBe("step 1\nstep 2");
  });

  it("emits lead_message(kind=summary) on SUMMARIZE", async () => {
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({
        extra: (_c, args) => {
          if (args[0] === "logs") {
            return {
              stdout:
                "[User] task\n[User] All workers done. SUMMARIZE.\n# Hello team\nplanner: …\n[Thought] done",
            };
          }
          return undefined;
        },
      }),
    });
    await adapter.startRun({ runId: "r3", task: baseTask, team: DEFAULT_TEAM });
    const lead = await adapter.createLeadSession({
      runId: "r3",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    await adapter.sendMessage({
      runId: "r3",
      sessionId: lead.sessionId,
      message: "All workers done. SUMMARIZE.",
    });
    const events = await adapter.readEvents({ runId: "r3" });
    const summary = events.find((e) => e.type === "lead_message");
    expect(summary).toBeDefined();
    expect(summary!.payload["kind"]).toBe("summary");
    expect(String(summary!.payload["markdown"])).toContain("# Hello team");
  });

  it("rejects sendMessage to a non-lead session", async () => {
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({}),
    });
    await adapter.startRun({ runId: "r4", task: baseTask, team: DEFAULT_TEAM });
    await expect(
      adapter.sendMessage({ runId: "r4", sessionId: "not-the-lead", message: "hi" }),
    ).rejects.toThrow(/paseo_adapter_unknown_session/);
  });
});
