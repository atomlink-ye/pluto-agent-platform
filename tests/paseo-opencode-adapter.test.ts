import { describe, expect, it } from "vitest";

import { PaseoOpenCodeAdapter } from "@/adapters/paseo-opencode/paseo-opencode-adapter.js";
import type { ProcessRunner } from "@/adapters/paseo-opencode/process-runner.js";
import { DEFAULT_TEAM, getRole } from "@/orchestrator/team-config.js";
import { DEFAULT_TEAM_PLAYBOOK_V0 } from "@/orchestrator/team-playbook.js";
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

  it("strips echoed worker prompt continuation lines when the prompt starts with task metadata", () => {
    const fullPrompt = [
      "You are the planner.",
      "",
      "Task title: Hello team",
      "Goal: Produce a hello-team artifact.",
      "Workspace path: /tmp/pluto-live",
      "Artifact path the team should converge on: /tmp/pluto-live/hello-pluto.md",
      "",
      "Instructions from the Team Lead:",
      "Write the hello lines into the artifact file.",
      "Keep the tone upbeat.",
      "",
      "Work in the workspace directly. If the lead asks you to create or update files, make those changes before replying.",
      "Do not only describe intended edits when the task calls for an artifact change.",
      "Reply with your contribution only. Keep it concise (under 15 lines).",
    ].join("\n");
    const raw = [
      "[User] Task title: Hello team",
      "Goal: Produce a hello-team artifact.",
      "Workspace path: /tmp/pluto-live",
      "Artifact path the team should converge on: /tmp/pluto-live/hello-pluto.md",
      "",
      "Instructions from the Team Lead:",
      "Write the hello lines into the artifact file.",
      "Keep the tone upbeat.",
      "",
      "Work in the workspace directly. If the lead asks you to create or update files, make those changes before replying.",
      "Do not only describe intended edits when the task calls for an artifact change.",
      "Reply with your contribution only. Keep it concise (under 15 lines).",
      "Wrote four hello lines to /tmp/pluto-live/hello-pluto.md.",
      "[Thought] done",
    ].join("\n");

    expect(PaseoOpenCodeAdapter.extractAssistantTextFromLogs(raw, fullPrompt)).toBe(
      "Wrote four hello lines to /tmp/pluto-live/hello-pluto.md.",
    );
  });
});

