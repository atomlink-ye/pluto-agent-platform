import type {
  ApprovalRecordV0,
  DocumentRecordV0,
  PlaybookRecordV0,
  PublishPackageRecordV0 as GovernancePublishPackageRecordV0,
  ReviewRecordV0,
  ScheduleRecordV0,
  ScenarioRecordV0,
  VersionRecordV0,
} from "../contracts/governance.js";
import { GovernanceEventStore } from "../audit/governance-event-store.js";
import type { GovernanceEventRecordV0 } from "../audit/governance-events.js";
import type {
  CitationRefV0,
  ProvenanceEdgeV0,
  SealedEvidenceRefV0,
} from "../contracts/evidence-graph.js";
import { toImmutableEvidencePacketMetadataV0 } from "../contracts/evidence-graph.js";
import type {
  ExportAssetRecordV0,
  PublishAttemptRecordV0,
  PublishPackageRecordV0,
  RollbackRetractRecordV0,
} from "../contracts/publish.js";
import type {
  ApprovalRequestV0,
  DecisionRecordV0,
  ReviewRequestV0,
  SlaOverlayV0,
} from "../contracts/review.js";
import type {
  EvalRubricRefV0,
  EvalRubricSummaryV0,
  QAGateRecordV0,
  ReleaseCandidateRecordV0,
  ReleaseReadinessReportV0,
  WaiverRecordV0,
} from "../contracts/release.js";
import { EvidenceGraphStore } from "../evidence/evidence-graph.js";
import { PublishStore } from "../publish/publish-store.js";
import { ReleaseStore } from "../release/release-store.js";
import { evaluateReleaseReadiness } from "../release/readiness.js";
import { ReviewStore, type AssignmentRecordV0 } from "../review/review-store.js";
import { GovernanceStore } from "./governance-store.js";

export const DEFAULT_GOVERNANCE_SEED_IDS = {
  playbookId: "playbook-default-governance",
  scenarioId: "scenario-default-governance",
  scheduleId: "schedule-default-governance-weekly",
} as const;

export const DEFAULT_GOVERNANCE_SEED_WORKSPACE_ID = "workspace-default-governance";
export const DEFAULT_GOVERNANCE_SEED_OWNER_ID = "owner-default-governance";
export const DEFAULT_GOVERNANCE_SEED_TIMESTAMP = "2026-04-30T00:00:00.000Z";

export interface GovernanceSeedOptions {
  workspaceId?: string;
  ownerId?: string;
}

export interface SeededGovernanceFixturesV0 {
  playbook: PlaybookRecordV0;
  scenario: ScenarioRecordV0;
  schedules: [ScheduleRecordV0];
}

export const REVIEW_PUBLISH_RELEASE_FIXTURE_IDS = {
  documentId: "document-review-publish-release",
  versionId: "version-review-publish-release",
  governanceReviewId: "review-review-publish-release",
  governanceApprovalId: "approval-review-publish-release",
  governancePackageId: "package-review-publish-release",
  reviewRequestId: "review-request-review-publish-release",
  approvalRequestId: "approval-request-review-publish-release",
  reviewDecisionId: "decision-review-review-publish-release",
  approvalDecisionId: "decision-approval-review-publish-release",
  waiverId: "waiver-review-publish-release",
  releaseCandidateId: "candidate-review-publish-release",
  readinessReportId: "report-review-publish-release",
  testGateId: "gate-test-review-publish-release",
  evalGateId: "gate-eval-review-publish-release",
  artifactGateId: "gate-asset-review-publish-release",
  reviewerAssignmentId: "assignment-review-review-publish-release",
  approverAssignmentId: "assignment-approval-review-publish-release",
  reviewSlaId: "sla-review-review-publish-release",
  approvalSlaId: "sla-approval-review-publish-release",
  mainSealedEvidenceId: "sealed-review-publish-release-main",
  testSealedEvidenceId: "sealed-review-publish-release-test",
  evalSealedEvidenceId: "sealed-review-publish-release-eval",
  artifactSealedEvidenceId: "sealed-review-publish-release-asset",
  waiverApprovalEvidenceId: "sealed-review-publish-release-waiver-approval",
  waiverDecisionEvidenceId: "sealed-review-publish-release-waiver-decision",
  mainCitationId: "citation-review-publish-release-main",
  publishEdgeId: "edge-review-publish-release-package",
  publishPackageId: "package-review-publish-release",
  exportAssetId: "asset-review-publish-release",
  publishAttemptId: "attempt-review-publish-release",
  evalRubricRefId: "rubric-ref-review-publish-release",
  evalRubricSummaryId: "rubric-summary-review-publish-release",
} as const;

