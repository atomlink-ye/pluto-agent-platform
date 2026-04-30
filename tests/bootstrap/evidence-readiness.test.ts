import { describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";
import { evaluateEvidenceReadiness } from "@/bootstrap/evidence-readiness.js";
import { buildDocumentDetailProjection } from "@/governance/projections.js";
import { buildFirstRunRecords } from "@/bootstrap/first-run.js";

function makePacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "run-evidence-readiness-1",
    taskTitle: "Evidence readiness",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:00:03.000Z",
    workspace: null,
    workers: [
      {
        role: "evaluator",
        sessionId: "evaluator-session",
        contributionSummary: "Checked evidence readiness.",
        tokenUsageApprox: null,
        durationMsApprox: null,
      },
    ],
    validation: { outcome: "pass", reason: null },
    citedInputs: { taskPrompt: "prompt", workspaceMarkers: [] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:00:04.000Z",
  };
}

function makeSealedEvidence(packet: EvidencePacketV0) {
  return {
    schemaVersion: 0 as const,
    kind: "sealed_evidence" as const,
    id: "sealed-evidence-readiness-1",
    packetId: "packet-evidence-readiness-1",
    runId: packet.runId,
    evidencePath: `.pluto/runs/${packet.runId}/evidence.json`,
    sealChecksum: "sha256:evidence-readiness",
    sealedAt: "2026-04-30T00:00:05.000Z",
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
      redactedAt: "2026-04-30T00:00:04.500Z",
      fieldsRedacted: 1,
      summary: "Redacted session details before sealing.",
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
  };
}

describe("bootstrap evidence readiness", () => {
  it("accepts non-empty artifact plus sealed evidence readiness", () => {
    const packet = makePacket();
    const firstRun = buildFirstRunRecords({
      workspaceId: "workspace-1",
      ownerId: "owner-1",
      documentTitle: "Evidence readiness doc",
      runId: packet.runId,
      runStatus: "done",
      blockerReason: null,
      finishedAt: packet.finishedAt,
      evidencePacket: packet,
    });
    const documentProjection = buildDocumentDetailProjection({
      document: firstRun.document,
      versions: [firstRun.version],
      provenanceByVersionId: { [firstRun.version.id]: firstRun.provenance },
      runtimeAvailable: true,
    });

    const readiness = evaluateEvidenceReadiness({
      run: {
        runId: packet.runId,
        status: "done",
        blockerReason: null,
        finishedAt: packet.finishedAt,
      },
      artifactMarkdown: "# Artifact\n\nNot empty.",
      evidencePacket: packet,
      sealedEvidence: makeSealedEvidence(packet),
      documentProjection,
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.reviewReady).toBe(true);
    expect(readiness.blockedReasons).toEqual([]);
    expect(readiness.degradedReasons).toEqual([]);
  });

  it("blocks empty artifacts and unsealed evidence instead of reporting completion", () => {
    const packet = makePacket();
    const readiness = evaluateEvidenceReadiness({
      run: {
        runId: packet.runId,
        status: "done",
        blockerReason: null,
        finishedAt: packet.finishedAt,
      },
      artifactMarkdown: "   ",
      evidencePacket: packet,
      sealedEvidence: {
        ...makeSealedEvidence(packet),
        sealChecksum: "",
      },
      documentProjection: {
        pageState: "ready",
        currentVersion: { id: "ver-1" },
        evidence: [{ runId: packet.runId, evidencePath: `.pluto/runs/${packet.runId}/evidence.json`, validationOutcome: "pass" }],
        recentRuns: [{ runId: packet.runId, status: "succeeded", blockerReason: null, finishedAt: packet.finishedAt }],
      },
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.reviewReady).toBe(true);
    expect(readiness.blockedReasons).toContain("empty_artifact");
    expect(readiness.blockedReasons).toContain("missing_sealed_evidence");
  });
});
