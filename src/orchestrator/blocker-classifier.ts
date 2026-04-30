import type { BlockerReasonV0 } from "../contracts/types.js";

export const CANONICAL_BLOCKER_REASONS: readonly BlockerReasonV0[] = [
  "provider_unavailable",
  "credential_missing",
  "quota_exceeded",
  "capability_unavailable",
  "runtime_permission_denied",
  "runtime_timeout",
  "empty_artifact",
  "validation_failed",
  "adapter_protocol_error",
  "runtime_error",
  "unknown",
];

const CANONICAL_REASON_SET: ReadonlySet<string> = new Set(CANONICAL_BLOCKER_REASONS);

export interface ClassifierInput {
  errorMessage: string;
  errorCode?: string | number;
  source?: "adapter" | "evaluator" | "timeout" | "artifact_check" | "orchestrator";
}

export interface ClassifierResult {
  reason: BlockerReasonV0;
  classifierVersion: 0;
  message: string;
}

function isQuotaLike(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("too many requests") ||
    msg.includes("429") ||
    msg.includes("402") ||
    msg.includes("payment required") ||
    msg.includes("billing") ||
    msg.includes("insufficient credits") ||
    msg.includes("quota")
  );
}

function isCredentialLike(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("credential") ||
    msg.includes("api key") ||
    msg.includes("apikey") ||
    msg.includes("auth token") ||
    msg.includes("missing token") ||
    msg.includes("unauthorized") ||
    msg.includes("invalid key") ||
    msg.includes("401")
  );
}

export function normalizeBlockerReason(
  reason: unknown,
  contextMessage = "",
): BlockerReasonV0 | null {
  if (reason === null || reason === undefined) return null;
  if (typeof reason !== "string") return "unknown";
  if (CANONICAL_REASON_SET.has(reason)) return reason as BlockerReasonV0;
  if (reason === "worker_timeout") return "runtime_timeout";
  if (reason === "quota_or_model_error") {
    return isQuotaLike(contextMessage) ? "quota_exceeded" : "runtime_error";
  }
  return "unknown";
}

export function classifyBlocker(input: ClassifierInput): ClassifierResult {
  const msg = input.errorMessage.toLowerCase();

  if (input.source === "timeout" || msg.includes("timeout") || msg.includes("timed_out") || msg.includes("team_run_timeout")) {
    return { reason: "runtime_timeout", classifierVersion: 0, message: input.errorMessage };
  }

  if (input.source === "artifact_check" || msg.includes("empty_artifact") || msg.includes("whitespace-only")) {
    return { reason: "empty_artifact", classifierVersion: 0, message: input.errorMessage };
  }

  if (input.source === "evaluator" || msg.includes("validation_failed") || msg.includes("fail:")) {
    return { reason: "validation_failed", classifierVersion: 0, message: input.errorMessage };
  }

  if (
    msg.includes("adapter_protocol_error") ||
    msg.includes("protocol error") ||
    msg.includes("invalid adapter") ||
    msg.includes("malformed json") ||
    msg.includes("invalid json") ||
    msg.includes("schema violation") ||
    msg.includes("missing required field")
  ) {
    return { reason: "adapter_protocol_error", classifierVersion: 0, message: input.errorMessage };
  }

  if (
    msg.includes("permission denied") ||
    msg.includes("access denied") ||
    msg.includes("forbidden") ||
    msg.includes("eacces") ||
    msg.includes("eperm") ||
    input.errorCode === 403 ||
    Number(input.errorCode) === 403
  ) {
    return { reason: "runtime_permission_denied", classifierVersion: 0, message: input.errorMessage };
  }

  if (isCredentialLike(input.errorMessage) || Number(input.errorCode) === 401) {
    return { reason: "credential_missing", classifierVersion: 0, message: input.errorMessage };
  }

  if (isQuotaLike(input.errorMessage) || [402, 429].includes(Number(input.errorCode))) {
    return { reason: "quota_exceeded", classifierVersion: 0, message: input.errorMessage };
  }

  if (
    msg.includes("capability_unavailable") ||
    msg.includes("unsupported capability") ||
    msg.includes("unsupported tool") ||
    msg.includes("tool not available") ||
    msg.includes("model not found") ||
    msg.includes("model unavailable") ||
    msg.includes("unsupported model")
  ) {
    return { reason: "capability_unavailable", classifierVersion: 0, message: input.errorMessage };
  }

  if (
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("network") ||
    msg.includes("5xx") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("unavailable") ||
    msg.includes("daemon") ||
    (msg.includes("provider") && msg.includes("not reachable")) ||
    (input.errorCode !== undefined && [500, 502, 503, 504].includes(Number(input.errorCode)))
  ) {
    return { reason: "provider_unavailable", classifierVersion: 0, message: input.errorMessage };
  }

  if (
    msg.includes("runtime_error") ||
    msg.includes("spawn_failed") ||
    msg.includes("process exited") ||
    msg.includes("non-zero exit") ||
    msg.includes("model error") ||
    msg.includes("provider error") ||
    msg.includes("runtime failed")
  ) {
    return { reason: "runtime_error", classifierVersion: 0, message: input.errorMessage };
  }

  return { reason: "unknown", classifierVersion: 0, message: input.errorMessage };
}

export const RETRYABLE_REASONS: ReadonlySet<BlockerReasonV0> = new Set([
  "provider_unavailable",
  "runtime_timeout",
]);

export function isRetryable(reason: BlockerReasonV0): boolean {
  return RETRYABLE_REASONS.has(reason);
}
