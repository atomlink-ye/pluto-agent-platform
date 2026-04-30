import type {
  ApprovalRequestV0,
  GovernedTargetRefV0,
  ReviewRequestV0,
  SlaOverlayV0,
} from "../contracts/review.js";
import { REVIEW_BLOCKED_REASONS_V0, assertDecisionEligible } from "./guards.js";
import type { AssignmentRecordV0 } from "./review-store.js";
import type { DelegationRecordV0 } from "../contracts/review.js";

export interface QueueActorV0 {
  actorId: string;
  roleLabels: string[];
}

export interface ReviewQueueItemV0 {
  schemaVersion: 0;
  requestId: string;
  requestKind: "review" | "approval";
  target: GovernedTargetRefV0;
  status: string;
  roleLabel: string | null;
  dueAt: string | null;
  overdue: boolean;
  blocked: boolean;
  degraded: boolean;
  blockedReasons: string[];
  viaDelegation: boolean;
}

export interface BuildReviewQueueInput {
  requests: ReviewRequestV0[];
  actor?: QueueActorV0;
  assignments?: AssignmentRecordV0[];
  delegations?: DelegationRecordV0[];
  slaOverlays?: SlaOverlayV0[];
  sealedEvidenceByRef?: Record<string, unknown | null | undefined>;
  degradedRequestIds?: string[];
  now?: string;
}

export interface BuildApprovalQueueInput {
  requests: ApprovalRequestV0[];
  actor?: QueueActorV0;
  assignments?: AssignmentRecordV0[];
  delegations?: DelegationRecordV0[];
  slaOverlays?: SlaOverlayV0[];
  sealedEvidenceByRef?: Record<string, unknown | null | undefined>;
  degradedRequestIds?: string[];
  now?: string;
}

export function buildReviewQueue(input: BuildReviewQueueInput): ReviewQueueItemV0[] {
  return buildQueue("review", input.requests, input);
}

export function buildApprovalQueue(input: BuildApprovalQueueInput): ReviewQueueItemV0[] {
  return buildQueue("approval", input.requests, input);
}

function buildQueue(
  requestKind: "review" | "approval",
  requests: Array<ReviewRequestV0 | ApprovalRequestV0>,
  input: Omit<BuildReviewQueueInput, "requests">,
): ReviewQueueItemV0[] {
  const overlaysByRequestId = new Map((input.slaOverlays ?? []).map((overlay) => [overlay.requestId, overlay]));
  const degradedRequestIds = new Set(input.degradedRequestIds ?? []);

  return requests
    .filter((request) => shouldIncludeRequest(request, requestKind, input.actor, input.assignments ?? [], input.delegations ?? [], input.now))
    .map((request) => {
      const eligibility = input.actor
        ? assertDecisionEligible({
            request,
            actorId: input.actor.actorId,
            actorRoleLabels: input.actor.roleLabels,
            assignments: input.assignments,
            delegations: input.delegations,
            sealedEvidenceByRef: input.sealedEvidenceByRef,
            dependencyDegraded: degradedRequestIds.has(request.id),
            now: input.now,
          })
        : {
            eligible: true,
            blockedReasons: deriveGlobalBlockedReasons(request, input.sealedEvidenceByRef, degradedRequestIds.has(request.id)),
            activeDelegation: null,
            assignment: null,
          };
      const overlay = overlaysByRequestId.get(request.id) ?? deriveSlaOverlay(request, requestKind, input.now, eligibility.blockedReasons);
      const roleLabel = eligibility.assignment?.roleLabel
        ?? eligibility.activeDelegation?.roleLabel
        ?? (requestKind === "approval" && request.schema === "pluto.review.approval-request"
          ? request.requiredApproverRoles[0]?.roleLabel ?? null
          : null);

      return {
        schemaVersion: 0 as const,
        requestId: request.id,
        requestKind,
        target: request.target,
        status: request.status,
        roleLabel,
        dueAt: overlay.dueAt,
        overdue: overlay.overdue,
        blocked: overlay.blocked || !eligibility.eligible,
        degraded: overlay.degraded,
        blockedReasons: uniqueReasons([...overlay.blockedReasons, ...eligibility.blockedReasons]),
        viaDelegation: eligibility.activeDelegation !== null,
      };
    })
    .sort((left, right) => {
      const leftDue = left.dueAt ?? "9999-12-31T23:59:59.999Z";
      const rightDue = right.dueAt ?? "9999-12-31T23:59:59.999Z";
      if (leftDue === rightDue) {
        return left.requestId.localeCompare(right.requestId);
      }

      return leftDue.localeCompare(rightDue);
    });
}

function shouldIncludeRequest(
  request: ReviewRequestV0 | ApprovalRequestV0,
  requestKind: "review" | "approval",
  actor: QueueActorV0 | undefined,
  assignments: AssignmentRecordV0[],
  delegations: DelegationRecordV0[],
  now: string | undefined,
): boolean {
  if (!actor) {
    return true;
  }

  if (request.assigneeIds.includes(actor.actorId)) {
    return true;
  }

  const assignment = assignments.find((entry) =>
    entry.requestId === request.id && entry.requestKind === requestKind && entry.actorId === actor.actorId
  );
  if (assignment !== undefined) {
    return true;
  }

  const eligible = assertDecisionEligible({
    request,
    actorId: actor.actorId,
    actorRoleLabels: actor.roleLabels,
    assignments,
    delegations,
    sealedEvidenceByRef: {},
    now,
  });
  if (eligible.activeDelegation !== null) {
    return true;
  }

  if (requestKind === "approval" && request.schema === "pluto.review.approval-request") {
    return request.requiredApproverRoles.some((role) => actor.roleLabels.includes(role.roleLabel));
  }

  return false;
}

function deriveGlobalBlockedReasons(
  request: ReviewRequestV0 | ApprovalRequestV0,
  sealedEvidenceByRef: Record<string, unknown | null | undefined> | undefined,
  dependencyDegraded: boolean,
): string[] {
  const reasons: string[] = [];

  if (request.diffSnapshot === null) {
    reasons.push(REVIEW_BLOCKED_REASONS_V0.missingDiff);
  }

  if (request.evidenceRequirements.some((requirement) => requirement.required && sealedEvidenceByRef?.[requirement.ref] === undefined)) {
    reasons.push(REVIEW_BLOCKED_REASONS_V0.missingSealedEvidence);
  }

  if (dependencyDegraded) {
    reasons.push(REVIEW_BLOCKED_REASONS_V0.degradedDependency);
  }

  return reasons;
}

function deriveSlaOverlay(
  request: ReviewRequestV0 | ApprovalRequestV0,
  requestKind: "review" | "approval",
  now: string | undefined,
  blockedReasons: string[],
): SlaOverlayV0 {
  const computedAt = now ?? new Date().toISOString();
  const dueAt = typeof request.metadata?.["dueAt"] === "string" ? request.metadata.dueAt : null;
  const overdue = dueAt !== null && dueAt < computedAt;

  return {
    schema: "pluto.review.sla-overlay",
    schemaVersion: 0,
    id: `${request.id}:sla`,
    requestId: request.id,
    requestKind,
    dueAt,
    overdue,
    blocked: blockedReasons.length > 0,
    degraded: blockedReasons.includes(REVIEW_BLOCKED_REASONS_V0.degradedDependency),
    blockedReasons: [...blockedReasons],
    computedAt,
  };
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons)];
}
