export const GOVERNANCE_EVENT_TYPES_V0 = [
  "review_requested",
  "decision_recorded",
  "approval_granted",
  "approval_rejected",
  "approval_revoked",
  "delegation_changed",
  "package_assembled",
  "export_sealed",
  "publish_attempted",
  "rollback_recorded",
  "retract_recorded",
  "supersede_recorded",
  "waiver_approved",
  "waiver_revoked",
  "readiness_evaluated",
] as const;

export type GovernanceEventTypeV0 = typeof GOVERNANCE_EVENT_TYPES_V0[number];
export type GovernanceEventTypeLikeV0 = GovernanceEventTypeV0 | (string & {});

const GOVERNANCE_EVENT_TYPE_SET = new Set<string>(GOVERNANCE_EVENT_TYPES_V0);

export function parseGovernanceEventTypeV0(value: unknown): GovernanceEventTypeLikeV0 | null {
  if (typeof value !== "string") {
    return null;
  }

  return GOVERNANCE_EVENT_TYPE_SET.has(value) ? value as GovernanceEventTypeV0 : value;
}
