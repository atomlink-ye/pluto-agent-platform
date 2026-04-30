import type {
  ApprovalRecordV0,
  DocumentRecordV0,
  EvidencePacketRefV0,
  GovernanceStatusLikeV0,
  GovernanceStatusV0,
  PublishPackageRecordV0,
  ReviewRecordV0,
  RunRefV0,
  VersionProvenanceRefsV0,
  VersionRecordV0,
} from "../contracts/governance.js";

export type ActionStateReasonV0 =
  | "permission"
  | "evidence_missing"
  | "approval_missing"
  | "connector_unavailable"
  | "runtime_unavailable"
  | "budget_blocked"
  | "policy_blocked"
  | (string & {});

export interface ActionStateV0 {
  enabled: boolean;
  state: "ready" | "disabled" | "degraded";
  reason: ActionStateReasonV0 | null;
}

export type PageStateV0 = "ready" | "empty" | "blocked" | "degraded" | "not_found" | "error";

export type ProjectedGovernanceRecordV0<T extends { status: GovernanceStatusLikeV0 }> = T & {
  governanceStatus: GovernanceStatusV0;
};

export interface DocumentSummaryV0 {
  schemaVersion: 0;
  documentId: string;
  title: string;
  ownerId: string;
  documentStatus: GovernanceStatusLikeV0;
  governanceStatus: GovernanceStatusV0;
  currentVersion: {
    id: string;
    label: string;
    status: GovernanceStatusLikeV0;
    governanceStatus: GovernanceStatusV0;
  } | null;
  counts: {
    reviews: number;
    approvals: number;
    publishPackages: number;
  };
}

export interface DocumentDetailProjectionV0 {
  schemaVersion: 0;
  pageState: PageStateV0;
  governanceStatus: GovernanceStatusV0;
  document: ProjectedGovernanceRecordV0<DocumentRecordV0>;
  currentVersion: (ProjectedGovernanceRecordV0<VersionRecordV0> & VersionProvenanceRefsV0) | null;
  reviews: Array<ProjectedGovernanceRecordV0<ReviewRecordV0>>;
  approvals: Array<ProjectedGovernanceRecordV0<ApprovalRecordV0>>;
  publishPackages: Array<ProjectedGovernanceRecordV0<PublishPackageRecordV0> & VersionProvenanceRefsV0>;
  evidence: EvidencePacketRefV0[];
  recentRuns: RunRefV0[];
}

export interface BuildDocumentSummaryInput {
  document: DocumentRecordV0;
  currentVersion?: VersionRecordV0 | null;
  reviews?: ReviewRecordV0[];
  approvals?: ApprovalRecordV0[];
  publishPackages?: PublishPackageRecordV0[];
}

export interface BuildDocumentDetailProjectionInput {
  document: DocumentRecordV0 | null;
  versions?: VersionRecordV0[];
  reviews?: ReviewRecordV0[];
  approvals?: ApprovalRecordV0[];
  publishPackages?: PublishPackageRecordV0[];
  provenanceByVersionId?: Record<string, VersionProvenanceRefsV0 | undefined>;
  runtimeAvailable?: boolean;
  hasError?: boolean;
}

const BLOCKED_STATUSES = new Set(["blocked", "changes_requested", "rejected", "failed"]);
const ACTIVE_STATUSES = new Set(["active", "in_review", "in_approval", "publishing", "running"]);
const READY_STATUSES = new Set(["ready", "approved", "published", "complete", "completed", "succeeded"]);
const ARCHIVED_STATUSES = new Set(["archived", "superseded"]);

