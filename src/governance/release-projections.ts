import { GovernanceEventStore } from "../audit/governance-event-store.js";
import type { GovernanceEventRecordV0 } from "../audit/governance-events.js";
import type {
  CitationRefV0,
  ProvenanceEdgeV0,
  SealedEvidenceRefV0,
} from "../contracts/evidence-graph.js";
import type {
  ApprovalRequestV0,
  DecisionRecordV0,
  GovernedTargetRefV0,
  ReviewRequestV0,
} from "../contracts/review.js";
import type {
  ExportAssetRecordV0,
  PublishPackageRecordV0,
  PublishAttemptRecordV0,
  PublishReadinessV0,
  RollbackRetractRecordV0,
} from "../contracts/publish.js";
import type {
  EvalRubricRefV0,
  EvalRubricSummaryV0,
  QAGateRecordV0,
  ReleaseCandidateRecordV0,
  ReleaseReadinessReportV0,
  WaiverRecordV0,
} from "../contracts/release.js";
import type { DocumentRecordV0, VersionRecordV0 } from "../contracts/governance.js";
import { assertEvidenceUsableForGovernance } from "../evidence/seal.js";
import { GovernanceStore } from "./governance-store.js";
import { buildPublishReadiness } from "../publish/readiness.js";
import { PublishStore } from "../publish/publish-store.js";
import { ReleaseStore } from "../release/release-store.js";
import { buildApprovalQueue, buildReviewQueue, type ReviewQueueItemV0 } from "../review/queues.js";
import { ReviewStore } from "../review/review-store.js";
import { EvidenceGraphStore } from "../evidence/evidence-graph.js";

export interface ProjectedVersionRequestV0 {
  id: string;
  kind: "review" | "approval";
  status: string;
  target: GovernedTargetRefV0;
  requiredEvidenceRefs: string[];
  blockedReasons: string[];
}

export interface ProjectedReleaseCandidateStateV0 {
  id: string;
  status: string;
  targetScopeSummary: string;
  readinessReportId: string | null;
  readinessStatus: string | null;
  blockedReasons: string[];
}

export interface VersionDecisionProjectionV0 {
  schemaVersion: 0;
  documentId: string;
  versionId: string;
  versionLabel: string | null;
  versionStatus: string | null;
  reviewRequests: ProjectedVersionRequestV0[];
  approvalRequests: ProjectedVersionRequestV0[];
  decisionHistory: DecisionRecordV0[];
  sealedEvidence: Array<{
    id: string;
    runId: string;
    usableForGovernance: boolean;
    redactionSummary: string;
  }>;
  releaseCandidates: ProjectedReleaseCandidateStateV0[];
  blockedReasons: string[];
}

export interface ProjectedPublishAttemptSummaryV0 {
  id: string;
  status: string;
  idempotencyKey: string;
  channelId: string;
  destinationSummary: string;
  payloadSummary: string;
  blockedReasons: string[];
  createdAt: string;
}

export interface PublishReadinessProjectionV0 {
  schemaVersion: 0;
  publishPackage: PublishPackageRecordV0;
  readiness: PublishReadinessV0;
  exportAssets: ExportAssetRecordV0[];
  publishAttempts: ProjectedPublishAttemptSummaryV0[];
  rollbackHistory: RollbackRetractRecordV0[];
  releaseReadinessReport: ReleaseReadinessReportV0 | null;
  blockedReasons: string[];
  redactedSummaries: {
    channelDestinations: string[];
    exportAssets: string[];
    attempts: string[];
  };
}

export interface BuildVersionDecisionProjectionInput {
  version: VersionRecordV0;
  reviewRequests?: ReviewRequestV0[];
  approvalRequests?: ApprovalRequestV0[];
  decisions?: DecisionRecordV0[];
  sealedEvidenceByRef?: Readonly<Record<string, SealedEvidenceRefV0 | undefined>>;
  releaseCandidates?: ReleaseCandidateRecordV0[];
  readinessReports?: ReleaseReadinessReportV0[];
}