const REVIEW_PUBLISH_RELEASE_TIMESTAMPS = {
  documentCreatedAt: "2026-04-30T00:10:00.000Z",
  versionCreatedAt: "2026-04-30T00:11:00.000Z",
  requestCreatedAt: "2026-04-30T00:12:00.000Z",
  reviewDecisionAt: "2026-04-30T00:13:00.000Z",
  approvalDecisionAt: "2026-04-30T00:14:00.000Z",
  evidenceGeneratedAt: "2026-04-30T00:15:00.000Z",
  evidenceSealedAt: "2026-04-30T00:16:00.000Z",
  packageCreatedAt: "2026-04-30T00:17:00.000Z",
  candidateCreatedAt: "2026-04-30T00:18:00.000Z",
  gateCheckedAt: "2026-04-30T00:19:00.000Z",
  waiverCreatedAt: "2026-04-30T00:20:00.000Z",
  readinessGeneratedAt: "2026-04-30T00:21:00.000Z",
  attemptCreatedAt: "2026-04-30T00:22:00.000Z",
} as const;

export const REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS = REVIEW_PUBLISH_RELEASE_TIMESTAMPS;

export type ReviewPublishReleaseFixtureScenarioV0 =
  | "successful"
  | "blocked"
  | "waived"
  | "unsealed-evidence"
  | "degraded-dependency";

export interface ReviewPublishReleaseSeedStores {
  governance: GovernanceStore;
  review: ReviewStore;
  evidenceGraph: EvidenceGraphStore;
  publish: PublishStore;
  release: ReleaseStore;
  audit: GovernanceEventStore;
}

export interface ReviewPublishReleaseSeedOptions extends GovernanceSeedOptions {
  scenario?: ReviewPublishReleaseFixtureScenarioV0;
}

export interface SeededReviewPublishReleaseFixturesV0 {
  scenario: ReviewPublishReleaseFixtureScenarioV0;
  governance: SeededGovernanceFixturesV0 & {
    document: DocumentRecordV0;
    version: VersionRecordV0;
    review: ReviewRecordV0;
    approval: ApprovalRecordV0;
    publishPackage: GovernancePublishPackageRecordV0;
  };
  reviewRequest: ReviewRequestV0;
  approvalRequest: ApprovalRequestV0;
  decisions: DecisionRecordV0[];
  assignments: AssignmentRecordV0[];
  slaOverlays: SlaOverlayV0[];
  sealedEvidence: SealedEvidenceRefV0[];
  citations: CitationRefV0[];
  provenanceEdges: ProvenanceEdgeV0[];
  publishPackage: PublishPackageRecordV0;
  exportAssets: ExportAssetRecordV0[];
  publishAttempts: PublishAttemptRecordV0[];
  rollbackHistory: RollbackRetractRecordV0[];
  releaseCandidate: ReleaseCandidateRecordV0;
  qaGates: QAGateRecordV0[];
  evalRubricRefs: EvalRubricRefV0[];
  evalRubricSummaries: EvalRubricSummaryV0[];
  waivers: WaiverRecordV0[];
  readinessReport: ReleaseReadinessReportV0;
  governanceEvents: GovernanceEventRecordV0[];
}

