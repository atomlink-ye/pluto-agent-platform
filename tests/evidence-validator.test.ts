import { describe, expect, it } from "vitest";

import { validateEvidencePacketV0 } from "@/orchestrator/evidence.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";

function makePacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "run-1",
    taskTitle: "Test Task",
    status: "blocked",
    blockerReason: "runtime_timeout",
    startedAt: "2026-04-29T00:00:00.000Z",
    finishedAt: "2026-04-29T00:00:01.000Z",
    workspace: null,
    workers: [
      {
        role: "planner",
        sessionId: "session-1",
        contributionSummary: "summary",
        tokenUsageApprox: 42,
        durationMsApprox: 1000,
      },
    ],
    validation: { outcome: "na", reason: null },
    citedInputs: { taskPrompt: "prompt", workspaceMarkers: ["src/index.ts"] },
    risks: ["risk-1"],
    openQuestions: ["question-1"],
    classifierVersion: 0,
    generatedAt: "2026-04-29T00:00:01.000Z",
  };
}

describe("validateEvidencePacketV0", () => {
  it("rejects invalid blockerReason values outside the canonical taxonomy", () => {
    const result = validateEvidencePacketV0({ ...makePacket(), blockerReason: "made_up_reason" });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(
      "blockerReason must be a canonical or legacy-normalizable blocker reason",
    );
  });

  it("accepts legacy blockerReason aliases that normalize successfully", () => {
    expect(validateEvidencePacketV0({ ...makePacket(), blockerReason: "worker_timeout" }).ok).toBe(true);
    expect(validateEvidencePacketV0({ ...makePacket(), blockerReason: "quota_or_model_error" }).ok).toBe(true);
  });

  it("rejects non-string array elements in risks", () => {
    const result = validateEvidencePacketV0({ ...makePacket(), risks: ["risk", 123] });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("risks[1] must be a string");
  });

  it("rejects non-string array elements in openQuestions", () => {
    const result = validateEvidencePacketV0({ ...makePacket(), openQuestions: [false] });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("openQuestions[0] must be a string");
  });

  it("rejects non-string array elements in citedInputs.workspaceMarkers", () => {
    const result = validateEvidencePacketV0({
      ...makePacket(),
      citedInputs: { taskPrompt: "prompt", workspaceMarkers: ["ok", 7] },
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("citedInputs.workspaceMarkers[1] must be a string");
  });

  it("rejects non-null non-string worker sessionId values", () => {
    const result = validateEvidencePacketV0({
      ...makePacket(),
      workers: [{ ...makePacket().workers[0]!, sessionId: 99 }],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("workers[0].sessionId must be a string or null");
  });

  it("rejects non-null non-number worker tokenUsageApprox values", () => {
    const result = validateEvidencePacketV0({
      ...makePacket(),
      workers: [{ ...makePacket().workers[0]!, tokenUsageApprox: "42" }],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("workers[0].tokenUsageApprox must be a number or null");
  });

  it("rejects non-null non-number worker durationMsApprox values", () => {
    const result = validateEvidencePacketV0({
      ...makePacket(),
      workers: [{ ...makePacket().workers[0]!, durationMsApprox: "1000" }],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("workers[0].durationMsApprox must be a number or null");
  });

  it("rejects packets missing required top-level fields", () => {
    const packet: Record<string, unknown> = { ...makePacket() };
    delete packet["generatedAt"];

    const result = validateEvidencePacketV0(packet);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("missing required field: generatedAt");
  });

  it("tolerates additive extra fields", () => {
    const result = validateEvidencePacketV0({ ...makePacket(), futureField: { nested: true } });

    expect(result.ok).toBe(true);
  });
});
