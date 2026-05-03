import { describe, expect, it } from "vitest";

import { PaseoOpenCodeAdapter } from "@/adapters/paseo-opencode/paseo-opencode-adapter.js";
import type { ProcessRunner } from "@/adapters/paseo-opencode/process-runner.js";
import type { AgentRoleConfig, TeamConfig, TeamTask } from "@/contracts/types.js";

describe("PaseoOpenCodeAdapter.isSessionIdle", () => {
  it("returns false before paseo ls lists the session, then true once it appears", async () => {
    const execCalls: string[][] = [];
    const runner: ProcessRunner = {
      async exec(_cmd, args) {
        execCalls.push(args);
        if (args[0] === "run") {
          return { stdout: '{"agentId":"worker-planner"}', stderr: "", exitCode: 0 };
        }
        if (args[0] === "wait") {
          return { stdout: '{"agentId":"worker-planner","status":"idle"}', stderr: "", exitCode: 0 };
        }
        if (args[0] === "logs") {
          return { stdout: "[User] prompt\nplanner output\n", stderr: "", exitCode: 0 };
        }
        if (args[0] === "ls") {
          return { stdout: '[{"agentId":"worker-planner","status":"idle"}]', stderr: "", exitCode: 0 };
        }
        throw new Error(`unexpected exec args: ${args.join(" ")}`);
      },
      follow() {
        return { dispose: async () => {} };
      },
    };

    const adapter = new PaseoOpenCodeAdapter({
      runner,
      workspaceCwd: "/tmp",
      deleteAgentsOnEnd: false,
    });
    const plannerRole: AgentRoleConfig = {
      id: "planner",
      name: "planner",
      kind: "worker",
      systemPrompt: "Plan the work.",
    };
    const team: TeamConfig = {
      id: "test-team",
      name: "Test Team",
      leadRoleId: "lead",
      roles: [plannerRole],
    };
    const task: TeamTask = {
      id: "task-1",
      title: "Idle race",
      prompt: "Check the session state.",
      workspacePath: "/tmp",
      artifactPath: "/tmp/artifact.md",
      minWorkers: 1,
    };

    await adapter.startRun({ runId: "run-idle-race", task, team });
    const session = await adapter.createWorkerSession({
      runId: "run-idle-race",
      role: plannerRole,
      instructions: "Return a planning note.",
    });

    const internals = adapter as unknown as {
      findListedSession: (stdout: string, sessionId: string) => Record<string, unknown> | null;
    };
    const originalFindListedSession = internals.findListedSession.bind(adapter);
    internals.findListedSession = () => null;

    await expect(adapter.isSessionIdle({ runId: "run-idle-race", sessionId: session.sessionId })).resolves.toBe(false);

    internals.findListedSession = originalFindListedSession;
    await expect(adapter.isSessionIdle({ runId: "run-idle-race", sessionId: session.sessionId })).resolves.toBe(true);
    expect(execCalls.some((args) => args[0] === "ls" && args[1] === "--json")).toBe(true);
  });
});