export function createDefaultGovernanceFixtures(
  opts: GovernanceSeedOptions = {},
): SeededGovernanceFixturesV0 {
  const workspaceId = opts.workspaceId ?? DEFAULT_GOVERNANCE_SEED_WORKSPACE_ID;
  const ownerId = opts.ownerId ?? DEFAULT_GOVERNANCE_SEED_OWNER_ID;

  const playbook: PlaybookRecordV0 = {
    schemaVersion: 0,
    kind: "playbook",
    id: DEFAULT_GOVERNANCE_SEED_IDS.playbookId,
    workspaceId,
    title: "Default governance playbook",
    ownerId,
    createdAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    updatedAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    status: "active",
  };

  const scenario: ScenarioRecordV0 = {
    schemaVersion: 0,
    kind: "scenario",
    id: DEFAULT_GOVERNANCE_SEED_IDS.scenarioId,
    workspaceId,
    playbookId: playbook.id,
    title: "Default governance scenario",
    ownerId,
    createdAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    updatedAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    status: "ready",
  };

  const schedule: ScheduleRecordV0 = {
    schemaVersion: 0,
    kind: "schedule",
    id: DEFAULT_GOVERNANCE_SEED_IDS.scheduleId,
    workspaceId,
    playbookId: playbook.id,
    scenarioId: scenario.id,
    ownerId,
    cadence: "0 9 * * 1",
    createdAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    updatedAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    status: "active",
  };

  return {
    playbook,
    scenario,
    schedules: [schedule],
  };
}

export async function seedDefaultGovernanceFixtures(
  store: GovernanceStore,
  opts: GovernanceSeedOptions = {},
): Promise<SeededGovernanceFixturesV0> {
  const fixtures = createDefaultGovernanceFixtures(opts);

  await store.put("playbook", fixtures.playbook);
  await store.put("scenario", fixtures.scenario);

  for (const schedule of fixtures.schedules) {
    await store.put("schedule", schedule);
  }

  return fixtures;
}