export function buildActionState(input: {
  hasPermission?: boolean;
  hasCurrentVersion?: boolean;
  hasApproval?: boolean;
  hasEvidence?: boolean;
  connectorAvailable?: boolean;
  runtimeAvailable?: boolean;
  budgetBlocked?: boolean;
  policyBlocked?: boolean;
}): ActionStateV0 {
  if (input.hasPermission === false) {
    return { enabled: false, state: "disabled", reason: "permission" };
  }

  if (input.hasCurrentVersion === false || input.hasEvidence === false) {
    return { enabled: false, state: "disabled", reason: "evidence_missing" };
  }

  if (input.hasApproval === false) {
    return { enabled: false, state: "disabled", reason: "approval_missing" };
  }

  if (input.policyBlocked === true) {
    return { enabled: false, state: "disabled", reason: "policy_blocked" };
  }

  if (input.budgetBlocked === true) {
    return { enabled: false, state: "disabled", reason: "budget_blocked" };
  }

  if (input.connectorAvailable === false) {
    return { enabled: false, state: "degraded", reason: "connector_unavailable" };
  }

  if (input.runtimeAvailable === false) {
    return { enabled: false, state: "degraded", reason: "runtime_unavailable" };
  }

  return { enabled: true, state: "ready", reason: null };
}

export function buildPageState(input: {
  hasError?: boolean;
  hasDocument?: boolean;
  hasItems?: boolean;
  runtimeAvailable?: boolean;
  governanceStatus?: GovernanceStatusV0;
}): PageStateV0 {
  if (input.hasError) return "error";
  if (input.hasDocument === false) return "not_found";
  if (input.hasItems === false) return "empty";
  if (input.runtimeAvailable === false) return "degraded";
  if (input.governanceStatus === "blocked") return "blocked";
  return "ready";
}

export function buildDocumentSummary(input: BuildDocumentSummaryInput): DocumentSummaryV0 {
  const linkedReviews = filterLinkedRecords(input.reviews ?? [], input.document.id, input.currentVersion?.id);
  const linkedApprovals = filterLinkedRecords(input.approvals ?? [], input.document.id, input.currentVersion?.id);
  const linkedPackages = filterLinkedRecords(input.publishPackages ?? [], input.document.id, input.currentVersion?.id);
  const governanceStatus = summarizeGovernanceStatus([
    input.document.status,
    input.currentVersion?.status,
    ...linkedReviews.map((review) => review.status),
    ...linkedApprovals.map((approval) => approval.status),
    ...linkedPackages.map((publishPackage) => publishPackage.status),
  ]);

  return {
    schemaVersion: 0,
    documentId: input.document.id,
    title: input.document.title,
    ownerId: input.document.ownerId,
    documentStatus: input.document.status,
    governanceStatus,
    currentVersion: input.currentVersion
      ? {
          id: input.currentVersion.id,
          label: input.currentVersion.label,
          status: input.currentVersion.status,
          governanceStatus: summarizeGovernanceStatus([input.currentVersion.status]),
        }
      : null,
    counts: {
      reviews: linkedReviews.length,
      approvals: linkedApprovals.length,
      publishPackages: linkedPackages.length,
    },
  };
}

export function buildDocumentDetailProjection(
  input: BuildDocumentDetailProjectionInput,
): DocumentDetailProjectionV0 | null {
  if (input.document === null) {
    return null;
  }

  const versions = input.versions ?? [];
  const currentVersion = versions.find((version) => version.id === input.document?.currentVersionId) ?? null;
  const linkedReviews = sortProjectedRecords(
    filterLinkedRecords(input.reviews ?? [], input.document.id, currentVersion?.id),
  );
  const linkedApprovals = sortProjectedRecords(
    filterLinkedRecords(input.approvals ?? [], input.document.id, currentVersion?.id),
  );
  const linkedPackages = sortProjectedRecords(
    filterLinkedRecords(input.publishPackages ?? [], input.document.id, currentVersion?.id),
  );
  const projectedCurrentVersion = currentVersion
    ? projectRecord(currentVersion, input.provenanceByVersionId?.[currentVersion.id])
    : null;
  const projectedPackages = linkedPackages.map((publishPackage) =>
    projectRecord(publishPackage, input.provenanceByVersionId?.[publishPackage.versionId])
  );
  const evidence = collectEvidenceRefs(projectedCurrentVersion, projectedPackages);
  const recentRuns = collectRecentRuns(projectedCurrentVersion, projectedPackages);
  const governanceStatus = summarizeGovernanceStatus([
    input.document.status,
    currentVersion?.status,
    ...linkedReviews.map((review) => review.status),
    ...linkedApprovals.map((approval) => approval.status),
    ...linkedPackages.map((publishPackage) => publishPackage.status),
  ]);

  return {
    schemaVersion: 0,
    pageState: buildPageState({
      hasDocument: true,
      hasItems: true,
      runtimeAvailable: input.runtimeAvailable,
      governanceStatus,
      hasError: input.hasError,
    }),
    governanceStatus,
    document: projectRecord(input.document),
    currentVersion: projectedCurrentVersion,
    reviews: linkedReviews.map((review) => projectRecord(review)),
    approvals: linkedApprovals.map((approval) => projectRecord(approval)),
    publishPackages: projectedPackages,
    evidence,
    recentRuns,
  };
}