export interface BuildPublishReadinessProjectionInput {
  publishPackage: PublishPackageRecordV0;
  approvals?: readonly string[];
  sealedEvidenceByRef?: Readonly<Record<string, SealedEvidenceRefV0 | undefined>>;
  exportAssets?: readonly ExportAssetRecordV0[];
  publishAttempts?: readonly PublishAttemptRecordV0[];
  rollbackHistory?: readonly RollbackRetractRecordV0[];
  readinessReport?: ReleaseReadinessReportV0 | null;
}

export interface BuildReviewPublishReleaseGraphInput {
  governanceStore: GovernanceStore;
  reviewStore: ReviewStore;
  evidenceGraphStore: EvidenceGraphStore;
  publishStore: PublishStore;
  releaseStore: ReleaseStore;
  auditStore: GovernanceEventStore;
  versionId: string;
  publishPackageId?: string;
  now?: string;
}

export interface ReviewPublishReleaseGraphV0 {
  schemaVersion: 0;
  document: DocumentRecordV0;
  version: VersionRecordV0;
  reviewRequest: ReviewRequestV0 | null;
  approvalRequest: ApprovalRequestV0 | null;
  reviewQueue: ReviewQueueItemV0[];
  approvalQueue: ReviewQueueItemV0[];
  versionProjection: VersionDecisionProjectionV0;
  publishProjection: PublishReadinessProjectionV0 | null;
  publishPackage: PublishPackageRecordV0 | null;
  exportAssets: ExportAssetRecordV0[];
  publishAttempts: PublishAttemptRecordV0[];
  rollbackHistory: RollbackRetractRecordV0[];
  releaseCandidate: ReleaseCandidateRecordV0 | null;
  qaGates: QAGateRecordV0[];
  evalRubricRefs: EvalRubricRefV0[];
  evalRubricSummaries: EvalRubricSummaryV0[];
  waivers: WaiverRecordV0[];
  readinessReport: ReleaseReadinessReportV0 | null;
  sealedEvidence: SealedEvidenceRefV0[];
  citations: CitationRefV0[];
  provenanceEdges: ProvenanceEdgeV0[];
  governanceEvents: GovernanceEventRecordV0[];
  approvedApprovalRefs: string[];
  blockedReasons: string[];
}

