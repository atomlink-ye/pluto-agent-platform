import { describe, expect, it } from "vitest";

import {
  validateEvalRubricRefV0,
  validateEvalRubricSummaryV0,
  validateQAGateRecordV0,
  validateReleaseCandidateRecordV0,
  validateReleaseReadinessReportV0,
  validateWaiverRecordV0,
} from "@/contracts/release.js";

describe("release readiness contracts", () => {
  it("validates release candidate, gate, waiver, and report schemas", () => {
    const candidate = {
      schema: "pluto.release.candidate",
      schemaVersion: 0,
      id: "candidate-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
      targetScope: {
        targetKind: "channel",
        targetId: "docs-site",
        summary: "Docs site release candidate",
      },
      candidateEvidenceRefs: ["sealed:build", "sealed:artifact"],
      createdById: "publisher-1",
      status: "candidate",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:01:00.000Z",
    };

    const gate = {
      schema: "pluto.release.qa-gate",
      schemaVersion: 0,
      id: "gate-1",
      candidateId: "candidate-1",
      gateKind: "test",
      label: "Unit tests",
      mandatory: true,
      expectedEvidenceRefs: ["sealed:test"],
      observedEvidenceRefs: ["sealed:test"],
      observedOutcome: "pass",
      failureSummary: null,
      evalRubricRefId: null,
      checkedAt: "2026-04-30T00:02:00.000Z",
    };

    const rubricRef = {
      schema: "pluto.release.eval-rubric-ref",
      schemaVersion: 0,
      id: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-2",
      rubricId: "release-quality",
      rubricVersion: "2026-04-30",
      expectedPassCondition: "overall >= 0.9 and no critical regressions",
      summaryRef: "citation:eval-summary",
    };

    const rubricSummary = {
      schema: "pluto.release.eval-rubric-summary",
      schemaVersion: 0,
      id: "rubric-summary-1",
      rubricRefId: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-2",
      outcome: "pass",
      summaryRef: "citation:eval-summary",
      evidenceRefs: ["sealed:eval-summary"],
      evaluatedAt: "2026-04-30T00:03:00.000Z",
    };

    const waiver = {
      schema: "pluto.release.waiver",
      schemaVersion: 0,
      id: "waiver-1",
      candidateId: "candidate-1",
      approverId: "approver-1",
      justification: "Known flaky check with documented fallback evidence.",
      scope: {
        candidateId: "candidate-1",
        gateIds: ["gate-3"],
      },
      approvalEvidenceRefs: ["sealed:approval"],
      decisionEvidenceRefs: ["sealed:decision"],
      status: "approved",
      expiresAt: null,
      createdAt: "2026-04-30T00:04:00.000Z",
      updatedAt: "2026-04-30T00:05:00.000Z",
    };

    const report = {
      schema: "pluto.release.readiness-report",
      schemaVersion: 0,
      id: "report-1",
      candidateId: "candidate-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
      status: "ready",
      blockedReasons: [],
      generatedAt: "2026-04-30T00:06:00.000Z",
      gateResults: [
        {
          gateId: "gate-1",
          gateKind: "test",
          label: "Unit tests",
          mandatory: true,
          observedOutcome: "pass",
          effectiveOutcome: "pass",
          waivedBy: null,
          expectedEvidenceRefs: ["sealed:test"],
          observedEvidenceRefs: ["sealed:test"],
          evalRubricRefId: null,
          blockedReasons: [],
        },
      ],
      waiverIds: ["waiver-1"],
      testEvidenceRefs: ["sealed:test"],
      evalEvidenceRefs: ["sealed:eval-summary"],
      manualCheckEvidenceRefs: [],
      artifactCheckEvidenceRefs: [],
      evalRubricRefs: [rubricRef],
      evalRubricSummaries: [rubricSummary],
    };

    expect(validateReleaseCandidateRecordV0(candidate).ok).toBe(true);
    expect(validateQAGateRecordV0(gate).ok).toBe(true);
    expect(validateEvalRubricRefV0(rubricRef).ok).toBe(true);
    expect(validateEvalRubricSummaryV0(rubricSummary).ok).toBe(true);
    expect(validateWaiverRecordV0(waiver).ok).toBe(true);
    expect(validateReleaseReadinessReportV0(report).ok).toBe(true);
  });

  it("fails invalid waiver scope and report gate entries", () => {
    const waiver = validateWaiverRecordV0({
      schema: "pluto.release.waiver",
      schemaVersion: 0,
      id: "waiver-bad",
      candidateId: "candidate-1",
      approverId: "approver-1",
      justification: "Missing scoped gates",
      scope: {
        candidateId: "candidate-1",
        gateIds: [1],
      },
      approvalEvidenceRefs: [],
      decisionEvidenceRefs: [],
      status: "approved",
      expiresAt: null,
      createdAt: "2026-04-30T00:04:00.000Z",
      updatedAt: "2026-04-30T00:05:00.000Z",
    });

    const report = validateReleaseReadinessReportV0({
      schema: "pluto.release.readiness-report",
      schemaVersion: 0,
      id: "report-bad",
      candidateId: "candidate-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
      status: "blocked",
      blockedReasons: [],
      generatedAt: "2026-04-30T00:06:00.000Z",
      gateResults: [{ gateId: "gate-1" }],
      waiverIds: [],
      testEvidenceRefs: [],
      evalEvidenceRefs: [],
      manualCheckEvidenceRefs: [],
      artifactCheckEvidenceRefs: [],
      evalRubricRefs: [],
      evalRubricSummaries: [],
    });

    expect(waiver.ok).toBe(false);
    expect(waiver.ok ? [] : waiver.errors).toContain("scope.gateIds must be an array of strings");
    expect(report.ok).toBe(false);
    expect(report.ok ? [] : report.errors.some((entry) => entry.startsWith("gateResults[0].missing required field: label"))).toBe(true);
  });
});
