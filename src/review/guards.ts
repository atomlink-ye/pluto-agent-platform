import type {
  ApprovalRequestV0,
  DelegationRecordV0,
  GovernedTargetRefV0,
  ReviewRequestV0,
} from "../contracts/review.js";
import { assertEvidenceUsableForGovernance } from "../evidence/seal.js";
import type { AssignmentRecordV0 } from "./review-store.js";

export const REVIEW_BLOCKED_REASONS_V0 = {
  wrongRole: "wrong_role",
  revokedAssignment: "revoked_assignment",
  expiredDelegation: "expired_delegation",
  missingDiff: "missing_diff",
  missingSealedEvidence: "missing_sealed_evidence",
  degradedDependency: "degraded_dependency",
} as const;

export type ReviewBlockedReasonV0 =
  | (typeof REVIEW_BLOCKED_REASONS_V0)[keyof typeof REVIEW_BLOCKED_REASONS_V0]
  | (string & {});

export interface DecisionEligibilityInput {
  request: ReviewRequestV0 | ApprovalRequestV0;
  actorId: string;
  actorRoleLabels?: string[];
  assignments?: AssignmentRecordV0[];
  delegations?: DelegationRecordV0[];
  sealedEvidenceByRef?: Record<string, unknown | null | undefined>;
  dependencyDegraded?: boolean;
  now?: string;
}

export interface DecisionEligibilityResult {
  eligible: boolean;
  blockedReasons: ReviewBlockedReasonV0[];
  activeDelegation: DelegationRecordV0 | null;
  assignment: AssignmentRecordV0 | null;
}

export function assertDecisionEligible(input: DecisionEligibilityInput): DecisionEligibilityResult {
  const blockedReasons = new Set<ReviewBlockedReasonV0>();
  const now = input.now ?? new Date().toISOString();
  const assignment = selectAssignment(input.request, input.actorId, input.assignments ?? []);
  const activeDelegation = selectDelegation(input.request, input.actorId, input.delegations ?? [], now);
  const matchingDelegation = selectScopedDelegation(input.request, input.actorId, input.delegations ?? []);

  if (assignment !== null && assignment.revokedAt !== null) {
    blockedReasons.add(REVIEW_BLOCKED_REASONS_V0.revokedAssignment);
  }

  const hasEligibleDelegation = activeDelegation !== null;
  const hasDirectAssignment = assignment !== null && assignment.revokedAt === null;
  const hasInactiveDelegation = matchingDelegation !== null && activeDelegation === null;

  if (!hasDirectAssignment && !hasEligibleDelegation && !hasInactiveDelegation && !input.request.assigneeIds.includes(input.actorId)) {
    blockedReasons.add(REVIEW_BLOCKED_REASONS_V0.wrongRole);
  }

  if (assignment !== null && assignment.revokedAt === null) {
    const actorRoles = new Set(input.actorRoleLabels ?? []);
    if (assignment.roleLabel.length > 0 && !actorRoles.has(assignment.roleLabel)) {
      blockedReasons.add(REVIEW_BLOCKED_REASONS_V0.wrongRole);
    }
  }

  if (isApprovalRequest(input.request)) {
    const requiredRoles = input.request.requiredApproverRoles.map((role) => role.roleLabel);
    if (requiredRoles.length > 0) {
      const actorRoles = new Set(input.actorRoleLabels ?? []);
      if (activeDelegation !== null) {
        actorRoles.add(activeDelegation.roleLabel);
      }
      if (matchingDelegation !== null) {
        actorRoles.add(matchingDelegation.roleLabel);
      }

      if (!requiredRoles.some((role) => actorRoles.has(role))) {
        blockedReasons.add(REVIEW_BLOCKED_REASONS_V0.wrongRole);
      }
    }
  }

  if (input.request.diffSnapshot === null) {
    blockedReasons.add(REVIEW_BLOCKED_REASONS_V0.missingDiff);
  }

  for (const requirement of input.request.evidenceRequirements) {
    if (!requirement.required) {
      continue;
    }

    const evidence = input.sealedEvidenceByRef?.[requirement.ref];
    try {
      assertEvidenceUsableForGovernance(evidence);
    } catch {
      blockedReasons.add(REVIEW_BLOCKED_REASONS_V0.missingSealedEvidence);
      break;
    }
  }

  if (input.dependencyDegraded) {
    blockedReasons.add(REVIEW_BLOCKED_REASONS_V0.degradedDependency);
  }

  if (hasInactiveDelegation) {
    blockedReasons.add(REVIEW_BLOCKED_REASONS_V0.expiredDelegation);
  }

  return {
    eligible: blockedReasons.size === 0,
    blockedReasons: [...blockedReasons],
    activeDelegation,
    assignment,
  };
}

function isApprovalRequest(request: ReviewRequestV0 | ApprovalRequestV0): request is ApprovalRequestV0 {
  return request.schema === "pluto.review.approval-request";
}

function selectAssignment(
  request: ReviewRequestV0 | ApprovalRequestV0,
  actorId: string,
  assignments: AssignmentRecordV0[],
): AssignmentRecordV0 | null {
  return assignments.find((assignment) =>
    assignment.requestId === request.id
    && assignment.requestKind === (isApprovalRequest(request) ? "approval" : "review")
    && assignment.actorId === actorId
  ) ?? null;
}

function selectDelegation(
  request: ReviewRequestV0 | ApprovalRequestV0,
  actorId: string,
  delegations: DelegationRecordV0[],
  now: string,
): DelegationRecordV0 | null {
  return delegations.find((delegation) => {
    if (delegation.delegateeId !== actorId) {
      return false;
    }

    if (!delegationMatchesRequest(delegation, request)) {
      return false;
    }

    if (delegation.revokedAt !== null) {
      return false;
    }

    return delegation.expiresAt === null || delegation.expiresAt >= now;
  }) ?? null;
}

function selectScopedDelegation(
  request: ReviewRequestV0 | ApprovalRequestV0,
  actorId: string,
  delegations: DelegationRecordV0[],
): DelegationRecordV0 | null {
  return delegations.find((delegation) =>
    delegation.delegateeId === actorId && delegationMatchesRequest(delegation, request)
  ) ?? null;
}

function delegationMatchesRequest(
  delegation: DelegationRecordV0,
  request: ReviewRequestV0 | ApprovalRequestV0,
): boolean {
  if (delegation.scope.requestKind !== undefined) {
    const requestKind = isApprovalRequest(request) ? "approval" : "review";
    if (delegation.scope.requestKind !== requestKind) {
      return false;
    }
  }

  if (delegation.scope.requestId !== undefined && delegation.scope.requestId !== request.id) {
    return false;
  }

  if (delegation.scope.targetKind !== undefined && delegation.scope.targetKind !== request.target.kind) {
    return false;
  }

  if (delegation.scope.targetId !== undefined && delegation.scope.targetId !== getTargetId(request.target)) {
    return false;
  }

  return request.assigneeIds.includes(delegation.delegatorId);
}

function getTargetId(target: GovernedTargetRefV0): string {
  switch (target.kind) {
    case "document":
      return target.documentId;
    case "version":
      return target.versionId;
    case "section":
      return target.sectionId;
    case "publish_package":
      return target.packageId;
  }
}
