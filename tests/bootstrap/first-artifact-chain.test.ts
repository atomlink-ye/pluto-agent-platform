import { describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";
import { buildFirstArtifactChain } from "@/bootstrap/first-artifact.js";

function makePacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "run-first-artifact-1",
    taskTitle: "First governed artifact",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:00:04.000Z",
    workspace: null,
    workers: [
      {
        role: "generator",
        sessionId: "generator-session",
        contributionSummary: "Generated the first artifact.",
        tokenUsageApprox: null,
        durationMsApprox: null,
      },
    ],
    validation: { outcome: "pass", reason: "artifact is review-ready" },
    citedInputs: { taskPrompt: "prompt", workspaceMarkers: [] },
    risks: [],
    openQuestions: [],
    classifierVersion: 0,
    generatedAt: "2026-04-30T00:00:05.000Z",
  };
}

function makeSealedEvidence(packet: EvidencePacketV0) {
  return {
    schemaVersion: 0 as const,
    kind: "sealed_evidence" as const,
    id: "sealed-first-artifact-1",
    packetId: "packet-first-artifact-1",
    runId: packet.runId,
    evidencePath: `.pluto/runs/${packet.runId}/evidence.json`,
    sealChecksum: "sha256:first-artifact",
    sealedAt: "2026-04-30T00:00:06.000Z",
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
      redactedAt: "2026-04-30T00:00:05.500Z",
      fieldsRedacted: 1,
      summary: "Redacted runtime-specific session details before sealing.",
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
  };
}

describe("first artifact chain", () => {
  it("builds the governed workspace -> document -> version -> run -> artifact -> evidence chain", () => {
    const packet = makePacket();
    const chain = buildFirstArtifactChain({
      workspaceStatus: {
        status: "ready",
        workspaceRef: { workspaceId: "workspace-local-v0", kind: "workspace", id: "workspace-local-v0" },
      },
      workspaceId: "workspace-local-v0",
      ownerId: "user-local-admin",
      documentTitle: "First Artifact",
      runId: packet.runId,
      runStatus: "done",
      blockerReason: null,
      finishedAt: packet.finishedAt,
      evidencePacket: packet,
      artifactMarkdown: "# First Artifact\n\nReview-ready output.",
      sealedEvidence: makeSealedEvidence(packet),
    });

    expect(chain.status).toBe("ready");
    expect(chain.workspace.ref).toEqual({
      workspaceId: "workspace-local-v0",
      kind: "workspace",
      id: "workspace-local-v0",
    });
    expect(chain.document.pageState).toBe("ready");
    expect(chain.document.document.currentVersionId).toBe(chain.version.id);
    expect(chain.document.currentVersion).toMatchObject({
      id: chain.version.id,
      latestRun: {
        runId: packet.runId,
        status: "succeeded",
        blockerReason: null,
        finishedAt: packet.finishedAt,
      },
      latestEvidence: {
        runId: packet.runId,
        evidencePath: `.pluto/runs/${packet.runId}/evidence.json`,
        validationOutcome: "pass",
      },
    });
    expect(chain.document.evidence).toEqual([
      {
        runId: packet.runId,
        evidencePath: `.pluto/runs/${packet.runId}/evidence.json`,
        validationOutcome: "pass",
      },
    ]);
    expect(chain.document.recentRuns).toEqual([
      {
        runId: packet.runId,
        status: "succeeded",
        blockerReason: null,
        finishedAt: packet.finishedAt,
      },
    ]);
    expect(chain.artifact.nonEmpty).toBe(true);
    expect(chain.evidence.readiness.reviewReady).toBe(true);
    expect(chain.blockedReasons).toEqual([]);
    expect(chain.degradedReasons).toEqual([]);
  });
});