describe("PaseoOpenCodeAdapter — protocol with mocked runner", () => {
  function makeRunner(impl: {
    run?: (args: string[]) => { stdout?: string; stderr?: string; exitCode?: number | null };
    onArgs?: (cmd: string, args: string[]) => void;
    extra?: (cmd: string, args: string[]) => { stdout?: string; stderr?: string; exitCode?: number | null } | undefined;
    follow?: (cmd: string, args: string[], opts: { onLine: (line: string) => void }) => void;
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
        impl.onArgs?.(_cmd, _args);
        impl.follow?.(_cmd, _args, _opts);
        return { dispose: async () => undefined };
      },
    };
  }

  it("defaults mode to orchestrator when no PASEO_MODE env or option is set", () => {
    const previousMode = process.env["PASEO_MODE"];
    delete process.env["PASEO_MODE"];
    try {
      const adapter = new PaseoOpenCodeAdapter({ workspaceCwd: "/tmp/pluto-live" });
      expect(adapter.getEffectiveMode()).toBe("orchestrator");
    } finally {
      if (previousMode !== undefined) {
        process.env["PASEO_MODE"] = previousMode;
      }
    }
  });

  it("honors PASEO_MODE env override for mode selection", () => {
    const previousMode = process.env["PASEO_MODE"];
    process.env["PASEO_MODE"] = "build";
    try {
      const adapter = new PaseoOpenCodeAdapter({ workspaceCwd: "/tmp/pluto-live" });
      expect(adapter.getEffectiveMode()).toBe("build");
    } finally {
      if (previousMode === undefined) {
        delete process.env["PASEO_MODE"];
      } else {
        process.env["PASEO_MODE"] = previousMode;
      }
    }
  });

  it("honors explicit mode option over env and default", () => {
    const previousMode = process.env["PASEO_MODE"];
    process.env["PASEO_MODE"] = "build";
    try {
      const adapter = new PaseoOpenCodeAdapter({ mode: "orchestrator", workspaceCwd: "/tmp/pluto-live" });
      expect(adapter.getEffectiveMode()).toBe("orchestrator");
    } finally {
      if (previousMode === undefined) {
        delete process.env["PASEO_MODE"];
      } else {
        process.env["PASEO_MODE"] = previousMode;
      }
    }
  });

  it("includes systemPrompt in lead_started event payload", async () => {
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({ run: () => ({ stdout: '{"agentId":"lead-prompt-test"}' }) }),
    });

    await adapter.startRun({ runId: "r-prompt", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "r-prompt",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });

    const events = await adapter.readEvents({ runId: "r-prompt" });
    const leadStarted = events.find((e) => e.type === "lead_started");
    expect(leadStarted).toBeDefined();
    expect(typeof leadStarted!.payload["systemPrompt"]).toBe("string");
    expect(leadStarted!.payload["systemPrompt"]).toContain("AGENT TEAMS V1.6");
  });

  it("adds an absolute helper path and removes stale SUMMARIZE guidance for helper-authored lead prompts", async () => {
    const prompts: string[] = [];
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({
        run: (args) => {
          prompts.push(args[args.length - 1] ?? "");
          return { stdout: '{"agentId":"lead-helper-prompt-test"}' };
        },
      }),
    });

    await adapter.startRun({ runId: "r-helper-prompt", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "r-helper-prompt",
      task: baseTask,
      role: {
        ...getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
        systemPrompt: [
          "You are the Team Lead.",
          "## Coordination via Pluto runtime helper",
          "- Runtime helper path for this run: `./.pluto-runtime/pluto-mailbox`.",
          "- Start by running `./.pluto-runtime/pluto-mailbox tasks`.",
        ].join("\n"),
      },
    });

    expect(prompts[0]).toContain("Runtime helper absolute path for this run: /tmp/pluto-live/.pluto-runtime/pluto-mailbox");
    expect(prompts[0]).not.toContain("wait for Pluto's SUMMARIZE message");
  });

  it("uses orchestrator mode in paseo run args by default", async () => {
    const captured: string[][] = [];
    const adapter = new PaseoOpenCodeAdapter({
      host: "",
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({ onArgs: (_c, a) => captured.push(a) }),
      idGen: () => "fixed-id",
    });
    await adapter.startRun({ runId: "r1-orch", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "r1-orch",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    const runArgs = captured.find((a) => a[0] === "run");
    expect(runArgs).toBeDefined();
    const modeIdx = runArgs!.indexOf("--mode");
    expect(runArgs![modeIdx + 1]).toBe("orchestrator");
  });

  it("uses provider/opencode and passes --cwd with explicit build mode", async () => {
    const captured: string[][] = [];
    const adapter = new PaseoOpenCodeAdapter({
      host: "",
      mode: "build",
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
    expect(runArgs![provIdx + 1]).toBe("opencode");
    const modelIdx = runArgs!.indexOf("--model");
    expect(runArgs![modelIdx + 1]).toBe("opencode/minimax-m2.5-free");
    expect(runArgs).not.toContain("--host");
    const cwdIdx = runArgs!.indexOf("--cwd");
    expect(runArgs![cwdIdx + 1]).toBe("/tmp/pluto-live");
  });

  it("passes playbook and transcript details to TeamLead prompt", async () => {
    const prompts: string[] = [];
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({
        run: (args) => {
          prompts.push(args[args.length - 1] ?? "");
          return { stdout: '{"agentId":"lead-agent"}' };
        },
      }),
    });

    await adapter.startRun({
      runId: "r1-playbook",
      task: { ...baseTask, orchestrationMode: "teamlead_direct" },
      team: DEFAULT_TEAM,
      playbook: DEFAULT_TEAM_PLAYBOOK_V0,
      transcript: { kind: "file", path: "/tmp/pluto-live/.pluto/runs/r1/coordination-transcript.jsonl", roomRef: "file-transcript:r1" },
    });
    await adapter.createLeadSession({
      runId: "r1-playbook",
      task: { ...baseTask, orchestrationMode: "teamlead_direct" },
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
      playbook: DEFAULT_TEAM_PLAYBOOK_V0,
      transcript: { kind: "file", path: "/tmp/pluto-live/.pluto/runs/r1/coordination-transcript.jsonl", roomRef: "file-transcript:r1" },
    });

    expect(prompts[0]).toContain("AGENT TEAMS V1.6");
    expect(prompts[0]).toContain("teamlead-direct-default-v0");
    expect(prompts[0]).toContain("Selected playbook id: teamlead-direct-default-v0");
    expect(prompts[0]).toContain("Selected playbook title: Default planner → generator → evaluator");
    expect(prompts[0]).toContain("- planner-contract | Planner contract | role=planner | dependsOn=none");
    expect(prompts[0]).toContain("- generator-output | Generator output | role=generator | dependsOn=planner-contract");
    expect(prompts[0]).toContain("Mailbox kind: file");
    expect(prompts[0]).toContain("Coordination handle: file-transcript:r1");
    expect(prompts[0]).toContain("Mailbox files (mailbox.jsonl, per-role inbox files) and tasks.json are runtime-owned audit mirrors.");
    expect(prompts[0]).not.toContain("Mailbox path:");
    expect(prompts[0]).not.toContain("Mailbox reference:");
    expect(prompts[0]).toContain("Do not emit legacy marker prefixes or delegation markers");
  });

  it("exposes spawnTeammate when PASEO_BIN is configured", () => {
    const previousBin = process.env["PASEO_BIN"];
    process.env["PASEO_BIN"] = "/usr/bin/paseo";
    try {
      const adapter = new PaseoOpenCodeAdapter({ workspaceCwd: "/tmp/pluto-live" });
      expect(typeof adapter.spawnTeammate).toBe("function");
    } finally {
      if (previousBin === undefined) {
        delete process.env["PASEO_BIN"];
      } else {
        process.env["PASEO_BIN"] = previousBin;
      }
    }
  });

  it("does not parse followed lead logs into worker-request bridge events", async () => {
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({}),
    });

    await adapter.startRun({ runId: "r1-no-bridge", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "r1-no-bridge",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });

    const events = await adapter.readEvents({ runId: "r1-no-bridge" });
    expect(events.some((event) => event.type === "worker_requested")).toBe(false);
  });

  it("passes --host to all paseo daemon commands when configured", async () => {
    const captured: string[][] = [];
    const adapter = new PaseoOpenCodeAdapter({
      host: "http://127.0.0.1:6767",
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({
        onArgs: (_c, a) => captured.push(a),
        run: (args) => ({ stdout: `{"agentId":"agent-${args.includes("Worker") ? "worker" : "lead"}"}` }),
      }),
    });

    await adapter.startRun({ runId: "r1-host", task: baseTask, team: DEFAULT_TEAM });
    const lead = await adapter.createLeadSession({
      runId: "r1-host",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    await adapter.createWorkerSession({
      runId: "r1-host",
      role: getRole(DEFAULT_TEAM, "planner"),
      instructions: "Plan",
    });
    await adapter.sendMessage({ runId: "r1-host", sessionId: lead.sessionId, message: "SUMMARIZE" });
    await adapter.endRun({ runId: "r1-host" });

    const daemonCommands = captured.filter((args) => ["run", "logs", "wait", "send", "delete"].includes(args[0] ?? ""));
    expect(daemonCommands.length).toBeGreaterThan(0);
    for (const args of daemonCommands) {
      const hostIdx = args.indexOf("--host");
      expect(hostIdx).toBeGreaterThanOrEqual(0);
      expect(args[hostIdx + 1]).toBe("127.0.0.1:6767");
    }
  });

  it("orders paseo send arguments as <id> before --prompt-file for session messages", async () => {
    const captured: string[][] = [];
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({ onArgs: (_c, a) => captured.push(a) }),
    });

    await adapter.startRun({ runId: "r-send-order", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "r-send-order",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    const planner = await adapter.createWorkerSession({
      runId: "r-send-order",
      role: getRole(DEFAULT_TEAM, "planner"),
      instructions: "Plan",
    });

    await adapter.sendSessionMessage({
      runId: "r-send-order",
      sessionId: planner.sessionId,
      message: "Follow up",
      wait: false,
    });

    const sendArgs = captured.find((args) => args[0] === "send");
    expect(sendArgs).toBeDefined();
    expect(sendArgs?.[1]).toBe(planner.sessionId);
    expect(sendArgs).toContain("--no-wait");
    expect(sendArgs).toContain("--prompt-file");
    expect(sendArgs!.indexOf(planner.sessionId)).toBeLessThan(sendArgs!.indexOf("--prompt-file"));
  });

  it("normalizes PASEO_HOST URL values for the paseo --host CLI argument", () => {
    expect(PaseoOpenCodeAdapter.normalizePaseoHost("http://localhost:6767")).toBe("localhost:6767");
    expect(PaseoOpenCodeAdapter.normalizePaseoHost("https://paseo.example.test")).toBe("paseo.example.test");
    expect(PaseoOpenCodeAdapter.normalizePaseoHost("localhost:6767")).toBe("localhost:6767");
  });

  it("normalizes legacy provider/model strings to separate provider and model args", async () => {
    const captured: string[][] = [];
    const adapter = new PaseoOpenCodeAdapter({
      provider: "opencode/minimax-m2.5-free",
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({ onArgs: (_c, a) => captured.push(a) }),
    });
    await adapter.startRun({ runId: "r1-legacy-provider", task: baseTask, team: DEFAULT_TEAM });
    await adapter.createLeadSession({
      runId: "r1-legacy-provider",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });

    const runArgs = captured.find((a) => a[0] === "run");
    expect(runArgs).toBeDefined();
    const provIdx = runArgs!.indexOf("--provider");
    const modelIdx = runArgs!.indexOf("--model");
    expect(runArgs![provIdx + 1]).toBe("opencode");
    expect(runArgs![modelIdx + 1]).toBe("opencode/minimax-m2.5-free");
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
    expect(events[1]?.payload["outputRef"]).toBeDefined();
  });

  it("includes workspace and artifact-write instructions in worker prompts", async () => {
    const runPrompts: string[] = [];
    const taskWithArtifact: TeamTask = {
      ...baseTask,
      artifactPath: "/tmp/pluto-live/hello-pluto.md",
    };
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: makeRunner({
        run: (args) => {
          runPrompts.push(args[args.length - 1] ?? "");
          return { stdout: '{"agentId":"worker-1"}' };
        },
      }),
    });

    await adapter.startRun({ runId: "r2-worker-prompt", task: taskWithArtifact, team: DEFAULT_TEAM });
    await adapter.createWorkerSession({
      runId: "r2-worker-prompt",
      role: getRole(DEFAULT_TEAM, "generator"),
      instructions: "Write the hello lines into the artifact file.",
    });

    expect(runPrompts).toHaveLength(1);
    expect(runPrompts[0]).toContain("Workspace path: /tmp/pluto-live");
    expect(runPrompts[0]).toContain(
      "Artifact path the team should converge on: /tmp/pluto-live/hello-pluto.md",
    );
    expect(runPrompts[0]).toContain(
      "If the lead asks you to create or update files, make those changes before replying.",
    );
    expect(runPrompts[0]).toContain(
      "Do not only describe intended edits when the task calls for an artifact change.",
    );
  });

  it("redacts persisted adapter payloads while keeping raw worker/lead data transient", async () => {
    let runCount = 0;
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: {
        async exec(_cmd, args) {
          const sub = args[0];
          if (sub === "run") {
            runCount += 1;
            return {
              stdout: JSON.stringify({ agentId: runCount === 1 ? "lead-agent" : "planner-agent" }),
              stderr: "",
              exitCode: 0,
            };
          }
          if (sub === "wait") {
            return { stdout: '{"status":"idle"}', stderr: "", exitCode: 0 };
          }
          if (sub === "send") {
            return { stdout: '{"sent":true}', stderr: "", exitCode: 0 };
          }
          if (sub === "logs") {
            if (args[1] === "planner-agent") {
              return {
                stdout: "[User] Plan\nworker token sk-ant-api03-abcdefghijklmnop\n[Thought] ok",
                stderr: "",
                exitCode: 0,
              };
            }
            return {
              stdout:
                "[User] task\n[User] All workers done. SUMMARIZE.\n# Hello team\nsummary token sk-ant-api03-abcdefghijklmnop\n[Thought] done",
              stderr: "",
              exitCode: 0,
            };
          }
          if (sub === "delete") {
            return { stdout: "", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: `unknown subcommand:${sub}`, exitCode: 1 };
        },
        follow() {
          return { dispose: async () => undefined };
        },
      },
    });
    await adapter.startRun({ runId: "r2-redacted", task: baseTask, team: DEFAULT_TEAM });
    const lead = await adapter.createLeadSession({
      runId: "r2-redacted",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    await adapter.createWorkerSession({
      runId: "r2-redacted",
      role: getRole(DEFAULT_TEAM, "planner"),
      instructions: "Plan token sk-ant-api03-abcdefghijklmnop",
    });
    await adapter.sendMessage({
      runId: "r2-redacted",
      sessionId: lead.sessionId,
      message: "All workers done. SUMMARIZE.",
    });

    const events = await adapter.readEvents({ runId: "r2-redacted" });
    const workerCompleted = events.find((e) => e.type === "worker_completed");
    const leadMessage = events.find((e) => e.type === "lead_message");

    expect(workerCompleted?.payload["output"]).toBe("worker token [REDACTED]");
    expect(workerCompleted?.payload["outputRef"]).toBeDefined();
    expect(workerCompleted?.transient?.rawPayload?.["output"]).toBe(
      "worker token sk-ant-api03-abcdefghijklmnop",
    );
    expect(leadMessage?.payload["markdown"]).toBe("# Hello team\nsummary token [REDACTED]");
    expect(leadMessage?.payload["markdownRef"]).toBeDefined();
    expect(leadMessage?.transient?.rawPayload?.["markdown"]).toBe(
      "# Hello team\nsummary token sk-ant-api03-abcdefghijklmnop",
    );
  });

  it("preserves per-attempt worker event stamping when the first wait/log path fails", async () => {
    let workerRunCount = 0;
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live",
      runner: {
        async exec(_cmd, args) {
          const sub = args[0];
          if (sub === "run") {
            workerRunCount += 1;
            return {
              stdout: `{"agentId":"planner-agent-${workerRunCount}"}`,
              stderr: "",
              exitCode: 0,
            };
          }
          if (sub === "wait") {
            if (args[1] === "planner-agent-1") {
              return { stdout: "", stderr: "timed out", exitCode: 1 };
            }
            return { stdout: '{"status":"idle"}', stderr: "", exitCode: 0 };
          }
          if (sub === "logs") {
            return {
              stdout: "[User] Plan\nstep 1\nstep 2\n[Thought] ok",
              stderr: "",
              exitCode: 0,
            };
          }
          if (sub === "delete" || sub === "send") {
            return { stdout: "", stderr: "", exitCode: 0 };
          }
          return { stdout: "", stderr: `unknown subcommand:${sub}`, exitCode: 1 };
        },
        follow() {
          return { dispose: async () => undefined };
        },
      },
    });

    await adapter.startRun({ runId: "r2-attempts", task: baseTask, team: DEFAULT_TEAM });
    await expect(
      adapter.createWorkerSession({
        runId: "r2-attempts",
        role: getRole(DEFAULT_TEAM, "planner"),
        instructions: "Plan",
      }),
    ).rejects.toThrow(/paseo_worker_wait_failed:planner/);
    await adapter.createWorkerSession({
      runId: "r2-attempts",
      role: getRole(DEFAULT_TEAM, "planner"),
      instructions: "Plan",
    });

    const events = await adapter.readEvents({ runId: "r2-attempts" });
    expect(events.map((e) => [e.type, e.payload["attempt"]])).toEqual([
      ["worker_started", 1],
      ["worker_started", 2],
      ["worker_completed", 2],
    ]);
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
    expect(summary!.payload["markdownRef"]).toBeDefined();
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
