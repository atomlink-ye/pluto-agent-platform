import type {
  DeletionAttemptV0,
  DeletionModeLikeV0,
  GovernedObjectRefV0,
  LegalHoldV0,
  RetentionPolicyV0,
} from "../contracts/compliance.js";
import type { ComplianceStore } from "./compliance-store.js";
import { recordPrivilegedLifecycleEvent } from "./events.js";
import { evaluateRetentionDecisionV0 } from "./retention.js";
import { hasPlacedLegalHoldV0 } from "./legal-hold.js";

export interface DeletionDecisionInputV0 {
  store: ComplianceStore;
  id: string;
  workspaceId: string;
  targetRef: GovernedObjectRefV0;
  requestedById: string;
  requestedAt: string;
  mode: DeletionModeLikeV0;
  evidenceRefs?: readonly string[];
  sourceCommand: string;
  summary?: string;
}

export interface DeletionDecisionResultV0 {
  outcome: "allowed" | "blocked";
  blockReason: string | null;
  attempt: DeletionAttemptV0;
}

export interface DeletionEvaluationInputV0 {
  targetRef: GovernedObjectRefV0;
  requestedAt: string;
  mode: DeletionModeLikeV0;
  policies: ReadonlyArray<Pick<RetentionPolicyV0, "id" | "retentionClass" | "governedRefs" | "retainUntil">>;
  holds: ReadonlyArray<Pick<LegalHoldV0, "status" | "governedRefs" | "releasedAt">>;
}

export interface DeletionEvaluationResultV0 {
  outcome: "allowed" | "blocked";
  blockReason: string | null;
  retention: ReturnType<typeof evaluateRetentionDecisionV0>;
  legalHoldActive: boolean;
}

const FAIL_CLOSED_RETAIN_UNTIL_V0 = "9999-12-31T23:59:59.999Z";

export async function decideDeletionAttemptV0(input: DeletionDecisionInputV0): Promise<DeletionDecisionResultV0> {
  const evaluation = await evaluateDeletionDecisionFromStoreV0({
    store: input.store,
    targetRef: input.targetRef,
    requestedAt: input.requestedAt,
    mode: input.mode,
  });
  const attempt: DeletionAttemptV0 = {
    schema: "pluto.compliance.deletion-attempt",
    schemaVersion: 0,
    id: input.id,
    workspaceId: input.workspaceId,
    targetRef: input.targetRef,
    requestedById: input.requestedById,
    requestedAt: input.requestedAt,
    mode: input.mode,
    outcome: evaluation.outcome,
    blockReason: evaluation.blockReason,
    evidenceRefs: uniqueStrings(input.evidenceRefs ?? []),
    summary: input.summary ?? buildDeletionSummaryV0(input.targetRef, input.mode, evaluation.outcome, evaluation.blockReason),
    recordedAt: input.requestedAt,
  };

  await input.store.put("deletion_attempt", attempt);
  await recordPrivilegedLifecycleEvent(input.store, {
    eventId: `${attempt.id}:event`,
    action: evaluation.outcome === "allowed" ? "deletion_allowed" : "deletion_blocked",
    actorId: input.requestedById,
    target: {
      kind: input.targetRef.kind,
      recordId: input.targetRef.stableId,
      workspaceId: input.targetRef.workspaceId,
      documentId: "documentId" in input.targetRef ? input.targetRef.documentId : undefined,
      versionId: "versionId" in input.targetRef ? input.targetRef.versionId : undefined,
      packageId: "packageId" in input.targetRef ? input.targetRef.packageId : undefined,
      summary: input.targetRef.summary,
    },
    createdAt: input.requestedAt,
    sourceCommand: input.sourceCommand,
    sourceRef: attempt.id,
    beforeStatus: null,
    afterStatus: attempt.outcome,
    reason: attempt.blockReason,
    evidenceRefs: attempt.evidenceRefs,
    summary: attempt.summary,
  });

  return {
    outcome: evaluation.outcome,
    blockReason: evaluation.blockReason,
    attempt,
  };
}

export function evaluateDeletionDecisionV0(input: DeletionEvaluationInputV0): DeletionEvaluationResultV0 {
  const legalHoldActive = input.mode === "hard_delete" && hasPlacedLegalHoldV0({
    targetRef: input.targetRef,
    holds: input.holds,
    requestedAt: input.requestedAt,
  });
  const retention = evaluateRetentionDecisionV0({
    targetRef: input.targetRef,
    requestedAt: input.requestedAt,
    mode: input.mode,
    policies: input.policies,
  });
  const blockReason = legalHoldActive ? "legal_hold_active" : retention.blockReason;

  return {
    outcome: blockReason === null ? "allowed" : "blocked",
    blockReason,
    retention,
    legalHoldActive,
  };
}

export async function evaluateDeletionDecisionFromStoreV0(input: {
  store: ComplianceStore;
  targetRef: GovernedObjectRefV0;
  requestedAt: string;
  mode: DeletionModeLikeV0;
}): Promise<DeletionEvaluationResultV0> {
  const [policies, holds] = await Promise.all([
    loadRetentionPoliciesV0(input.store),
    loadLegalHoldsV0(input.store),
  ]);

  return evaluateDeletionDecisionV0({
    targetRef: input.targetRef,
    requestedAt: input.requestedAt,
    mode: input.mode,
    policies,
    holds,
  });
}

async function loadRetentionPoliciesV0(store: ComplianceStore): Promise<RetentionPolicyV0[]> {
  const records = await store.list("retention_policy");
  return records.map((record) => (
    record.retentionClass === "fixed_term"
      && record.status === "active"
      && record.retainUntil === null
      ? { ...record, retainUntil: FAIL_CLOSED_RETAIN_UNTIL_V0 }
      : record
  ));
}

async function loadLegalHoldsV0(store: ComplianceStore): Promise<LegalHoldV0[]> {
  return store.list("legal_hold");
}

function buildDeletionSummaryV0(
  targetRef: GovernedObjectRefV0,
  mode: DeletionModeLikeV0,
  outcome: "allowed" | "blocked",
  blockReason: string | null,
): string {
  if (outcome === "allowed") {
    return `${mode} allowed for ${targetRef.kind}:${targetRef.stableId}.`;
  }

  return `${mode} blocked for ${targetRef.kind}:${targetRef.stableId}${blockReason === null ? "" : ` (${blockReason})`}.`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