export async function seedReviewPublishReleaseFixtures(
  stores: ReviewPublishReleaseSeedStores,
  opts: ReviewPublishReleaseSeedOptions = {},
): Promise<SeededReviewPublishReleaseFixturesV0> {
  const scenario = opts.scenario ?? "successful";
  const workspaceId = opts.workspaceId ?? DEFAULT_GOVERNANCE_SEED_WORKSPACE_ID;
  const ownerId = opts.ownerId ?? DEFAULT_GOVERNANCE_SEED_OWNER_ID;
  const reviewerId = "reviewer-default-governance";
  const approverId = "approver-default-governance";
  const publisherId = "publisher-default-governance";

  const defaultFixtures = await seedDefaultGovernanceFixtures(stores.governance, { workspaceId, ownerId });
  const schedule = defaultFixtures.schedules[0];

  const document: DocumentRecordV0 = {
    schemaVersion: 0,
    kind: "document",
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.documentId,
    workspaceId,
    title: "Review publish release fixture document",
    ownerId,
    currentVersionId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.versionId,
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.documentCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.readinessGeneratedAt,
    status: "active",
  };
  const version: VersionRecordV0 = {
    schemaVersion: 0,
    kind: "version",
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.versionId,
    workspaceId,
    documentId: document.id,
    createdById: ownerId,
    label: "v1.0.0-fixture",
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.versionCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.readinessGeneratedAt,
    status: "ready",
  };
  const governanceReview: ReviewRecordV0 = {
    schemaVersion: 0,
    kind: "review",
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.governanceReviewId,
    workspaceId,
    documentId: document.id,
    versionId: version.id,
    requestedById: ownerId,
    reviewerId,
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.reviewDecisionAt,
    status: "ready",
  };
  const governanceApproval: ApprovalRecordV0 = {
    schemaVersion: 0,
    kind: "approval",
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.governanceApprovalId,
    workspaceId,
    documentId: document.id,
    versionId: version.id,
    requestedById: ownerId,
    approverId,
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.approvalDecisionAt,
    status: "ready",
  };
  const governancePublishPackage: GovernancePublishPackageRecordV0 = {
    schemaVersion: 0,
    kind: "publish_package",
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.governancePackageId,
    workspaceId,
    documentId: document.id,
    versionId: version.id,
    ownerId,
    targetId: schedule.id,
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.packageCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.packageCreatedAt,
    status: "ready",
  };

  await stores.governance.put("document", document);
  await stores.governance.put("version", version);
  await stores.governance.put("review", governanceReview);
  await stores.governance.put("approval", governanceApproval);
  await stores.governance.put("publish_package", governancePublishPackage);

  const reviewRequest: ReviewRequestV0 = {
    schema: "pluto.review.request",
    schemaVersion: 0,
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.reviewRequestId,
    workspaceId,
    target: { kind: "version", documentId: document.id, versionId: version.id },
    requestedById: ownerId,
    assigneeIds: [reviewerId],
    status: "succeeded",
    evidenceRequirements: [{ ref: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId, required: true }],
    diffSnapshot: {
      diffId: "diff-review-publish-release",
      path: "fixtures/review-publish-release.diff",
      checksum: "sha256:diff-review-publish-release",
      summary: "Deterministic release candidate diff",
    },
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.reviewDecisionAt,
    requestedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
    metadata: {
      dueAt: "2026-04-30T01:00:00.000Z",
      fixtureScenario: scenario,
    },
  };
  const approvalRequest: ApprovalRequestV0 = {
    schema: "pluto.review.approval-request",
    schemaVersion: 0,
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.approvalRequestId,
    workspaceId,
    target: { kind: "version", documentId: document.id, versionId: version.id },
    requestedById: ownerId,
    assigneeIds: [approverId],
    status: "succeeded",
    evidenceRequirements: [{ ref: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId, required: true }],
    diffSnapshot: reviewRequest.diffSnapshot,
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.approvalDecisionAt,
    requestedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
    approvalPolicy: {
      policyId: "policy-review-publish-release",
      summary: "Single release approver required",
      mode: "all_of",
    },
    requiredApproverRoles: [{ roleLabel: "release-approver", minApprovers: 1 }],
    decisionSummary: {
      latestDecisionId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.approvalDecisionId,
      latestEvent: "approved",
      decidedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.approvalDecisionAt,
      summary: "Fixture approval recorded",
    },
    blockedReasons: [],
    metadata: {
      dueAt: "2026-04-30T01:15:00.000Z",
      fixtureScenario: scenario,
    },
  };
  const decisions: DecisionRecordV0[] = [
    {
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.reviewDecisionId,
      requestId: reviewRequest.id,
      requestKind: "review",
      target: reviewRequest.target,
      event: "approved",
      actorId: reviewerId,
      comment: "Ready for governed publish fixture path.",
      delegatedToId: null,
      recordedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.reviewDecisionAt,
    },
    {
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.approvalDecisionId,
      requestId: approvalRequest.id,
      requestKind: "approval",
      target: approvalRequest.target,
      event: "approved",
      actorId: approverId,
      comment: "Approved for deterministic release fixture path.",
      delegatedToId: null,
      recordedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.approvalDecisionAt,
    },
  ];
  const assignments: AssignmentRecordV0[] = [
    {
      schema: "pluto.review.assignment",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.reviewerAssignmentId,
      requestId: reviewRequest.id,
      requestKind: "review",
      actorId: reviewerId,
      roleLabel: "reviewer",
      assignedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
      revokedAt: null,
      revokedById: null,
    },
    {
      schema: "pluto.review.assignment",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.approverAssignmentId,
      requestId: approvalRequest.id,
      requestKind: "approval",
      actorId: approverId,
      roleLabel: "release-approver",
      assignedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
      revokedAt: null,
      revokedById: null,
    },
  ];
  const slaOverlays: SlaOverlayV0[] = [
    {
      schema: "pluto.review.sla-overlay",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.reviewSlaId,
      requestId: reviewRequest.id,
      requestKind: "review",
      dueAt: "2026-04-30T01:00:00.000Z",
      overdue: false,
      blocked: scenario === "degraded-dependency",
      degraded: scenario === "degraded-dependency",
      blockedReasons: scenario === "degraded-dependency" ? ["degraded_dependency"] : [],
      computedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.readinessGeneratedAt,
    },
    {
      schema: "pluto.review.sla-overlay",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.approvalSlaId,
      requestId: approvalRequest.id,
      requestKind: "approval",
      dueAt: "2026-04-30T01:15:00.000Z",
      overdue: false,
      blocked: scenario === "degraded-dependency",
      degraded: scenario === "degraded-dependency",
      blockedReasons: scenario === "degraded-dependency" ? ["degraded_dependency"] : [],
      computedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.readinessGeneratedAt,
    },
  ];

  const sealedEvidence = [
    buildSealedEvidence({
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId,
      runId: "run-review-publish-release-main",
      evidencePath: ".pluto/runs/run-review-publish-release-main/evidence.json",
      summary: "Primary governed evidence packet",
      sealedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceSealedAt,
      redactedAt: scenario === "unsealed-evidence" ? null : REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
    }),
    buildSealedEvidence({
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.testSealedEvidenceId,
      runId: "run-review-publish-release-test",
      evidencePath: ".pluto/runs/run-review-publish-release-test/evidence.json",
      summary: "Deterministic unit test evidence",
      sealedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceSealedAt,
      redactedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
    }),
    buildSealedEvidence({
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalSealedEvidenceId,
      runId: "run-review-publish-release-eval",
      evidencePath: ".pluto/runs/run-review-publish-release-eval/evidence.json",
      summary: "Deterministic eval evidence",
      sealedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceSealedAt,
      redactedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
    }),
    buildSealedEvidence({
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.artifactSealedEvidenceId,
      runId: "run-review-publish-release-asset",
      evidencePath: ".pluto/runs/run-review-publish-release-asset/evidence.json",
      summary: "Deterministic artifact evidence",
      sealedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceSealedAt,
      redactedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
    }),
    buildSealedEvidence({
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.waiverApprovalEvidenceId,
      runId: "run-review-publish-release-waiver-approval",
      evidencePath: ".pluto/runs/run-review-publish-release-waiver-approval/evidence.json",
      summary: "Deterministic waiver approval evidence",
      sealedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceSealedAt,
      redactedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
    }),
    buildSealedEvidence({
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.waiverDecisionEvidenceId,
      runId: "run-review-publish-release-waiver-decision",
      evidencePath: ".pluto/runs/run-review-publish-release-waiver-decision/evidence.json",
      summary: "Deterministic waiver decision evidence",
      sealedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceSealedAt,
      redactedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
    }),
  ];
  const citations: CitationRefV0[] = [{
    schemaVersion: 0,
    kind: "citation",
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainCitationId,
    citationKind: "generated_artifact",
    sealedEvidenceId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId,
    locator: "artifact://release-packet/summary.md",
    summary: "Generated release packet summary",
  }];
  const provenanceEdges: ProvenanceEdgeV0[] = [{
    schemaVersion: 0,
    kind: "provenance_edge",
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishEdgeId,
    edgeKind: "generated_artifact",
    from: { kind: "sealed_evidence", id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId },
    to: { kind: "publish_package", id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId },
    summary: "Primary evidence produced the publish package",
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.packageCreatedAt,
  }];

  const releaseCandidate: ReleaseCandidateRecordV0 = {
    schema: "pluto.release.candidate",
    schemaVersion: 0,
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.releaseCandidateId,
    workspaceId,
    documentId: document.id,
    versionId: version.id,
    packageId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
    targetScope: {
      targetKind: "channel",
      targetId: schedule.id,
      summary: "Governed docs site release",
    },
    candidateEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId],
    createdById: publisherId,
    status: "candidate",
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.candidateCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.readinessGeneratedAt,
  };
  const evalRubricRef: EvalRubricRefV0 = {
    schema: "pluto.release.eval-rubric-ref",
    schemaVersion: 0,
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalRubricRefId,
    candidateId: releaseCandidate.id,
    gateId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalGateId,
    rubricId: "release-quality",
    rubricVersion: "2026-04-30",
    expectedPassCondition: "release quality rubric passes",
    summaryRef: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainCitationId,
  };
  const evalRubricSummary: EvalRubricSummaryV0 = {
    schema: "pluto.release.eval-rubric-summary",
    schemaVersion: 0,
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalRubricSummaryId,
    rubricRefId: evalRubricRef.id,
    candidateId: releaseCandidate.id,
    gateId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalGateId,
    outcome: "pass",
    summaryRef: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainCitationId,
    evidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalSealedEvidenceId],
    evaluatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.gateCheckedAt,
  };
  const qaGates: QAGateRecordV0[] = [
    {
      schema: "pluto.release.qa-gate",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.testGateId,
      candidateId: releaseCandidate.id,
      gateKind: "test",
      label: "Deterministic test gate",
      mandatory: true,
      expectedEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.testSealedEvidenceId],
      observedEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.testSealedEvidenceId],
      observedOutcome: scenario === "blocked" || scenario === "waived" ? "fail" : "pass",
      failureSummary: scenario === "blocked" || scenario === "waived"
        ? "Fixture gate intentionally failed"
        : null,
      evalRubricRefId: null,
      checkedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.gateCheckedAt,
    },
    {
      schema: "pluto.release.qa-gate",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalGateId,
      candidateId: releaseCandidate.id,
      gateKind: "eval",
      label: "Deterministic eval gate",
      mandatory: true,
      expectedEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalSealedEvidenceId],
      observedEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalSealedEvidenceId],
      observedOutcome: "pass",
      failureSummary: null,
      evalRubricRefId: evalRubricRef.id,
      checkedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.gateCheckedAt,
    },
    {
      schema: "pluto.release.qa-gate",
      schemaVersion: 0,
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.artifactGateId,
      candidateId: releaseCandidate.id,
      gateKind: "artifact_check",
      label: "Deterministic artifact gate",
      mandatory: true,
      expectedEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.artifactSealedEvidenceId],
      observedEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.artifactSealedEvidenceId],
      observedOutcome: "pass",
      failureSummary: null,
      evalRubricRefId: null,
      checkedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.gateCheckedAt,
    },
  ];
  const waivers: WaiverRecordV0[] = scenario === "waived"
    ? [{
        schema: "pluto.release.waiver",
        schemaVersion: 0,
        id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.waiverId,
        candidateId: releaseCandidate.id,
        approverId,
        justification: "Approved exception for deterministic fixture coverage.",
        scope: {
          candidateId: releaseCandidate.id,
          gateIds: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.testGateId],
        },
        approvalEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.waiverApprovalEvidenceId],
        decisionEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.waiverDecisionEvidenceId],
        status: "approved",
        expiresAt: null,
        createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.waiverCreatedAt,
        updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.waiverCreatedAt,
      }]
    : [];
  const readinessReport = evaluateReleaseReadiness({
    reportId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.readinessReportId,
    candidate: releaseCandidate,
    qaGates,
    waivers,
    evalRubricRefs: [evalRubricRef],
    evalRubricSummaries: [evalRubricSummary],
    generatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.readinessGeneratedAt,
  });

  const publishPackage: PublishPackageRecordV0 = {
    schema: "pluto.publish.package",
    schemaVersion: 0,
    kind: "publish_package",
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId,
    workspaceId,
    documentId: document.id,
    versionId: version.id,
    ownerId,
    targetId: schedule.id,
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.packageCreatedAt,
    updatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.packageCreatedAt,
    status: readinessReport.status === "ready" ? "ready" : "blocked",
    sourceVersionRefs: [{ documentId: document.id, versionId: version.id, label: version.label }],
    approvalRefs: [approvalRequest.id],
    sealedEvidenceRefs: [REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId],
    releaseReadinessRefs: [{
      id: readinessReport.id,
      status: readinessReport.status,
      summary: readinessReport.status === "ready"
        ? "All mandatory gates satisfied"
        : "Mandatory release gate remains blocked",
      checkedAt: readinessReport.generatedAt,
    }],
    channelTargets: [{
      schemaVersion: 0,
      channelId: schedule.id,
      targetId: schedule.id,
      targetKind: "docs_site",
      destinationSummary: "Docs site release target [REDACTED:destination]",
      readinessRef: readinessReport.id,
      approvalRef: approvalRequest.id,
      blockedNotes: readinessReport.status === "ready" ? [] : ["release readiness is not ready"],
      degradedNotes: scenario === "degraded-dependency" ? ["dependency degraded"] : [],
      status: readinessReport.status === "ready" ? "ready" : "blocked",
    }],
    publishReadyBlockedReasons: [],
  };
  const exportAssets: ExportAssetRecordV0[] = [{
    schema: "pluto.publish.export-asset",
    schemaVersion: 0,
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.exportAssetId,
    publishPackageId: publishPackage.id,
    workspaceId,
    channelTarget: publishPackage.channelTargets[0]!,
    checksum: "sha256:asset-review-publish-release",
    contentType: "application/json",
    sourceVersionRefs: publishPackage.sourceVersionRefs,
    sealedEvidenceRefs: publishPackage.sealedEvidenceRefs,
    redactionSummary: {
      redactedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
      fieldsRedacted: 1,
      summary: "Redacted destination metadata before export.",
    },
    assetSummary: "Deterministic publish asset bundle",
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.packageCreatedAt,
  }];
  const publishAttempts: PublishAttemptRecordV0[] = [{
    schema: "pluto.publish.attempt",
    schemaVersion: 0,
    id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishAttemptId,
    publishPackageId: publishPackage.id,
    exportAssetId: exportAssets[0]!.id,
    channelTarget: publishPackage.channelTargets[0]!,
    idempotencyKey: "idem-review-publish-release",
    publisher: {
      principalId: publisherId,
      roleLabels: ["release-manager"],
    },
    providerResultRefs: {
      externalRef: null,
      receiptPath: null,
      summary: "Local dry-run summary only",
    },
    payloadSummary: {
      summary: "Credential-redacted deterministic publish payload",
      redactedFields: ["authorization"],
      detailKeys: ["channelId", "targetId"],
    },
    status: "queued",
    blockedReasons: [],
    createdAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.attemptCreatedAt,
  }];
  const rollbackHistory: RollbackRetractRecordV0[] = [];

  await stores.review.putReviewRequest(reviewRequest);
  await stores.review.putApprovalRequest(approvalRequest);
  for (const decision of decisions) {
    await stores.review.putDecision(decision);
  }
  for (const assignment of assignments) {
    await stores.review.putAssignment(assignment);
  }
  for (const overlay of slaOverlays) {
    await stores.review.putSlaOverlay(overlay);
  }
  for (const evidence of sealedEvidence) {
    await stores.evidenceGraph.putSealedEvidenceRef({
      ...evidence,
      sourceRun: { ...evidence.sourceRun },
      validationSummary: { ...evidence.validationSummary },
      redactionSummary: { ...evidence.redactionSummary },
      immutablePacket: {
        ...evidence.immutablePacket,
        validation: { ...evidence.immutablePacket.validation },
      },
    });
  }
  for (const citation of citations) {
    await stores.evidenceGraph.putCitationRef(citation);
  }
  for (const edge of provenanceEdges) {
    await stores.evidenceGraph.putProvenanceEdge({
      ...edge,
      from: { ...edge.from },
      to: { ...edge.to },
    });
  }
  await stores.release.putReleaseCandidate({ ...releaseCandidate, targetScope: { ...releaseCandidate.targetScope } });
  for (const gate of qaGates) {
    await stores.release.putQAGate({ ...gate });
  }
  await stores.release.putEvalRubricRef({ ...evalRubricRef });
  await stores.release.putEvalRubricSummary({ ...evalRubricSummary });
  for (const waiver of waivers) {
    await stores.release.putWaiver({
      ...waiver,
      scope: { ...waiver.scope, gateIds: [...waiver.scope.gateIds] },
    });
  }
  await stores.publish.putPublishPackage(publishPackage);
  for (const asset of exportAssets) {
    await stores.publish.putExportAssetRecord(asset);
  }
  await stores.release.putReadinessReport({
    ...readinessReport,
    gateResults: readinessReport.gateResults.map((gate) => ({
      ...gate,
      expectedEvidenceRefs: [...gate.expectedEvidenceRefs],
      observedEvidenceRefs: [...gate.observedEvidenceRefs],
      blockedReasons: [...gate.blockedReasons],
    })),
    waiverIds: [...readinessReport.waiverIds],
    testEvidenceRefs: [...readinessReport.testEvidenceRefs],
    evalEvidenceRefs: [...readinessReport.evalEvidenceRefs],
    manualCheckEvidenceRefs: [...readinessReport.manualCheckEvidenceRefs],
    artifactCheckEvidenceRefs: [...readinessReport.artifactCheckEvidenceRefs],
    evalRubricRefs: readinessReport.evalRubricRefs.map((record) => ({ ...record })),
    evalRubricSummaries: readinessReport.evalRubricSummaries.map((record) => ({
      ...record,
      evidenceRefs: [...record.evidenceRefs],
    })),
  });
  for (const attempt of publishAttempts) {
    await stores.publish.recordPublishAttempt(attempt);
  }

  return {
    scenario,
    governance: {
      ...defaultFixtures,
      document,
      version,
      review: governanceReview,
      approval: governanceApproval,
      publishPackage: governancePublishPackage,
    },
    reviewRequest,
    approvalRequest,
    decisions,
    assignments,
    slaOverlays,
    sealedEvidence,
    citations,
    provenanceEdges,
    publishPackage,
    exportAssets,
    publishAttempts,
    rollbackHistory,
    releaseCandidate,
    qaGates,
    evalRubricRefs: [evalRubricRef],
    evalRubricSummaries: [evalRubricSummary],
    waivers,
    readinessReport,
    governanceEvents: await stores.audit.list(),
  };
}

function buildSealedEvidence(input: {
  id: string;
  runId: string;
  evidencePath: string;
  summary: string;
  sealedAt: string;
  redactedAt: string | null;
}): SealedEvidenceRefV0 {
  return {
    schemaVersion: 0,
    kind: "sealed_evidence",
    id: input.id,
    packetId: `${input.id}:packet`,
    runId: input.runId,
    evidencePath: input.evidencePath,
    sealChecksum: `sha256:${input.id}`,
    sealedAt: input.sealedAt,
    sourceRun: {
      runId: input.runId,
      status: "done",
      blockerReason: null,
      finishedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
    },
    validationSummary: {
      outcome: "pass",
      reason: null,
    },
    redactionSummary: {
      redactedAt: input.redactedAt,
      fieldsRedacted: input.redactedAt === null ? 0 : 1,
      summary: input.summary,
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0({
      schemaVersion: 0,
      status: "done",
      blockerReason: null,
      startedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.requestCreatedAt,
      finishedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
      workers: [],
      validation: { outcome: "pass", reason: null },
      classifierVersion: 0,
      generatedAt: REVIEW_PUBLISH_RELEASE_TIMESTAMPS.evidenceGeneratedAt,
    }),
  };
}
