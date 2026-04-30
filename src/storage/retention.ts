import type {
  LegalHoldOverlayV0,
  RetentionClassLikeV0,
  RetentionClassV0,
  RetentionPolicyV0,
  StorageRefV0,
} from "../contracts/storage.js";

export const STORAGE_RETENTION_CLASSES_R6 = [
  "short_lived",
  "governed_record",
  "audit_record",
] as const;

export type StorageRetentionClassR6 = typeof STORAGE_RETENTION_CLASSES_R6[number];

export interface RetentionRuleV0 {
  normalizedClass: StorageRetentionClassR6 | "legacy" | "future_strict";
  canDeleteWithoutTombstone: boolean;
  requiresTombstone: boolean;
  blocksRetentionShortening: boolean;
}

export interface RetentionEvaluationV0 {
  rule: RetentionRuleV0;
  retainUntil: string | null;
  legalHoldActive: boolean;
  blockingReasons: string[];
}

const ACTIVE_HOLD_STATUSES = new Set(["active", "held"]);

export function normalizeRetentionClassForBehaviorV0(
  value: RetentionClassLikeV0,
): RetentionRuleV0 {
  switch (value) {
    case "short_lived":
    case "ephemeral":
    case "session":
      return {
        normalizedClass: value === "short_lived" ? "short_lived" : "legacy",
        canDeleteWithoutTombstone: true,
        requiresTombstone: false,
        blocksRetentionShortening: false,
      };
    case "governed_record":
    case "durable":
    case "regulated":
      return {
        normalizedClass: value === "governed_record" ? "governed_record" : "legacy",
        canDeleteWithoutTombstone: false,
        requiresTombstone: true,
        blocksRetentionShortening: false,
      };
    case "audit_record":
      return {
        normalizedClass: "audit_record",
        canDeleteWithoutTombstone: false,
        requiresTombstone: true,
        blocksRetentionShortening: true,
      };
    default:
      return {
        normalizedClass: "future_strict",
        canDeleteWithoutTombstone: false,
        requiresTombstone: true,
        blocksRetentionShortening: true,
      };
  }
}

export function hasActiveLegalHoldV0(
  targetRef: StorageRefV0,
  holds: LegalHoldOverlayV0[],
  now = new Date().toISOString(),
): boolean {
  return holds.some((hold) => {
    if (!ACTIVE_HOLD_STATUSES.has(hold.status)) {
      return false;
    }

    if (hold.releasedAt !== null && hold.releasedAt <= now) {
      return false;
    }

    return hold.targetRefs.some((ref) => isSameStorageRefV0(ref, targetRef));
  });
}

export function resolveRetainUntilV0(
  targetRef: StorageRefV0,
  policies: RetentionPolicyV0[],
): string | null {
  let resolved: string | null = null;
  for (const policy of policies) {
    if (!policy.appliesTo.some((ref) => isSameStorageRefV0(ref, targetRef))) {
      continue;
    }

    if (policy.retainUntil === null) {
      continue;
    }

    if (resolved === null || policy.retainUntil > resolved) {
      resolved = policy.retainUntil;
    }
  }

  return resolved;
}

export function evaluateRetentionForDeletionV0(input: {
  retentionClass: RetentionClassLikeV0;
  targetRef: StorageRefV0;
  policies?: RetentionPolicyV0[];
  holds?: LegalHoldOverlayV0[];
  now?: string;
}): RetentionEvaluationV0 {
  const now = input.now ?? new Date().toISOString();
  const policies = input.policies ?? [];
  const holds = input.holds ?? [];
  const rule = normalizeRetentionClassForBehaviorV0(input.retentionClass);
  const retainUntil = resolveRetainUntilV0(input.targetRef, policies);
  const legalHoldActive = hasActiveLegalHoldV0(input.targetRef, holds, now);
  const blockingReasons: string[] = [];

  if (legalHoldActive) {
    blockingReasons.push("legal_hold_active");
  }

  if (retainUntil !== null && retainUntil > now) {
    blockingReasons.push("retain_until_active");
  }

  return {
    rule,
    retainUntil,
    legalHoldActive,
    blockingReasons,
  };
}

export function canShortenRetentionV0(input: {
  currentClass: RetentionClassLikeV0;
  nextClass: RetentionClassLikeV0;
  targetRef: StorageRefV0;
  holds?: LegalHoldOverlayV0[];
  now?: string;
}): { allowed: boolean; reason: string | null } {
  const currentRule = normalizeRetentionClassForBehaviorV0(input.currentClass);
  const nextRule = normalizeRetentionClassForBehaviorV0(input.nextClass);

  if (hasActiveLegalHoldV0(input.targetRef, input.holds ?? [], input.now)) {
    return { allowed: false, reason: "legal_hold_active" };
  }

  if (currentRule.blocksRetentionShortening) {
    return { allowed: false, reason: "retention_locked" };
  }

  if (currentRule.requiresTombstone && nextRule.canDeleteWithoutTombstone) {
    return { allowed: false, reason: "retention_weakening_blocked" };
  }

  return { allowed: true, reason: null };
}

export function isSameStorageRefV0(left: StorageRefV0, right: StorageRefV0): boolean {
  return (
    left.storageVersion === right.storageVersion
    && left.kind === right.kind
    && left.recordId === right.recordId
    && left.workspaceId === right.workspaceId
  );
}

export function isExplicitRetentionClassV0(value: string): value is RetentionClassV0 {
  return [
    "ephemeral",
    "session",
    "durable",
    "regulated",
    "short_lived",
    "governed_record",
    "audit_record",
  ].includes(value);
}
