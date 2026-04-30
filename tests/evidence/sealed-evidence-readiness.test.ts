import { describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";
import {
  assertEvidenceSealed,
  assertEvidenceUsableForGovernance,
} from "@/evidence/seal.js";

function makePacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "run-readiness-1",
    taskTitle: "Readiness evidence",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:00:02.000Z",
    workspace: null,
    workers: [
      {
        role: "reviewer",
        sessionId: "reviewer-session",
        contributionSummary: "Captured review evidence",
        tokenUsageApprox: null,
        durationMsApprox: null,
      },
    ],
    validation: { outcome: "pass", reason: null },
    citedInputs: { taskPrompt: "prompt", workspaceMarkers: [] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:00:03.000Z",
  };
}

function makeSealedEvidence(packet: EvidencePacketV0) {
  return {
    schemaVersion: 0 as const,
    kind: "sealed_evidence" as const,
    id: "sealed-readiness-1",
    packetId: "packet-readiness-1",
    runId: packet.runId,
    evidencePath: ".pluto/runs/run-readiness-1/evidence.json",
    sealChecksum: "sha256:readiness",
    sealedAt: "2026-04-30T00:00:04.000Z",
    sourceRun: {
      runId: packet.runId,
      status: "done",
      blockerReason: null,
      finishedAt: packet.finishedAt,
    },
    validationSummary: {
      outcome: packet.validation.outcome,
      reason: packet.validation.reason,
    },
    redactionSummary: {
      redactedAt: "2026-04-30T00:00:03.500Z",
      fieldsRedacted: 1,
      summary: "Redacted provider session IDs before sealing.",
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
  };
}

describe("sealed evidence readiness", () => {
  it("accepts sealed evidence with redaction-before-seal for governance gates", () => {
    const packet = makePacket();
    const sealedEvidence = makeSealedEvidence(packet);

    expect(assertEvidenceSealed(sealedEvidence, packet)).toEqual({
      ...sealedEvidence,
      sourceRun: {
        runId: packet.runId,
        status: "succeeded",
        blockerReason: null,
        finishedAt: packet.finishedAt,
      },
    });
    expect(assertEvidenceUsableForGovernance(sealedEvidence, packet)).toEqual({
      ...sealedEvidence,
      sourceRun: {
        runId: packet.runId,
        status: "succeeded",
        blockerReason: null,
        finishedAt: packet.finishedAt,
      },
    });
  });

  it("blocks unsealed evidence from satisfying review, publish, and release gates", () => {
    const packet = makePacket();
    const unsealedEvidence = {
      ...makeSealedEvidence(packet),
      sealChecksum: "",
    };

    expect(() => assertEvidenceSealed(unsealedEvidence, packet)).toThrow(
      "sealed evidence must include a seal checksum",
    );
    expect(() => assertEvidenceUsableForGovernance(unsealedEvidence, packet)).toThrow(
      "sealed evidence must include a seal checksum",
    );
  });

  it("blocks redaction-missing evidence from satisfying review, publish, and release gates", () => {
    const packet = makePacket();
    const missingRedaction = {
      ...makeSealedEvidence(packet),
      redactionSummary: {
        redactedAt: null,
        fieldsRedacted: 0,
        summary: "No redaction summary captured.",
      },
    };

    expect(() => assertEvidenceSealed(missingRedaction, packet)).toThrow(
      "sealed evidence must include redaction before seal",
    );
    expect(() => assertEvidenceUsableForGovernance(missingRedaction, packet)).toThrow(
      "sealed evidence must include redaction before seal",
    );
  });

  it("blocks evidence whose immutable packet metadata no longer matches the packet", () => {
    const packet = makePacket();
    const driftedMetadata = {
      ...makeSealedEvidence(packet),
      immutablePacket: {
        ...toImmutableEvidencePacketMetadataV0(packet),
        generatedAt: "2026-04-30T00:00:09.000Z",
      },
    };

    expect(() => assertEvidenceSealed(driftedMetadata, packet)).toThrow(
      "sealed evidence immutable packet generatedAt must match packet generatedAt",
    );
  });

  it("blocks failed validation from satisfying governance readiness", () => {
    const packet = makePacket();
    const failedValidation = {
      ...makeSealedEvidence(packet),
      validationSummary: {
        outcome: "fail",
        reason: "artifact check failed",
      },
      immutablePacket: {
        ...toImmutableEvidencePacketMetadataV0({
          ...packet,
          validation: { outcome: "fail", reason: "artifact check failed" },
        }),
      },
    };

    expect(() => assertEvidenceUsableForGovernance(failedValidation, {
      ...packet,
      validation: { outcome: "fail", reason: "artifact check failed" },
    })).toThrow("sealed evidence with failed validation is not usable for governance");
  });
});
