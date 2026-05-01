/**
 * S6 quarantine boundary: these tests intentionally cover the legacy
 * marker-fallback callback lane from
 * `.local/manager/regression-fix-iteration/dispatch/S6-marker-quarantine-and-docs.md`.
 */
import { describe, expect, it } from "vitest";

import { PaseoOpenCodeAdapter } from "@/adapters/paseo-opencode/paseo-opencode-adapter.js";
import type { ProcessRunner } from "@/adapters/paseo-opencode/process-runner.js";
import type { AgentEvent, TeamTask } from "@/contracts/types.js";
import { DEFAULT_TEAM, getRole } from "@/orchestrator/team-config.js";
import { CallbackNormalizer } from "@/runtime/callback-normalizer.js";

const baseTask: TeamTask = {
  id: "live-callback-task",
  title: "Live callback normalization",
  prompt: "Produce a live callback artifact.",
  workspacePath: "/tmp/pluto-live-callbacks",
  minWorkers: 2,
  orchestrationMode: "lead_marker",
};

describe("legacy marker fallback (S6 quarantine)", () => {
  it("emits callback metadata for lead, worker, and summary events", async () => {
    const followHandles: Array<(line: string) => void> = [];
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live-callbacks",
      runner: makeRunner(followHandles),
    });

    await adapter.startRun({ runId: "live-run", task: baseTask, team: DEFAULT_TEAM });
    const lead = await adapter.createLeadSession({
      runId: "live-run",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    followHandles[0]!("malformed line");
    followHandles[0]!("WORKER_REQUEST: planner :: Plan the artifact");
    followHandles[0]!("WORKER_REQUEST: generator :: Draft the artifact");

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
    const callbackEvents = events.map((event) => event.transient?.callback).filter(Boolean);
    expect(callbackEvents).toHaveLength(events.length);
    expect(events.find((event) => event.type === "lead_started")?.transient?.callback?.source).toBe(
      "paseo_opencode",
    );
    expect(events.find((event) => event.type === "worker_completed")?.transient?.callback?.status).toBe(
      "completed",
    );
    expect(events.find((event) => event.type === "lead_message")?.transient?.callback?.status).toBe(
      "completed",
    );
  });

  it("dedupes malformed or out-of-order live callback sequences by stable identity", async () => {
    const followHandles: Array<(line: string) => void> = [];
    const adapter = new PaseoOpenCodeAdapter({
      workspaceCwd: "/tmp/pluto-live-callbacks",
      runner: makeRunner(followHandles),
    });
    const normalizer = new CallbackNormalizer();

    await adapter.startRun({ runId: "live-run-2", task: baseTask, team: DEFAULT_TEAM });
    const lead = await adapter.createLeadSession({
      runId: "live-run-2",
      task: baseTask,
      role: getRole(DEFAULT_TEAM, DEFAULT_TEAM.leadRoleId),
    });
    followHandles[0]!("WORKER_REQUEST: planner :: Plan the artifact");
    followHandles[0]!("WORKER_REQUEST: planner :: Plan the artifact");

    await adapter.createWorkerSession({
      runId: "live-run-2",
      role: getRole(DEFAULT_TEAM, "planner"),
      instructions: "Plan the artifact",
    });
    await adapter.sendMessage({
      runId: "live-run-2",
      sessionId: lead.sessionId,
      message: "All workers done. SUMMARIZE.",
    });

    const events = await adapter.readEvents({ runId: "live-run-2" });
    const workerRequested = events.find((event) => event.type === "worker_requested");
    const workerCompleted = events.find((event) => event.type === "worker_completed");
    const leadSummary = events.find((event) => event.type === "lead_message");
    const outOfOrder = [
      duplicate(workerCompleted!, "dup-completed"),
      duplicate(workerRequested!, "dup-request"),
      workerRequested!,
      workerCompleted!,
      leadSummary!,
      duplicate(leadSummary!, "dup-summary"),
    ];

    const normalized = normalizer.normalize(outOfOrder);
    expect(normalized.filter((event) => event.type === "worker_requested")).toHaveLength(1);
    expect(normalized.filter((event) => event.type === "worker_completed")).toHaveLength(1);
    expect(normalized.filter((event) => event.type === "lead_message")).toHaveLength(1);
  });
});

function makeRunner(followHandles: Array<(line: string) => void>): ProcessRunner {
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
    follow(_cmd, _args, opts) {
      followHandles.push(opts.onLine);
      return { dispose: async () => undefined };
    },
  };
}

function duplicate(event: AgentEvent, id: string): AgentEvent {
  return {
    ...event,
    id,
    ts: "2026-04-30T00:00:01.000Z",
    transient: event.transient
      ? {
          ...event.transient,
          rawPayload: event.transient.rawPayload
            ? { ...event.transient.rawPayload }
            : undefined,
          callback: event.transient.callback
            ? { ...event.transient.callback }
            : undefined,
        }
      : undefined,
  };
}
