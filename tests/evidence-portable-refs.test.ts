import { describe, expect, it } from "vitest";

import type { AgentEvent, TeamRunResult, TeamTask } from "@/contracts/types.js";
import { generateEvidencePacket, validateEvidencePacketV0 } from "@/orchestrator/evidence.js";
import { buildPortableRuntimeResultValueRefV0 } from "@/runtime/index.js";
import type { PortableRuntimeResultAnyRefV0 } from "@/runtime/result-contract.js";

function makeTask(): TeamTask {
  return {
    id: "test-task-1",
    title: "Test Task",
    prompt: "Generate a test artifact",
    workspacePath: "/tmp/pluto-evidence-portable-refs",
    minWorkers: 2,
  };
}

describe("portable evidence refs", () => {
  it("keeps evidence schema-valid with reference-first runtime handoff", () => {
    const runId = "run-ref-first-1";
    const plannerCompleted: AgentEvent = {
      id: "e-planner",
      runId,
      ts: "2026-04-29T00:00:03.000Z",
      type: "worker_completed",
      roleId: "planner",
      sessionId: "s2",
      payload: {
        output: "MISLEADING persisted planner payload",
      },
    };
    plannerCompleted.payload = {
      outputRef: buildPortableRuntimeResultValueRefV0(plannerCompleted, "output"),
    };

    const evaluatorCompleted: AgentEvent = {
      id: "e-evaluator",
      runId,
      ts: "2026-04-29T00:00:07.000Z",
      type: "worker_completed",
      roleId: "evaluator",
      sessionId: "s4",
      payload: {
        output: "FAIL: misleading persisted evaluator payload",
      },
    };
    evaluatorCompleted.payload = {
      outputRef: buildPortableRuntimeResultValueRefV0(evaluatorCompleted, "output"),
    };

    const events: AgentEvent[] = [
      { id: "e1", runId, ts: "2026-04-29T00:00:00.000Z", type: "run_started", payload: { taskId: "t1", prompt: "test" } },
      { id: "e2", runId, ts: "2026-04-29T00:00:02.000Z", type: "worker_started", roleId: "planner", sessionId: "s2", payload: {} },
      plannerCompleted,
      { id: "e3", runId, ts: "2026-04-29T00:00:06.000Z", type: "worker_started", roleId: "evaluator", sessionId: "s4", payload: {} },
      evaluatorCompleted,
      { id: "e4", runId, ts: "2026-04-29T00:00:08.000Z", type: "run_completed", payload: { workerCount: 2 } },
    ];

    const result: TeamRunResult = {
      runId,
      status: "completed",
      events,
      artifact: {
        runId,
        markdown: "# Portable summary\nPlanner and evaluator contributions included.",
        leadSummary: "Portable summary",
        contributions: [
          { roleId: "planner", sessionId: "s2", output: "Plan step 1\nPlan step 2" },
          { roleId: "evaluator", sessionId: "s4", output: "PASS: reference-first evidence still validates." },
        ],
      },
      runtimeResultRefs: [
        plannerCompleted.payload.outputRef,
        evaluatorCompleted.payload.outputRef,
      ] as PortableRuntimeResultAnyRefV0[],
      blockerReason: null,
    };

    const packet = generateEvidencePacket({
      task: makeTask(),
      result,
      events,
      startedAt: new Date("2026-04-29T00:00:00.000Z"),
      finishedAt: new Date("2026-04-29T00:00:08.000Z"),
      blockerReason: null,
    });
    const packetJson = JSON.stringify(packet);

    expect(validateEvidencePacketV0(packet).ok).toBe(true);
    expect(packet.runtimeResultRefs?.length).toBeGreaterThan(0);
    expect(packet.runtimeResultRefs?.some((ref) => ref.kind === "value" && ref.valueKey === "output")).toBe(true);
    expect(packet.workers.find((worker) => worker.role === "planner")?.contributionSummary).toBe(
      "Plan step 1\nPlan step 2",
    );
    expect(packet.validation.outcome).toBe("pass");
    expect(packet.validation.reason).toBe("reference-first evidence still validates.");
    expect(packetJson).not.toContain("MISLEADING persisted planner payload");
    expect(packetJson).not.toContain("misleading persisted evaluator payload");
    expect(packetJson).not.toContain("rawPayload");
  });
});
