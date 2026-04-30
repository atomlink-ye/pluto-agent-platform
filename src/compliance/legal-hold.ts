import type { ApprovalRequestV0, ReviewRequestV0 } from "../contracts/review.js";
import type { GovernedObjectRefV0, LegalHoldV0 } from "../contracts/compliance.js";
import type { ComplianceStore, ComplianceTargetRefV0 } from "./compliance-store.js";
import { recordPrivilegedLifecycleEvent } from "./events.js";
import { matchesGovernedRefV0 } from "./retention.js";

export interface PlaceLegalHoldInputV0 {
  store: ComplianceStore;
  id: string;
  workspaceId: string;
  governedRefs: GovernedObjectRefV0[];
  placedById: string;
  placedAt: string;
  reason: string;
  summary: string;
  sourceCommand: string;
}

export interface ReleaseLegalHoldInputV0 {
  store: ComplianceStore;
  hold: LegalHoldV0;
  releasedById: string;
  releasedAt: string;
  releaseReview: Pick<ReviewRequestV0, "id" | "status"> | null;
  releaseApproval: Pick<ApprovalRequestV0, "id" | "status"> | null;
  sourceCommand: string;
}

export interface ReleaseLegalHoldResultV0 {
  allowed: boolean;
  blockReason: string | null;
  hold: LegalHoldV0;
}

export async function placeLegalHoldV0(input: PlaceLegalHoldInputV0): Promise<LegalHoldV0> {
  const hold: LegalHoldV0 = {
    schema: "pluto.compliance.legal-hold",
    schemaVersion: 0,
    id: input.id,
    workspaceId: input.workspaceId,
    status: "placed",
    governedRefs: [...input.governedRefs],
    placedById: input.placedById,
    placedAt: input.placedAt,
    releasedAt: null,
    releaseReviewRef: null,
    releaseApprovalRef: null,
    reason: input.reason,
    summary: input.summary,
  };

  await input.store.put("legal_hold", hold);
  await recordPrivilegedLifecycleEvent(input.store, {
    eventId: `${hold.id}:placed`,
    action: "legal_hold_placed",
    actorId: input.placedById,
    target: toComplianceTargetRefV0(hold.governedRefs[0] ?? { kind: "document", stableId: hold.id, documentId: hold.id, schemaVersion: 0 }),
    createdAt: input.placedAt,
    sourceCommand: input.sourceCommand,
    sourceRef: hold.id,
    beforeStatus: null,
    afterStatus: hold.status,
    reason: hold.reason,
    summary: hold.summary,
  });

  return hold;
}

export async function releaseLegalHoldV0(input: ReleaseLegalHoldInputV0): Promise<ReleaseLegalHoldResultV0> {
  const releaseReviewRef = input.releaseReview?.id ?? null;
  const releaseApprovalRef = input.releaseApproval?.id ?? null;

  if (releaseReviewRef === null || releaseApprovalRef === null) {
    return {
      allowed: false,
      blockReason: "release_requires_review_and_approval",
      hold: input.hold,
    };
  }

  const releasedHold: LegalHoldV0 = {
    ...input.hold,
    status: "released",
    releasedAt: input.releasedAt,
    releaseReviewRef,
    releaseApprovalRef,
  };

  await input.store.put("legal_hold", releasedHold);
  await recordPrivilegedLifecycleEvent(input.store, {
    eventId: `${releasedHold.id}:released`,
    action: "legal_hold_released",
    actorId: input.releasedById,
    target: toComplianceTargetRefV0(releasedHold.governedRefs[0] ?? { kind: "document", stableId: releasedHold.id, documentId: releasedHold.id, schemaVersion: 0 }),
    createdAt: input.releasedAt,
    sourceCommand: input.sourceCommand,
    sourceRef: releasedHold.id,
    beforeStatus: input.hold.status,
    afterStatus: releasedHold.status,
    reason: `Released with review ${releaseReviewRef} and approval ${releaseApprovalRef}.`,
    summary: releasedHold.summary,
    evidenceRefs: [releaseReviewRef, releaseApprovalRef],
  });

  return {
    allowed: true,
    blockReason: null,
    hold: releasedHold,
  };
}

export function hasPlacedLegalHoldV0(input: {
  targetRef: GovernedObjectRefV0;
  holds: ReadonlyArray<Pick<LegalHoldV0, "status" | "governedRefs" | "releasedAt">>;
  requestedAt: string;
}): boolean {
  return input.holds.some((hold) => {
    if (hold.status !== "placed") {
      return false;
    }

    if (hold.releasedAt !== null && hold.releasedAt <= input.requestedAt) {
      return false;
    }

    return hold.governedRefs.some((ref) => matchesGovernedRefV0(ref, input.targetRef));
  });
}

function toComplianceTargetRefV0(ref: GovernedObjectRefV0): ComplianceTargetRefV0 {
  return {
    kind: ref.kind,
    recordId: ref.stableId,
    workspaceId: ref.workspaceId,
    documentId: "documentId" in ref ? ref.documentId : undefined,
    versionId: "versionId" in ref ? ref.versionId : undefined,
    packageId: "packageId" in ref ? ref.packageId : undefined,
    summary: ref.summary,
  };
}
