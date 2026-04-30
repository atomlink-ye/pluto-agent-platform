import type {
  EvalRubricRefV0,
  EvalRubricSummaryV0,
  QAGateKindLikeV0,
  QAGateRecordV0,
  ReleaseCandidateRecordV0,
  ReleaseGateResultV0,
  ReleaseReadinessReportV0,
  WaiverRecordV0,
} from "../contracts/release.js";
import { toReleaseReadinessReportV0 } from "../contracts/release.js";

export interface EvaluateReleaseReadinessInput {
  reportId: string;
  candidate: ReleaseCandidateRecordV0;
  qaGates: QAGateRecordV0[];
  waivers?: WaiverRecordV0[];
  evalRubricRefs?: EvalRubricRefV0[];
  evalRubricSummaries?: EvalRubricSummaryV0[];
  generatedAt: string;
}

interface WaiverResolution {
  waiverId: string;
  approved: boolean;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isWaiverApprovedForGate(
  waiver: WaiverRecordV0,
  candidateId: string,
  gateId: string,
  generatedAt: string,
): WaiverResolution {
  if (waiver.status !== "approved") {
    return { waiverId: waiver.id, approved: false };
  }

  if (waiver.candidateId !== candidateId || waiver.scope.candidateId !== candidateId) {
    return { waiverId: waiver.id, approved: false };
  }

  if (!waiver.scope.gateIds.includes(gateId)) {
    return { waiverId: waiver.id, approved: false };
  }

  if (waiver.approvalEvidenceRefs.length === 0 || waiver.decisionEvidenceRefs.length === 0) {
    return { waiverId: waiver.id, approved: false };
  }

  if (waiver.expiresAt !== null && waiver.expiresAt <= generatedAt) {
    return { waiverId: waiver.id, approved: false };
  }

  return { waiverId: waiver.id, approved: true };
}

function collectEvidence(
  bucket: Map<QAGateKindLikeV0, string[]>,
  kind: QAGateKindLikeV0,
  refs: readonly string[],
): void {
  bucket.set(kind, unique([...(bucket.get(kind) ?? []), ...refs]));
}

export function evaluateReleaseReadiness(input: EvaluateReleaseReadinessInput): ReleaseReadinessReportV0 {
  const waivers = input.waivers ?? [];
  const rubricRefs = (input.evalRubricRefs ?? []).filter((entry) => entry.candidateId === input.candidate.id);
  const rubricSummaries = (input.evalRubricSummaries ?? []).filter((entry) => entry.candidateId === input.candidate.id);

  const evidenceByKind = new Map<QAGateKindLikeV0, string[]>();
  const blockedReasons: string[] = [];
  const waiverIds = new Set<string>();

  const gateResults: ReleaseGateResultV0[] = input.qaGates.map((gate) => {
    const gateBlockedReasons: string[] = [];
    let effectiveOutcome = gate.observedOutcome;
    let waivedBy: string | null = null;

    const missingObservedEvidence = gate.observedEvidenceRefs.length === 0;
    if (missingObservedEvidence) {
      gateBlockedReasons.push("missing_observed_evidence");
      if (gate.observedOutcome === "pass") {
        effectiveOutcome = "pending";
      }
    }

    const missingExpectedEvidence = gate.expectedEvidenceRefs.filter((ref) => !gate.observedEvidenceRefs.includes(ref));
    if (missingExpectedEvidence.length > 0) {
      gateBlockedReasons.push(...missingExpectedEvidence.map((ref) => `missing_expected_evidence:${ref}`));
      if (gate.observedOutcome === "pass") {
        effectiveOutcome = "pending";
      }
    }

    collectEvidence(evidenceByKind, gate.gateKind, gate.observedEvidenceRefs);

    if (gate.gateKind === "eval") {
      const rubricRef = gate.evalRubricRefId === null
        ? null
        : rubricRefs.find((entry) => entry.id === gate.evalRubricRefId && entry.gateId === gate.id);
      const summariesForGate = rubricSummaries.filter((entry) => entry.gateId === gate.id && entry.rubricRefId === gate.evalRubricRefId);

      if (gate.evalRubricRefId === null || rubricRef == null) {
        gateBlockedReasons.push("missing_eval_rubric_ref");
      }

      if (gate.observedOutcome !== "pending") {
        if (summariesForGate.length === 0) {
          gateBlockedReasons.push("missing_eval_summary");
        }

        const summaryEvidence = unique(summariesForGate.flatMap((entry) => entry.evidenceRefs));
        if (summaryEvidence.length === 0) {
          gateBlockedReasons.push("missing_eval_evidence");
        }

        if (gate.observedOutcome === "pass" && !summariesForGate.some((entry) => entry.outcome === "pass")) {
          gateBlockedReasons.push("eval_summary_outcome_mismatch");
        }

        collectEvidence(evidenceByKind, gate.gateKind, summaryEvidence);
      }
    }

    if (gate.observedOutcome === "pass" && gateBlockedReasons.length > 0) {
      effectiveOutcome = "pending";
    }

    if (gate.observedOutcome === "fail" && gate.mandatory) {
      const approvedWaiver = waivers
        .map((waiver) => isWaiverApprovedForGate(waiver, input.candidate.id, gate.id, input.generatedAt))
        .find((resolution) => resolution.approved);

      if (approvedWaiver) {
        effectiveOutcome = "waived";
        waivedBy = approvedWaiver.waiverId;
        waiverIds.add(approvedWaiver.waiverId);
      }
    }

    if (gate.mandatory && (effectiveOutcome === "fail" || effectiveOutcome === "pending")) {
      blockedReasons.push(
        ...unique(gateBlockedReasons.length === 0
          ? [`gate:${gate.id}:${effectiveOutcome}`]
          : gateBlockedReasons.map((reason) => `gate:${gate.id}:${reason}`)),
      );
    }

    if (gate.mandatory && gate.observedOutcome === "fail" && waivedBy === null) {
      blockedReasons.push(`gate:${gate.id}:failed`);
    }

    return {
      gateId: gate.id,
      gateKind: gate.gateKind,
      label: gate.label,
      mandatory: gate.mandatory,
      observedOutcome: gate.observedOutcome,
      effectiveOutcome,
      waivedBy,
      expectedEvidenceRefs: gate.expectedEvidenceRefs,
      observedEvidenceRefs: gate.observedEvidenceRefs,
      evalRubricRefId: gate.evalRubricRefId,
      blockedReasons: unique(gateBlockedReasons),
    };
  });

  if (input.candidate.status === "blocked") {
    blockedReasons.push("candidate:blocked");
  }

  if (input.candidate.status === "draft") {
    blockedReasons.push("candidate:draft");
  }

  const hasFailedMandatoryGate = gateResults.some((gate) => gate.mandatory && gate.effectiveOutcome === "fail");
  const hasPendingMandatoryGate = gateResults.some((gate) => gate.mandatory && gate.effectiveOutcome === "pending");

  const status = hasFailedMandatoryGate || input.candidate.status === "blocked"
    ? "blocked"
    : hasPendingMandatoryGate || input.candidate.status === "draft"
      ? "pending"
      : "ready";

  return toReleaseReadinessReportV0({
    schema: "pluto.release.readiness-report",
    schemaVersion: 0,
    id: input.reportId,
    candidateId: input.candidate.id,
    workspaceId: input.candidate.workspaceId,
    documentId: input.candidate.documentId,
    versionId: input.candidate.versionId,
    packageId: input.candidate.packageId,
    status,
    blockedReasons: unique(blockedReasons),
    generatedAt: input.generatedAt,
    gateResults,
    waiverIds: [...waiverIds],
    testEvidenceRefs: evidenceByKind.get("test") ?? [],
    evalEvidenceRefs: evidenceByKind.get("eval") ?? [],
    manualCheckEvidenceRefs: evidenceByKind.get("manual_check") ?? [],
    artifactCheckEvidenceRefs: evidenceByKind.get("artifact_check") ?? [],
    evalRubricRefs: rubricRefs,
    evalRubricSummaries: rubricSummaries,
  });
}
