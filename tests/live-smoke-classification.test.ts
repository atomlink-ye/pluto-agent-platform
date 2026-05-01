import { describe, expect, it } from "vitest";

import { classifyLiveSmokeEvidence } from "../docker/live-smoke.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";

const baseOrchestration = {
  playbookId: "teamlead-direct-default-v0",
  orchestrationSource: "teamlead_direct",
  orchestrationMode: "teamlead_direct" as const,
  dependencyTrace: [],
  revisions: [],
  finalReconciliation: { citations: [], valid: true },
  transcript: {
    kind: "file" as const,
    path: "/tmp/transcript.jsonl",
    roomRef: "file-transcript:test",
  },
};

function makeEvidence(
  overrides: Partial<EvidencePacketV0> = {},
): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "live-smoke-run",
    taskTitle: "live smoke",
    status: "blocked",
    blockerReason: "provider_unavailable",
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:01:00.000Z",
    workspace: null,
    workers: [],
    validation: {
      outcome: "na",
      reason: null,
    },
    citedInputs: {
      taskPrompt: "prompt",
      workspaceMarkers: [],
    },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:01:00.000Z",
    ...overrides,
  };
}

describe("classifyLiveSmokeEvidence", () => {
  it("accepts provider_unavailable blocked runs as partial", () => {
    expect(classifyLiveSmokeEvidence(makeEvidence())).toEqual({
      outcome: "partial",
      reason: "provider_unavailable",
    });
  });

  it("accepts quota_exceeded blocked runs as partial", () => {
    expect(
      classifyLiveSmokeEvidence(
        makeEvidence({ blockerReason: "quota_exceeded" }),
      ),
    ).toEqual({
      outcome: "partial",
      reason: "quota_exceeded",
    });
  });

  it("rejects other blocked reasons", () => {
    expect(
      classifyLiveSmokeEvidence(
        makeEvidence({ blockerReason: "validation_failed" }),
      ),
    ).toEqual({
      outcome: "failed",
      blockerReason: "validation_failed",
      message: "blocked run is not an acceptable partial: validation_failed",
    });
  });

  it("rejects missing blocker reasons on blocked evidence", () => {
    expect(
      classifyLiveSmokeEvidence(
        makeEvidence({ blockerReason: null }),
      ),
    ).toEqual({
      outcome: "failed",
      blockerReason: null,
      message: "blocked run is not an acceptable partial: missing blocker reason",
    });
  });

  it("passes through done evidence", () => {
    expect(
      classifyLiveSmokeEvidence(
        makeEvidence({ status: "done", blockerReason: null }),
      ),
    ).toEqual({ outcome: "done" });
  });

  it("treats completed_with_escalation evidence as done classification", () => {
    expect(
      classifyLiveSmokeEvidence(
        makeEvidence({
          status: "done",
          blockerReason: null,
          orchestration: {
            ...baseOrchestration,
            revisions: [{ stageId: "generator-output", attempt: 1, evaluatorVerdict: "FAIL: retry" }],
            escalation: { stageId: "generator-output", attempts: 1, lastVerdict: "FAIL: retry" },
          },
        }),
      ),
    ).toEqual({ outcome: "done" });
  });

  it("treats completed_with_warnings evidence as done classification", () => {
    expect(
      classifyLiveSmokeEvidence(
        makeEvidence({
          status: "done",
          blockerReason: null,
          orchestration: {
            ...baseOrchestration,
            finalReconciliation: {
              citations: [{ stageId: "evaluator-verdict", present: false }],
              valid: false,
            },
          },
        }),
      ),
    ).toEqual({ outcome: "done" });
  });

  it("normalizes legacy quota blockers before classifying", () => {
    expect(
      classifyLiveSmokeEvidence(
        makeEvidence({ blockerReason: "quota_or_model_error" as EvidencePacketV0["blockerReason"] }),
      ),
    ).toEqual({
      outcome: "failed",
      blockerReason: "runtime_error",
      message: "blocked run is not an acceptable partial: runtime_error",
    });
  });
});
