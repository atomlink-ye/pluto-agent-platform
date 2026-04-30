import { describe, expect, it } from "vitest";

import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import type { EvidencePacketV0 } from "@/contracts/types.js";
import { buildEvidenceReadinessSummaryV0 } from "@/observability/summaries.js";

function makePacket(): EvidencePacketV0 {
  return {
    schemaVersion: 0,
    runId: "run-evidence-1",
    taskTitle: "Evidence readiness",
    status: "done",
    blockerReason: null,
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: "2026-04-30T00:00:02.000Z",
    workspace: "/workspace/private/project",
    workers: [
      {
        role: "reviewer",
        sessionId: "session-redacted",
        contributionSummary: "Validated release evidence",
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

describe("buildEvidenceReadinessSummaryV0", () => {
  it("derives readiness from sealed and redacted evidence metadata instead of artifact presence", () => {
    const packet = makePacket();
    const summary = buildEvidenceReadinessSummaryV0({
      packet,
      sealedEvidence: {
        sealedAt: "2026-04-30T00:00:04.000Z",
        validationSummary: { outcome: "pass", reason: null },
        redactionSummary: {
          redactedAt: "2026-04-30T00:00:03.500Z",
          fieldsRedacted: 2,
          summary: "Redacted session identifiers before sealing.",
        },
        immutablePacket: toImmutableEvidencePacketMetadataV0(packet),
      },
      readiness: {
        governanceReady: true,
        ingestionOk: true,
      },
    });

    expect(summary.readiness).toBe("ready");
    expect(summary.severity).toBe("info");
    expect(summary.summary).toBe("readiness=ready; sealed=yes; redacted=yes; validation=pass");
    expect(summary.summary.includes("/workspace/private/project")).toBe(false);
    expect(summary.summary.includes("session-redacted")).toBe(false);
  });

  it("marks evidence blocked when sealing or ingestion readiness is missing even if the packet is done", () => {
    const packet = makePacket();
    const summary = buildEvidenceReadinessSummaryV0({
      packet,
      sealedEvidence: null,
      readiness: {
        governanceReady: false,
        ingestionOk: false,
      },
    });

    expect(summary.readiness).toBe("blocked");
    expect(summary.severity).toBe("error");
    expect(summary.summary).toBe("readiness=blocked; sealed=no; redacted=no; validation=pass");
  });
});
