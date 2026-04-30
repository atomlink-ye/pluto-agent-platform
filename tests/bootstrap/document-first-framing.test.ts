import { describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";
import { evaluateEvidenceReadiness } from "@/bootstrap/evidence-readiness.js";
import { buildDocumentDetailProjection } from "@/governance/projections.js";
import { buildFirstRunRecords } from "@/bootstrap/first-run.js";

function makePacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "run-document-first-1",
    taskTitle: "Document first framing",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:00:02.000Z",
    workspace: null,
    workers: [
      {
        role: "generator",
        sessionId: "generator-session",
        contributionSummary: "Generated the first document artifact.",
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
    id: "sealed-document-first-1",
    packetId: "packet-document-first-1",
    runId: packet.runId,
    evidencePath: `.pluto/runs/${packet.runId}/evidence.json`,
    sealChecksum: "sha256:document-first",
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
      summary: "Redacted runtime session details before sealing.",
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
  };
}

describe("document-first framing", () => {
  it("degrades instead of reporting false completion when review-ready document surfaces are absent", () => {
    const packet = makePacket();
    const firstRun = buildFirstRunRecords({
      workspaceId: "workspace-1",
      ownerId: "owner-1",
      documentTitle: "First doc",
      runId: packet.runId,
      runStatus: "done",
      blockerReason: null,
      finishedAt: packet.finishedAt,
      evidencePacket: packet,
    });
    const documentProjection = buildDocumentDetailProjection({
      document: firstRun.document,
      versions: [firstRun.version],
      runtimeAvailable: true,
    });

    const readiness = evaluateEvidenceReadiness({
      run: {
        runId: packet.runId,
        status: "done",
        blockerReason: null,
        finishedAt: packet.finishedAt,
      },
      artifactMarkdown: "# Document\n\nArtifact content.",
      evidencePacket: packet,
      sealedEvidence: makeSealedEvidence(packet),
      documentProjection,
    });

    expect(documentProjection).toMatchObject({
      pageState: "ready",
      currentVersion: { id: firstRun.version.id },
      evidence: [],
      recentRuns: [],
    });
    expect(readiness.status).toBe("degraded");
    expect(readiness.reviewReady).toBe(false);
    expect(readiness.blockedReasons).toEqual([]);
    expect(readiness.degradedReasons).toContain("missing_evidence_surface");
    expect(readiness.degradedReasons).toContain("missing_run_surface");
  });
});
