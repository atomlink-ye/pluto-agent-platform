import type { SealedEvidenceRefV0 } from "../contracts/evidence-graph.js";
import type {
  PublishAttemptRecordV0,
  PublishPackageRecordV0,
  PublishReadinessV0,
  PublishReadyBlockedReasonV0,
} from "../contracts/publish.js";
import { assertNoCredentialLeakage } from "../contracts/publish.js";
import { assertEvidenceUsableForGovernance } from "../evidence/seal.js";

export interface BuildPublishReadinessOptions {
  publishPackage: PublishPackageRecordV0;
  approvals?: readonly string[];
  sealedEvidence?: Readonly<Record<string, SealedEvidenceRefV0 | undefined>>;
  publishAttempts?: readonly PublishAttemptRecordV0[];
}

export function buildPublishReadiness(options: BuildPublishReadinessOptions): PublishReadinessV0 {
  const blockedReasons = new Set<PublishReadyBlockedReasonV0>(options.publishPackage.publishReadyBlockedReasons);

  const approvedRefs = new Set(options.approvals ?? []);
  if (options.publishPackage.approvalRefs.length === 0
    || options.publishPackage.approvalRefs.some((ref) => !approvedRefs.has(ref))) {
    blockedReasons.add("missing_approval");
  }

  const sealedEvidence = options.sealedEvidence ?? {};
  if (options.publishPackage.sealedEvidenceRefs.length === 0) {
    blockedReasons.add("missing_sealed_evidence");
  }
  for (const ref of options.publishPackage.sealedEvidenceRefs) {
    const record = sealedEvidence[ref];
    if (!record) {
      blockedReasons.add("missing_sealed_evidence");
      continue;
    }

    try {
      assertEvidenceUsableForGovernance(record);
    } catch {
      blockedReasons.add("missing_sealed_evidence");
    }
  }

  if (options.publishPackage.releaseReadinessRefs.some((ref) => ref.status !== "ready")) {
    blockedReasons.add("failed_readiness_gate");
  }

  const seen = new Set<string>();
  const duplicateIdempotencyKeys = new Set<string>();
  for (const attempt of options.publishAttempts ?? []) {
    if (seen.has(attempt.idempotencyKey)) {
      duplicateIdempotencyKeys.add(attempt.idempotencyKey);
    }
    seen.add(attempt.idempotencyKey);

    try {
      assertNoCredentialLeakage(attempt.payloadSummary, "payloadSummary");
    } catch {
      blockedReasons.add("credential_leakage");
    }
  }

  if (duplicateIdempotencyKeys.size > 0) {
    blockedReasons.add("duplicate_idempotency_key");
  }

  return {
    schema: "pluto.publish.readiness",
    schemaVersion: 0,
    publishPackageId: options.publishPackage.id,
    status: blockedReasons.size === 0 ? "ready" : "blocked",
    blockedReasons: [...blockedReasons],
    duplicateIdempotencyKeys: [...duplicateIdempotencyKeys],
  };
}