function summarizeGovernanceStatus(statuses: Array<GovernanceStatusLikeV0 | null | undefined>): GovernanceStatusV0 {
  const normalized = statuses
    .filter((status): status is GovernanceStatusLikeV0 => typeof status === "string" && status.length > 0)
    .map((status) => status.toLowerCase());

  if (normalized.some((status) => BLOCKED_STATUSES.has(status))) return "blocked";
  if (normalized.some((status) => ACTIVE_STATUSES.has(status))) return "active";
  if (normalized.some((status) => READY_STATUSES.has(status))) return "ready";
  if (normalized.length > 0 && normalized.every((status) => ARCHIVED_STATUSES.has(status))) return "archived";
  return "draft";
}

function projectRecord<T extends { status: GovernanceStatusLikeV0 }>(
  record: T,
  provenance?: VersionProvenanceRefsV0,
): ProjectedGovernanceRecordV0<T> & VersionProvenanceRefsV0 {
  return {
    ...record,
    governanceStatus: summarizeGovernanceStatus([record.status]),
    ...provenance,
  };
}

function filterLinkedRecords<T extends { documentId: string; versionId: string }>(
  records: T[],
  documentId: string,
  versionId?: string,
): T[] {
  return records.filter((record) => record.documentId === documentId && (versionId === undefined || record.versionId === versionId));
}

function sortProjectedRecords<T extends { createdAt: string; id: string }>(records: T[]): T[] {
  return [...records].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.id.localeCompare(right.id);
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function collectEvidenceRefs(
  currentVersion: (VersionProvenanceRefsV0 & { latestEvidence?: EvidencePacketRefV0 }) | null,
  publishPackages: Array<VersionProvenanceRefsV0 & { latestEvidence?: EvidencePacketRefV0 }>,
): EvidencePacketRefV0[] {
  const seen = new Set<string>();
  const collected: EvidencePacketRefV0[] = [];

  for (const ref of [currentVersion?.latestEvidence, ...publishPackages.map((item) => item.latestEvidence)].filter(
    (value): value is EvidencePacketRefV0 => value !== undefined,
  )) {
    const key = `${ref.runId}:${ref.evidencePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    collected.push(ref);
  }

  return collected;
}

function collectRecentRuns(
  currentVersion: (VersionProvenanceRefsV0 & { latestRun?: RunRefV0; supportingRuns?: RunRefV0[] }) | null,
  publishPackages: Array<VersionProvenanceRefsV0 & { latestRun?: RunRefV0; supportingRuns?: RunRefV0[] }>,
): RunRefV0[] {
  const seen = new Set<string>();
  const runs: RunRefV0[] = [];
  const candidates = [
    currentVersion?.latestRun,
    ...(currentVersion?.supportingRuns ?? []),
    ...publishPackages.flatMap((item) => [item.latestRun, ...(item.supportingRuns ?? [])]),
  ].filter((value): value is RunRefV0 => value !== undefined);

  for (const run of candidates) {
    if (seen.has(run.runId)) continue;
    seen.add(run.runId);
    runs.push(run);
  }

  return runs;
}
