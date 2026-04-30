import { describe, expect, it } from "vitest";

import type {
  EvalRubricRefV0,
  EvalRubricSummaryV0,
  QAGateRecordV0,
  ReleaseCandidateRecordV0,
  WaiverRecordV0,
} from "@/contracts/release.js";
import { evaluateReleaseReadiness } from "@/release/readiness.js";

function makeCandidate(): ReleaseCandidateRecordV0 {
  return {
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
      summary: "Docs site rollout",
    },
    candidateEvidenceRefs: ["sealed:candidate"],
    createdById: "publisher-1",
    status: "candidate",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:01:00.000Z",
  };
}

function makeTestGate(id: string, outcome: QAGateRecordV0["observedOutcome"], observedEvidenceRefs: string[]): QAGateRecordV0 {
  return {
    schema: "pluto.release.qa-gate",
    schemaVersion: 0,
    id,
    candidateId: "candidate-1",
    gateKind: "test",
    label: id,
    mandatory: true,
    expectedEvidenceRefs: ["sealed:test"],
    observedEvidenceRefs,
    observedOutcome: outcome,
    failureSummary: outcome === "fail" ? "failed test suite" : null,
    evalRubricRefId: null,
    checkedAt: "2026-04-30T00:02:00.000Z",
  };
}

describe("release readiness evaluator", () => {
  it("blocks readiness when a mandatory gate fails without a valid waiver", () => {
    const report = evaluateReleaseReadiness({
      reportId: "report-1",
      candidate: makeCandidate(),
      qaGates: [makeTestGate("gate-tests", "fail", ["sealed:test"])],
      generatedAt: "2026-04-30T00:10:00.000Z",
    });

    expect(report.status).toBe("blocked");
    expect(report.blockedReasons).toContain("gate:gate-tests:failed");
    expect(report.gateResults[0]?.effectiveOutcome).toBe("fail");
  });

  it("unblocks only the waived mandatory gate when approval and decision evidence are scoped correctly", () => {
    const gates: QAGateRecordV0[] = [
      makeTestGate("gate-tests", "fail", ["sealed:test"]),
      makeTestGate("gate-security", "fail", ["sealed:security"]),
    ];

    const waiver: WaiverRecordV0 = {
      schema: "pluto.release.waiver",
      schemaVersion: 0,
      id: "waiver-1",
      candidateId: "candidate-1",
      approverId: "approver-1",
      justification: "Approved exception for the flaky suite only.",
      scope: {
        candidateId: "candidate-1",
        gateIds: ["gate-tests"],
      },
      approvalEvidenceRefs: ["sealed:approval"],
      decisionEvidenceRefs: ["sealed:decision"],
      status: "approved",
      expiresAt: null,
      createdAt: "2026-04-30T00:03:00.000Z",
      updatedAt: "2026-04-30T00:04:00.000Z",
    };

    const report = evaluateReleaseReadiness({
      reportId: "report-2",
      candidate: makeCandidate(),
      qaGates: gates,
      waivers: [waiver],
      generatedAt: "2026-04-30T00:10:00.000Z",
    });

    expect(report.status).toBe("blocked");
    expect(report.waiverIds).toEqual(["waiver-1"]);
    expect(report.gateResults.find((gate) => gate.gateId === "gate-tests")?.effectiveOutcome).toBe("waived");
    expect(report.gateResults.find((gate) => gate.gateId === "gate-security")?.effectiveOutcome).toBe("fail");
    expect(report.blockedReasons).toContain("gate:gate-security:failed");
    expect(report.blockedReasons).not.toContain("gate:gate-tests:failed");
  });

  it("keeps missing evidence gates from passing even when the observed outcome says pass", () => {
    const evalGate: QAGateRecordV0 = {
      schema: "pluto.release.qa-gate",
      schemaVersion: 0,
      id: "gate-eval",
      candidateId: "candidate-1",
      gateKind: "eval",
      label: "Release eval",
      mandatory: true,
      expectedEvidenceRefs: ["sealed:eval-expected"],
      observedEvidenceRefs: [],
      observedOutcome: "pass",
      failureSummary: null,
      evalRubricRefId: "rubric-ref-1",
      checkedAt: "2026-04-30T00:02:00.000Z",
    };

    const rubricRef: EvalRubricRefV0 = {
      schema: "pluto.release.eval-rubric-ref",
      schemaVersion: 0,
      id: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-eval",
      rubricId: "release-quality",
      rubricVersion: "2026-04-30",
      expectedPassCondition: "all critical checks pass",
      summaryRef: "citation:eval-summary",
    };

    const rubricSummary: EvalRubricSummaryV0 = {
      schema: "pluto.release.eval-rubric-summary",
      schemaVersion: 0,
      id: "rubric-summary-1",
      rubricRefId: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-eval",
      outcome: "pass",
      summaryRef: "citation:eval-summary",
      evidenceRefs: [],
      evaluatedAt: "2026-04-30T00:03:00.000Z",
    };

    const report = evaluateReleaseReadiness({
      reportId: "report-3",
      candidate: makeCandidate(),
      qaGates: [evalGate],
      evalRubricRefs: [rubricRef],
      evalRubricSummaries: [rubricSummary],
      generatedAt: "2026-04-30T00:10:00.000Z",
    });

    expect(report.status).toBe("pending");
    expect(report.gateResults[0]?.effectiveOutcome).toBe("pending");
    expect(report.gateResults[0]?.blockedReasons).toContain("missing_observed_evidence");
    expect(report.gateResults[0]?.blockedReasons).toContain("missing_expected_evidence:sealed:eval-expected");
    expect(report.gateResults[0]?.blockedReasons).toContain("missing_eval_evidence");
  });
});
