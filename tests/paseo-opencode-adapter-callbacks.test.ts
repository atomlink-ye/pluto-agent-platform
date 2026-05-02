import { describe, expect, it } from "vitest";

import { PaseoOpenCodeAdapter } from "@/adapters/paseo-opencode/paseo-opencode-adapter.js";
import type { ProcessRunner } from "@/adapters/paseo-opencode/process-runner.js";
import { DEFAULT_TEAM, getRole } from "@/orchestrator/team-config.js";

describe("paseo adapter callback metadata", () => {
  it("emits callback metadata for lead, worker, and summary events", async () => {
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live-callbacks",
      runner: makeRunner(),
    });

    await adapter.startRun({
      runId: "live-run",
      task: {
        id: "live-callback-task",
        title: "Live callback normalization",
        prompt: "Produce a live callback artifact.",
        workspacePath: "/tmp/pluto-live-callbacks",
        minWorkers: 2,
      },
      team: DEFAULT_TEAM,
    });
    const lead = await adapter.createLeadSession({
      runId: "live-run",
      task: {
        id: "live-callback-task",
        title: "Live callback normalization",
        prompt: "Produce a live callback artifact.",
        workspacePath: "/tmp/pluto-live-callbacks",
        minWorkers: 2,
      },
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    await adapter.createWorkerSession({
      runId: "live-run",
      role: getRole(DEFAULT_TEAM, "planner"),
      instructions: "Plan the artifact",
    });
    await adapter.sendMessage({
      runId: "live-run",
      sessionId: lead.sessionId,
      message: "All workers done. SUMMARIZE.",
    });

    const events = await adapter.readEvents({ runId: "live-run" });
    expect(events.every((event) => event.transient?.callback)).toBe(true);
    expect(events.find((event) => event.type === "lead_started")?.transient?.callback?.source).toBe("paseo_opencode");
    expect(events.find((event) => event.type === "worker_completed")?.transient?.callback?.status).toBe("completed");
    expect(events.find((event) => event.type === "lead_message")?.transient?.callback?.status).toBe("completed");
  });
});

function makeRunner(): ProcessRunner {
  let runCount = 0;
  return {
    async exec(_cmd, args) {
      const sub = args[0];
      if (sub === "run") {
        runCount += 1;
        return {
          stdout: JSON.stringify({ agentId: runCount === 1 ? "lead-agent" : `worker-agent-${runCount}` }),
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
        if (args[1] === "lead-agent") {
          return {
            stdout: "[User] All workers done. SUMMARIZE.\n# Summary\nplanner: done\n[Thought] done",
            stderr: "",
            exitCode: 0,
          };
        }
        return {
          stdout: "[User] Plan the artifact\nplanner output\n[Thought] done",
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
  };
}
