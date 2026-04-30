import type {
  ComplianceRetentionClassLikeV0,
  DeletionModeLikeV0,
  GovernedObjectRefV0,
  RetentionPolicyV0,
} from "../contracts/compliance.js";

export interface RetentionDecisionV0 {
  outcome: "allowed" | "blocked";
  blockReason: string | null;
  matchedPolicyIds: string[];
  retainUntil: string | null;
  summary: string;
}

interface ComparableRetentionPolicyV0 {
  id: string;
  retentionClass: ComplianceRetentionClassLikeV0;
  governedRefs: GovernedObjectRefV0[];
  retainUntil: string | null;
}

export function evaluateRetentionDecisionV0(input: {
  targetRef: GovernedObjectRefV0;
  requestedAt: string;
  mode: DeletionModeLikeV0;
  policies: ReadonlyArray<Pick<RetentionPolicyV0, "id" | "retentionClass" | "governedRefs" | "retainUntil">>;
}): RetentionDecisionV0 {
  const matchedPolicies = input.policies.filter((policy) => policy.governedRefs.some((ref) => matchesGovernedRefV0(ref, input.targetRef)));

  if (matchedPolicies.length === 0) {
    return {
      outcome: "allowed",
      blockReason: null,
      matchedPolicyIds: [],
      retainUntil: null,
      summary: `No retention policy blocks ${input.mode} for ${describeGovernedRefV0(input.targetRef)}.`,
    };
  }

  const retainUntil = resolveRetainUntilV0(matchedPolicies);
  const strictest = matchedPolicies.reduce(selectStricterPolicyV0);
  const blockReason = evaluateRetentionBlockReasonV0(strictest, input.requestedAt, input.mode, retainUntil);

  return {
    outcome: blockReason === null ? "allowed" : "blocked",
    blockReason,
    matchedPolicyIds: matchedPolicies.map((policy) => policy.id),
    retainUntil,
    summary: buildRetentionSummaryV0(input.targetRef, input.mode, strictest.retentionClass, blockReason, retainUntil),
  };
}

export function matchesGovernedRefV0(left: GovernedObjectRefV0, right: GovernedObjectRefV0): boolean {
  return left.kind === right.kind && left.stableId === right.stableId && left.workspaceId === right.workspaceId;
}

function resolveRetainUntilV0(policies: ReadonlyArray<ComparableRetentionPolicyV0>): string | null {
  let retainUntil: string | null = null;
  for (const policy of policies) {
    if (policy.retainUntil === null) {
      continue;
    }

    if (retainUntil === null || policy.retainUntil > retainUntil) {
      retainUntil = policy.retainUntil;
    }
  }

  return retainUntil;
}

function selectStricterPolicyV0(
  current: ComparableRetentionPolicyV0,
  candidate: ComparableRetentionPolicyV0,
): ComparableRetentionPolicyV0 {
  return retentionStrictnessRankV0(candidate.retentionClass) > retentionStrictnessRankV0(current.retentionClass)
    ? candidate
    : current;
}

function retentionStrictnessRankV0(retentionClass: ComplianceRetentionClassLikeV0): number {
  switch (retentionClass) {
    case "regulated":
      return 3;
    case "indefinite":
      return 2;
    case "fixed_term":
      return 1;
    default:
      return 0;
  }
}

function evaluateRetentionBlockReasonV0(
  policy: ComparableRetentionPolicyV0,
  requestedAt: string,
  mode: DeletionModeLikeV0,
  retainUntil: string | null,
): string | null {
  switch (policy.retentionClass) {
    case "fixed_term":
      return retainUntil !== null && retainUntil > requestedAt ? "retain_until_active" : null;
    case "indefinite":
      return "indefinite_retention_active";
    case "regulated":
      return mode === "hard_delete" ? "regulated_retention_active" : null;
    default:
      return mode === "hard_delete" ? "retention_policy_blocked" : null;
  }
}

function buildRetentionSummaryV0(
  targetRef: GovernedObjectRefV0,
  mode: DeletionModeLikeV0,
  retentionClass: ComplianceRetentionClassLikeV0,
  blockReason: string | null,
  retainUntil: string | null,
): string {
  if (blockReason === null) {
    return `${mode} allowed for ${describeGovernedRefV0(targetRef)} under ${retentionClass} retention.`;
  }

  if (blockReason === "retain_until_active" && retainUntil !== null) {
    return `${mode} blocked for ${describeGovernedRefV0(targetRef)} until ${retainUntil}.`;
  }

  return `${mode} blocked for ${describeGovernedRefV0(targetRef)} by ${retentionClass} retention.`;
}

function describeGovernedRefV0(ref: GovernedObjectRefV0): string {
  return `${ref.kind}:${ref.stableId}`;
}
