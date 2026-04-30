import type { BootstrapFailureV0 } from "./contracts.js";

export const STABLE_BOOTSTRAP_BLOCKER_REASON_CODES_V0 = [
  "runtime_unavailable",
  "capability_unsupported",
  "secret_ref_missing",
  "policy_blocked",
  "budget_blocked",
  "invalid_sample",
  "run_failed",
  "empty_artifact",
  "redaction_failed",
  "evidence_unsealed",
  "permission_denied",
] as const;

export type StableBootstrapBlockerReasonCodeV0 = typeof STABLE_BOOTSTRAP_BLOCKER_REASON_CODES_V0[number];

const RETRYABLE_REASON_CODES = new Set<StableBootstrapBlockerReasonCodeV0>([
  "runtime_unavailable",
]);

export interface ClassifiedBootstrapFailureV0 {
  reasonCode: StableBootstrapBlockerReasonCodeV0;
  retryable: boolean;
}

export function classifyBootstrapFailureReasonV0(
  failure: Pick<BootstrapFailureV0, "blockingReason" | "resolutionHint"> | null,
): ClassifiedBootstrapFailureV0 | null {
  if (failure === null) {
    return null;
  }

  const reasonCode = normalizeBootstrapFailureReasonV0(failure.blockingReason, failure.resolutionHint);
  return {
    reasonCode,
    retryable: RETRYABLE_REASON_CODES.has(reasonCode),
  };
}

export function normalizeBootstrapFailureReasonV0(
  blockingReason: string | null | undefined,
  resolutionHint?: string | null,
): StableBootstrapBlockerReasonCodeV0 {
  const reason = (blockingReason ?? "").trim().toLowerCase();
  const hint = (resolutionHint ?? "").trim().toLowerCase();
  const joined = `${reason} ${hint}`.trim();

  if (reason === "runtime_unavailable"
    || reason === "provider_unavailable"
    || reason === "runtime_timeout"
    || reason === "runtime_error") {
    return "runtime_unavailable";
  }

  if (reason === "capability_unsupported"
    || reason === "capability_unavailable"
    || reason === "unsupported_capability") {
    return "capability_unsupported";
  }

  if (reason === "secret_ref_missing"
    || reason === "missing_secret_ref"
    || reason === "credential_missing") {
    return "secret_ref_missing";
  }

  if (reason === "policy_blocked") {
    return "policy_blocked";
  }

  if (reason === "budget_blocked" || reason === "quota_exceeded") {
    return "budget_blocked";
  }

  if (reason === "invalid_sample" || reason === "sample_invalid" || reason === "sample_retired") {
    return "invalid_sample";
  }

  if (reason === "empty_artifact") {
    return "empty_artifact";
  }

  if (reason === "redaction_failed" || reason === "bootstrap_secret_redaction_failed") {
    return "redaction_failed";
  }

  if (reason === "evidence_unsealed" || reason === "missing_sealed_evidence" || reason === "invalid_evidence_packet") {
    return "evidence_unsealed";
  }

  if (reason === "permission_denied" || reason === "runtime_permission_denied" || reason === "principal_mismatch") {
    return "permission_denied";
  }

  if (reason === "run_failed" || reason === "validation_failed" || reason === "adapter_protocol_error") {
    return "run_failed";
  }

  if (joined.includes("permission denied") || joined.includes("eacces") || joined.includes("principal mismatch")) {
    return "permission_denied";
  }
  if (joined.includes("redact")) {
    return "redaction_failed";
  }
  if (joined.includes("sealed evidence") || joined.includes("unsealed") || joined.includes("evidence packet")) {
    return "evidence_unsealed";
  }
  if (joined.includes("artifact") && joined.includes("empty")) {
    return "empty_artifact";
  }
  if (joined.includes("sample") && (joined.includes("invalid") || joined.includes("retired"))) {
    return "invalid_sample";
  }
  if (joined.includes("budget") || joined.includes("quota") || joined.includes("payment")) {
    return "budget_blocked";
  }
  if (joined.includes("policy")) {
    return "policy_blocked";
  }
  if (joined.includes("secret") || joined.includes("env ") || joined.includes("credential")) {
    return "secret_ref_missing";
  }
  if (joined.includes("capability") || joined.includes("unsupported")) {
    return "capability_unsupported";
  }

  return "run_failed";
}
