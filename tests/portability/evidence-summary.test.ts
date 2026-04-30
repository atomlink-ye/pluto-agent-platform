import { describe, expect, it } from "vitest";

import { toEvidenceSummaryExportV0, validateEvidenceSummaryExportV0 } from "@/contracts/portability.js";

describe("portable evidence summaries", () => {
  it("preserves readiness, citation, and validation outcome without raw runtime artifacts or transcripts", () => {
    const summary = toEvidenceSummaryExportV0({
      id: "evidence-summary-1",
      logicalRef: {
        kind: "evidence_summary",
        logicalId: "evidence.release-1",
        sourceDocumentId: "document-1",
        sourceVersionId: "version-9",
      },
      title: "Release Readiness Evidence",
      createdAt: "2026-04-30T00:00:00.000Z",
      exportedAt: "2026-04-30T00:01:00.000Z",
      workflowRefs: [{
        kind: "portable_workflow_bundle",
        workflowId: "release-workflow",
        bundleRef: "portable-workflow://bundle/release-workflow-v2",
      }],
      compatibility: {
        schemaVersion: 0,
        bundle: {
          family: "pluto.portability.bundle",
          version: 0,
          writtenAt: "2026-04-30T00:00:00.000Z",
        },
        target: {
          schemaFamilies: ["pluto.portability.bundle"],
          schemaVersions: [0],
        },
        dependencies: [{ id: "portable-workflow:release", resolved: true }],
      },
      checksum: { algorithm: "sha256", digest: "evidence-summary-checksum" },
      redactionSummary: {
        schema: "pluto.portability.redaction-summary",
        schemaVersion: 0,
        redactedFields: ["runtime_summary_ref", "provider_payload_ref"],
        redactedRefKinds: ["runtime", "provider"],
        excludedContent: ["raw_runtime_transcripts", "provider_payloads"],
        summary: "Only evidence summaries and citations are retained.",
      },
      evidence: {
        sealedEvidenceId: "sealed-evidence-9",
        citationRefs: [
          {
            citationId: "citation-9",
            citationKind: "validation",
            locator: "artifact.md#release-summary",
            summary: "Release summary citation",
          },
        ],
        validation: {
          outcome: "pass",
          reason: "All mandatory gates passed.",
        },
        readiness: {
          status: "ready",
          blockedReasons: [],
          summary: "Ready for governed publish.",
        },
      },
    });

    expect(validateEvidenceSummaryExportV0(summary).ok).toBe(true);
    expect(summary.evidence.validation.outcome).toBe("pass");
    expect(summary.evidence.readiness.status).toBe("ready");
    expect(summary.evidence.citationRefs[0]?.locator).toBe("artifact.md#release-summary");

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("runtimeTranscript");
    expect(serialized).not.toContain("providerStdout");
    expect(serialized).not.toContain("runtimeResultRefs");
    expect(serialized).not.toContain("evidencePath");
  });

  it("rejects evidence summaries that embed raw runtime transcript fields", () => {
    const result = validateEvidenceSummaryExportV0({
      schema: "pluto.portability.evidence-summary-export",
      schemaVersion: 0,
      kind: "evidence_summary",
      id: "evidence-summary-bad",
      logicalRef: { kind: "evidence_summary", logicalId: "evidence.release-bad" },
      title: "Bad Evidence Summary",
      createdAt: "2026-04-30T00:00:00.000Z",
      exportedAt: "2026-04-30T00:01:00.000Z",
      workflowRefs: [],
      compatibility: {
        schemaVersion: 0,
        bundle: {
          family: "pluto.portability.bundle",
          version: 0,
          writtenAt: "2026-04-30T00:00:00.000Z",
        },
        target: {
          schemaFamilies: ["pluto.portability.bundle"],
          schemaVersions: [0],
        },
        dependencies: [],
      },
      checksum: { algorithm: "sha256", digest: "bad-checksum" },
      redactionSummary: {
        schema: "pluto.portability.redaction-summary",
        schemaVersion: 0,
        redactedFields: [],
        redactedRefKinds: [],
        excludedContent: ["raw_runtime_transcripts"],
        summary: "Should have removed transcripts.",
      },
      evidence: {
        sealedEvidenceId: "sealed-evidence-bad",
        citationRefs: [],
        validation: { outcome: "pass", reason: null },
        readiness: { status: "ready", blockedReasons: [], summary: "Ready." },
      },
      runtimeTranscript: "should never be portable",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("runtimeTranscript must be excluded from portable bundles");
  });
});
