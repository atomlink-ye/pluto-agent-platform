import { describe, expect, it } from "vitest";

import type {
  EvalRubricRefV0,
  EvalRubricSummaryV0,
  QAGateRecordV0,
  ReleaseCandidateRecordV0,
} from "@/contracts/release.js";
import { evaluateReleaseReadiness } from "@/release/readiness.js";

const candidate: ReleaseCandidateRecordV0 = {
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
    summary: "Docs rollout",
  },
  candidateEvidenceRefs: ["sealed:candidate"],
  createdById: "publisher-1",
  status: "candidate",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:01:00.000Z",
};

describe("release readiness tests vs evals", () => {
  it("keeps engineering test evidence separate from eval rubric evidence", () => {
    const gates: QAGateRecordV0[] = [
      {
        schema: "pluto.release.qa-gate",
        schemaVersion: 0,
        id: "gate-tests",
        candidateId: "candidate-1",
        gateKind: "test",
        label: "Unit tests",
        mandatory: true,
        expectedEvidenceRefs: ["sealed:test-output"],
        observedEvidenceRefs: ["sealed:test-output"],
        observedOutcome: "pass",
        failureSummary: null,
        evalRubricRefId: null,
        checkedAt: "2026-04-30T00:02:00.000Z",
      },
      {
        schema: "pluto.release.qa-gate",
        schemaVersion: 0,
        id: "gate-eval",
        candidateId: "candidate-1",
        gateKind: "eval",
        label: "Product eval",
        mandatory: true,
        expectedEvidenceRefs: ["sealed:eval-judgement"],
        observedEvidenceRefs: ["sealed:eval-judgement"],
        observedOutcome: "pass",
        failureSummary: null,
        evalRubricRefId: "rubric-ref-1",
        checkedAt: "2026-04-30T00:03:00.000Z",
      },
    ];

    const rubricRef: EvalRubricRefV0 = {
      schema: "pluto.release.eval-rubric-ref",
      schemaVersion: 0,
      id: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-eval",
      rubricId: "release-quality",
      rubricVersion: "2026-04-30",
      expectedPassCondition: "score >= 0.9",
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
      evidenceRefs: ["sealed:eval-summary"],
      evaluatedAt: "2026-04-30T00:04:00.000Z",
    };

    const report = evaluateReleaseReadiness({
      reportId: "report-1",
      candidate,
      qaGates: gates,
      evalRubricRefs: [rubricRef],
      evalRubricSummaries: [rubricSummary],
      generatedAt: "2026-04-30T00:05:00.000Z",
    });

    expect(report.status).toBe("ready");
    expect(report.testEvidenceRefs).toEqual(["sealed:test-output"]);
    expect(report.evalEvidenceRefs).toEqual(["sealed:eval-judgement", "sealed:eval-summary"]);
    expect(report.testEvidenceRefs).not.toContain("sealed:eval-judgement");
    expect(report.evalRubricRefs).toEqual([rubricRef]);
    expect(report.evalRubricSummaries).toEqual([rubricSummary]);
  });

  it("never marks an eval gate passed without evidence-backed summaries", () => {
    const report = evaluateReleaseReadiness({
      reportId: "report-2",
      candidate,
      qaGates: [{
        schema: "pluto.release.qa-gate",
        schemaVersion: 0,
        id: "gate-eval",
        candidateId: "candidate-1",
        gateKind: "eval",
        label: "Product eval",
        mandatory: true,
        expectedEvidenceRefs: ["sealed:eval-judgement"],
        observedEvidenceRefs: ["sealed:eval-judgement"],
        observedOutcome: "pass",
        failureSummary: null,
        evalRubricRefId: "rubric-ref-missing",
        checkedAt: "2026-04-30T00:03:00.000Z",
      }],
      evalRubricRefs: [],
      evalRubricSummaries: [],
      generatedAt: "2026-04-30T00:05:00.000Z",
    });

    expect(report.status).toBe("pending");
    expect(report.gateResults[0]?.effectiveOutcome).toBe("pending");
    expect(report.gateResults[0]?.blockedReasons).toContain("missing_eval_rubric_ref");
    expect(report.gateResults[0]?.blockedReasons).toContain("missing_eval_summary");
  });
});
