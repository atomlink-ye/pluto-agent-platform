import { describe, expect, it } from "vitest";
import {
  CANONICAL_BLOCKER_REASONS,
  classifyBlocker,
  isRetryable,
  normalizeBlockerReason,
  RETRYABLE_REASONS,
} from "@/orchestrator/blocker-classifier.js";
import type { BlockerReasonV0 } from "@/contracts/types.js";

const canonicalReasons: BlockerReasonV0[] = [
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

describe("blocker-classifier", () => {
  describe("canonical taxonomy", () => {
    it("declares exactly the canonical 11 BlockerReasonV0 values", () => {
      expect(CANONICAL_BLOCKER_REASONS).toEqual(canonicalReasons);
      expect(new Set(CANONICAL_BLOCKER_REASONS).size).toBe(11);
    });

    it.each<[BlockerReasonV0, Parameters<typeof classifyBlocker>[0]]>([
      ["provider_unavailable", { errorMessage: "ECONNREFUSED: connection refused to host" }],
      ["credential_missing", { errorMessage: "401 Unauthorized: missing API key" }],
      ["quota_exceeded", { errorMessage: "429 Too Many Requests — rate limit exceeded" }],
      ["capability_unavailable", { errorMessage: "unsupported model requested" }],
      ["runtime_permission_denied", { errorMessage: "EACCES permission denied writing artifact" }],
      ["runtime_timeout", { errorMessage: "team_run_timeout", source: "timeout" }],
      ["empty_artifact", { errorMessage: "empty_artifact: artifact is whitespace-only", source: "artifact_check" }],
      ["validation_failed", { errorMessage: "FAIL: artifact does not meet criteria", source: "evaluator" }],
      ["adapter_protocol_error", { errorMessage: "adapter protocol error: missing required field sessionId" }],
      ["runtime_error", { errorMessage: "spawn_failed: runtime process exited with non-zero exit" }],
      ["unknown", { errorMessage: "something completely unexpected happened" }],
    ])("classifies %s from representative raw signals", (reason, input) => {
      const result = classifyBlocker(input);
      expect(result.reason).toBe(reason);
      expect(result.classifierVersion).toBe(0);
      expect(result.message).toBe(input.errorMessage);
    });
  });

  describe("legacy alias normalization", () => {
    it("normalizes worker_timeout to runtime_timeout", () => {
      expect(normalizeBlockerReason("worker_timeout")).toBe("runtime_timeout");
    });

    it("normalizes quota_or_model_error quota/rate-limit/payment cases to quota_exceeded", () => {
      expect(normalizeBlockerReason("quota_or_model_error", "429 rate limit exceeded")).toBe("quota_exceeded");
      expect(normalizeBlockerReason("quota_or_model_error", "payment required: insufficient credits")).toBe("quota_exceeded");
    });

    it("normalizes quota_or_model_error model/provider runtime cases to runtime_error", () => {
      expect(normalizeBlockerReason("quota_or_model_error", "model provider returned runtime error")).toBe("runtime_error");
      expect(normalizeBlockerReason("quota_or_model_error")).toBe("runtime_error");
    });
  });

  describe("isRetryable", () => {
    it("marks only provider_unavailable and runtime_timeout as retryable", () => {
      for (const reason of canonicalReasons) {
        expect(isRetryable(reason)).toBe(
          reason === "provider_unavailable" || reason === "runtime_timeout",
        );
      }
    });
  });

  describe("RETRYABLE_REASONS set", () => {
    it("contains exactly provider_unavailable and runtime_timeout", () => {
      expect(RETRYABLE_REASONS.size).toBe(2);
      expect(RETRYABLE_REASONS.has("provider_unavailable")).toBe(true);
      expect(RETRYABLE_REASONS.has("runtime_timeout")).toBe(true);
    });
  });
});
