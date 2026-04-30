import { describe, expect, it } from "vitest";

import { evaluateExtensionActivation } from "@/extensions/activation.js";
import { validateExtensionManifest } from "@/extensions/manifest.js";

const validManifest = validateExtensionManifest({
  id: "demo",
  version: "1.0.0",
  assets: [{ kind: "bundle", path: "dist/index.js" }],
});

describe("evaluateExtensionActivation", () => {
  it("keeps privileged activation denied until every gate is resolved", () => {
    const result = evaluateExtensionActivation({
      manifest: validManifest,
      requestedCapabilities: ["provider-session", "filesystem-write"],
      trustReview: {
        state: "pending",
        reasons: ["trust_review_pending"],
      },
      secretBindings: {
        state: "unresolved",
        missing: ["provider-token"],
      },
      capabilityCompatibility: {
        state: "incompatible",
        reasons: ["capability_incompatible:filesystem-write"],
      },
      policyReconciliation: {
        state: "unresolved",
        reasons: ["policy_unresolved:requires-tenant-approval"],
      },
    });

    expect(result.privileged).toBe(true);
    expect(result.state).toBe("deny");
    expect(result.reasons).toEqual([
      "secret_missing:provider-token",
      "capability_incompatible:filesystem-write",
      "policy_unresolved:requires-tenant-approval",
      "trust_review_pending",
    ]);
  });

  it("allows privileged activation once manifest and all gates are satisfied", () => {
    const result = evaluateExtensionActivation({
      manifest: validManifest,
      privilegedCapabilities: ["secret-access"],
      trustReview: { state: "approved" },
      secretBindings: { state: "ready" },
      capabilityCompatibility: { state: "compatible" },
      policyReconciliation: { state: "reconciled" },
    });

    expect(result).toEqual({
      state: "allow",
      privileged: true,
      reasons: [],
    });
  });
});