export function buildVersionDecisionProjection(
  input: BuildVersionDecisionProjectionInput,
): VersionDecisionProjectionV0 {
  const reviewRequests = (input.reviewRequests ?? [])
    .filter((request) => targetIncludesVersion(request.target, input.version.id))
    .map((request) => ({
      id: request.id,
      kind: "review" as const,
      status: request.status,
      target: request.target,
      requiredEvidenceRefs: request.evidenceRequirements
        .filter((requirement) => requirement.required)
        .map((requirement) => requirement.ref),
      blockedReasons: deriveRequestBlockedReasons(request, input.sealedEvidenceByRef),
    }));
  const approvalRequests = (input.approvalRequests ?? [])
    .filter((request) => targetIncludesVersion(request.target, input.version.id))
    .map((request) => ({
      id: request.id,
      kind: "approval" as const,
      status: request.status,
      target: request.target,
      requiredEvidenceRefs: request.evidenceRequirements
        .filter((requirement) => requirement.required)
        .map((requirement) => requirement.ref),
      blockedReasons: uniqueStrings([
        ...deriveRequestBlockedReasons(request, input.sealedEvidenceByRef),
        ...request.blockedReasons,
      ]),
    }));
  const linkedDecisions = (input.decisions ?? [])
    .filter((decision) => targetIncludesVersion(decision.target, input.version.id))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id));
  const sealedEvidence = collectLinkedSealedEvidence(
    [...reviewRequests, ...approvalRequests].flatMap((request) => request.requiredEvidenceRefs),
    input.sealedEvidenceByRef,
  );
  const readinessByCandidateId = new Map<string, ReleaseReadinessReportV0>();
  for (const report of input.readinessReports ?? []) {
    const current = readinessByCandidateId.get(report.candidateId);
    if (!current || current.generatedAt < report.generatedAt) {
      readinessByCandidateId.set(report.candidateId, report);
    }
  }
  const releaseCandidates = (input.releaseCandidates ?? [])
    .filter((candidate) => candidate.versionId === input.version.id)
    .map((candidate) => {
      const report = readinessByCandidateId.get(candidate.id) ?? null;
      return {
        id: candidate.id,
        status: candidate.status,
        targetScopeSummary: candidate.targetScope.summary,
        readinessReportId: report?.id ?? null,
        readinessStatus: report?.status ?? null,
        blockedReasons: uniqueStrings([
          ...(candidate.status === "blocked" ? ["candidate:blocked"] : []),
          ...(report?.blockedReasons ?? []),
        ]),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    schemaVersion: 0,
    documentId: input.version.documentId,
    versionId: input.version.id,
    versionLabel: input.version.label,
    versionStatus: input.version.status,
    reviewRequests,
    approvalRequests,
    decisionHistory: linkedDecisions,
    sealedEvidence,
    releaseCandidates,
    blockedReasons: uniqueStrings([
      ...reviewRequests.flatMap((request) => request.blockedReasons),
      ...approvalRequests.flatMap((request) => request.blockedReasons),
      ...releaseCandidates.flatMap((candidate) => candidate.blockedReasons),
    ]),
  };
}

export function buildPublishReadinessProjection(
  input: BuildPublishReadinessProjectionInput,
): PublishReadinessProjectionV0 {
  const attempts = (input.publishAttempts ?? []).filter((attempt) => attempt.publishPackageId === input.publishPackage.id);
  const readiness = buildPublishReadiness({
    publishPackage: input.publishPackage,
    approvals: input.approvals,
    sealedEvidence: input.sealedEvidenceByRef,
    publishAttempts: attempts,
  });
  const exportAssets = (input.exportAssets ?? []).filter((asset) => asset.publishPackageId === input.publishPackage.id);
  const rollbackHistory = (input.rollbackHistory ?? [])
    .filter((record) => record.publishPackageId === input.publishPackage.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const publishAttempts = attempts
    .map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      idempotencyKey: attempt.idempotencyKey,
      channelId: attempt.channelTarget.channelId,
      destinationSummary: attempt.channelTarget.destinationSummary,
      payloadSummary: attempt.payloadSummary.summary,
      blockedReasons: attempt.blockedReasons,
      createdAt: attempt.createdAt,
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

  return {
    schemaVersion: 0,
    publishPackage: input.publishPackage,
    readiness,
    exportAssets,
    publishAttempts,
    rollbackHistory,
    releaseReadinessReport: input.readinessReport ?? null,
    blockedReasons: uniqueStrings([
      ...readiness.blockedReasons,
      ...(input.readinessReport?.blockedReasons ?? []),
    ]),
    redactedSummaries: {
      channelDestinations: uniqueStrings(input.publishPackage.channelTargets.map((target) => target.destinationSummary)),
      exportAssets: uniqueStrings(exportAssets.map((asset) => asset.redactionSummary.summary)),
      attempts: uniqueStrings(publishAttempts.map((attempt) => attempt.payloadSummary)),
    },
  };
}

export async function buildReviewPublishReleaseGraph(
  input: BuildReviewPublishReleaseGraphInput,
): Promise<ReviewPublishReleaseGraphV0> {
  const version = await input.governanceStore.get("version", input.versionId);
  if (version === null) {
    throw new Error(`governance version not found: ${input.versionId}`);
  }

  const document = await input.governanceStore.get("document", version.documentId);
  if (document === null) {
    throw new Error(`governance document not found: ${version.documentId}`);
  }

  const [
    reviewRequests,
    approvalRequests,
    decisions,
    slaOverlays,
    sealedEvidence,
    citations,
    provenanceEdges,
    publishPackages,
    exportAssets,
    publishAttempts,
    rollbackHistory,
    releaseCandidates,
    qaGates,
    evalRubricRefs,
    evalRubricSummaries,
    waivers,
    readinessReports,
    governanceEvents,
  ] = await Promise.all([
    input.reviewStore.listReviewRequests(),
    input.reviewStore.listApprovalRequests(),
    input.reviewStore.listDecisions(),
    input.reviewStore.listSlaOverlays(),
    input.evidenceGraphStore.listSealedEvidenceRefs(),
    input.evidenceGraphStore.listCitationRefs(),
    input.evidenceGraphStore.listProvenanceEdges(),
    input.publishStore.listPublishPackages(),
    input.publishStore.listExportAssetRecords(),
    input.publishStore.listPublishAttempts(),
    input.publishStore.listRollbackRetractRecords(),
    input.releaseStore.listReleaseCandidates(),
    input.releaseStore.listQAGates(),
    input.releaseStore.listEvalRubricRefs(),
    input.releaseStore.listEvalRubricSummaries(),
    input.releaseStore.listWaivers(),
    input.releaseStore.listReadinessReports(),
    input.auditStore.list(),
  ]);

  const sealedEvidenceByRef = Object.fromEntries(sealedEvidence.map((record) => [record.id, record]));
  const linkedReviewRequests = reviewRequests.filter((request) => targetIncludesVersion(request.target, version.id));
  const linkedApprovalRequests = approvalRequests.filter((request) => targetIncludesVersion(request.target, version.id));
  const reviewQueue = buildReviewQueue({
    requests: linkedReviewRequests,
    slaOverlays,
    sealedEvidenceByRef,
    now: input.now,
  });
  const approvalQueue = buildApprovalQueue({
    requests: linkedApprovalRequests,
    slaOverlays,
    sealedEvidenceByRef,
    now: input.now,
  });
  const versionProjection = buildVersionDecisionProjection({
    version,
    reviewRequests: linkedReviewRequests,
    approvalRequests: linkedApprovalRequests,
    decisions,
    sealedEvidenceByRef,
    releaseCandidates,
    readinessReports,
  });

  const publishPackage = selectPublishPackage(publishPackages, version.id, input.publishPackageId);
  const approvedApprovalRefs = deriveApprovedApprovalRefs(decisions);
  const releaseCandidate = publishPackage === null
    ? null
    : releaseCandidates.find((candidate) => candidate.packageId === publishPackage.id) ?? null;
  const readinessReport = releaseCandidate === null
    ? null
    : selectLatestReadinessReport(readinessReports, releaseCandidate.id);
  const publishProjection = publishPackage === null
    ? null
    : buildPublishReadinessProjection({
        publishPackage,
        approvals: approvedApprovalRefs,
        sealedEvidenceByRef,
        exportAssets,
        publishAttempts,
        rollbackHistory,
        readinessReport,
      });
  const linkedEvents = governanceEvents.filter((event) =>
    event.target.documentId === document.id
    || event.target.versionId === version.id
    || (publishPackage !== null && event.target.packageId === publishPackage.id)
    || (releaseCandidate !== null && event.target.candidateId === releaseCandidate.id),
  );

  return {
    schemaVersion: 0,
    document,
    version,
    reviewRequest: linkedReviewRequests[0] ?? null,
    approvalRequest: linkedApprovalRequests[0] ?? null,
    reviewQueue,
    approvalQueue,
    versionProjection,
    publishProjection,
    publishPackage,
    exportAssets: publishPackage === null
      ? []
      : exportAssets.filter((asset) => asset.publishPackageId === publishPackage.id),
    publishAttempts: publishPackage === null
      ? []
      : publishAttempts.filter((attempt) => attempt.publishPackageId === publishPackage.id),
    rollbackHistory: publishPackage === null
      ? []
      : rollbackHistory.filter((record) => record.publishPackageId === publishPackage.id),
    releaseCandidate,
    qaGates: releaseCandidate === null ? [] : qaGates.filter((gate) => gate.candidateId === releaseCandidate.id),
    evalRubricRefs: releaseCandidate === null
      ? []
      : evalRubricRefs.filter((record) => record.candidateId === releaseCandidate.id),
    evalRubricSummaries: releaseCandidate === null
      ? []
      : evalRubricSummaries.filter((record) => record.candidateId === releaseCandidate.id),
    waivers: releaseCandidate === null ? [] : waivers.filter((waiver) => waiver.candidateId === releaseCandidate.id),
    readinessReport,
    sealedEvidence: collectLinkedSealedEvidence(
      uniqueStrings([
        ...versionProjection.sealedEvidence.map((record) => record.id),
        ...(publishPackage?.sealedEvidenceRefs ?? []),
        ...(releaseCandidate?.candidateEvidenceRefs ?? []),
      ]),
      sealedEvidenceByRef,
    ).map((record) => sealedEvidenceByRef[record.id]).filter((record): record is SealedEvidenceRefV0 => record !== undefined),
    citations: citations.filter((citation) => citation.sealedEvidenceId in sealedEvidenceByRef),
    provenanceEdges: provenanceEdges.filter((edge) =>
      (publishPackage !== null && edge.to.id === publishPackage.id)
      || edge.from.id in sealedEvidenceByRef,
    ),
    governanceEvents: linkedEvents,
    approvedApprovalRefs,
    blockedReasons: uniqueStrings([
      ...reviewQueue.flatMap((item) => item.blockedReasons),
      ...approvalQueue.flatMap((item) => item.blockedReasons),
      ...versionProjection.blockedReasons,
      ...(publishProjection?.blockedReasons ?? []),
      ...(readinessReport?.blockedReasons ?? []),
    ]),
  };
}

function collectLinkedSealedEvidence(
  refs: readonly string[],
  sealedEvidenceByRef: Readonly<Record<string, SealedEvidenceRefV0 | undefined>> | undefined,
): VersionDecisionProjectionV0["sealedEvidence"] {
  return uniqueStrings(refs)
    .map((ref) => {
      const sealedEvidence = sealedEvidenceByRef?.[ref];
      if (!sealedEvidence) {
        return {
          id: ref,
          runId: "",
          usableForGovernance: false,
          redactionSummary: "",
        };
      }

      return {
        id: sealedEvidence.id,
        runId: sealedEvidence.runId,
        usableForGovernance: isEvidenceUsableForGovernance(sealedEvidence),
        redactionSummary: sealedEvidence.redactionSummary.summary,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function deriveRequestBlockedReasons(
  request: ReviewRequestV0 | ApprovalRequestV0,
  sealedEvidenceByRef: Readonly<Record<string, SealedEvidenceRefV0 | undefined>> | undefined,
): string[] {
  const blockedReasons: string[] = [];
  if (request.diffSnapshot === null) {
    blockedReasons.push("missing_diff");
  }

  for (const requirement of request.evidenceRequirements) {
    if (!requirement.required) {
      continue;
    }

    const sealedEvidence = sealedEvidenceByRef?.[requirement.ref];
    if (!sealedEvidence || !isEvidenceUsableForGovernance(sealedEvidence)) {
      blockedReasons.push("missing_sealed_evidence");
      break;
    }
  }

  return uniqueStrings(blockedReasons);
}

function isEvidenceUsableForGovernance(sealedEvidence: SealedEvidenceRefV0): boolean {
  try {
    assertEvidenceUsableForGovernance(sealedEvidence);
    return true;
  } catch {
    return false;
  }
}

function targetIncludesVersion(target: GovernedTargetRefV0, versionId: string): boolean {
  return "versionId" in target && target.versionId === versionId;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function deriveApprovedApprovalRefs(decisions: readonly DecisionRecordV0[]): string[] {
  const latestByRequestId = new Map<string, DecisionRecordV0>();
  for (const decision of decisions) {
    if (decision.requestKind !== "approval") {
      continue;
    }

    const current = latestByRequestId.get(decision.requestId);
    if (!current || current.recordedAt < decision.recordedAt || (current.recordedAt === decision.recordedAt && current.id < decision.id)) {
      latestByRequestId.set(decision.requestId, decision);
    }
  }

  return [...latestByRequestId.values()]
    .filter((decision) => decision.event === "approved")
    .map((decision) => decision.requestId)
    .sort((left, right) => left.localeCompare(right));
}

function selectPublishPackage(
  packages: readonly PublishPackageRecordV0[],
  versionId: string,
  publishPackageId: string | undefined,
): PublishPackageRecordV0 | null {
  if (publishPackageId !== undefined) {
    return packages.find((record) => record.id === publishPackageId) ?? null;
  }

  return packages.find((record) => record.versionId === versionId) ?? null;
}

function selectLatestReadinessReport(
  reports: readonly ReleaseReadinessReportV0[],
  candidateId: string,
): ReleaseReadinessReportV0 | null {
  return reports
    .filter((report) => report.candidateId === candidateId)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt) || right.id.localeCompare(left.id))[0] ?? null;
}
