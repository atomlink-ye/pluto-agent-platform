import type { ManifestValidationResult } from "./manifest.js";

export interface ExtensionTrustReview {
  state: "approved" | "pending" | "rejected";
  reasons?: string[];
}

export interface ExtensionSecretBindings {
  state: "ready" | "unresolved";
  missing?: string[];
}

export interface ExtensionCapabilityCompatibility {
  state: "compatible" | "incompatible";
  reasons?: string[];
}

export interface ExtensionPolicyReconciliation {
  state: "reconciled" | "unresolved";
  reasons?: string[];
}

export interface ExtensionActivationInput {
  manifest: ManifestValidationResult;
  requestedCapabilities?: string[];
  privilegedCapabilities?: string[];
  trustReview: ExtensionTrustReview;
  secretBindings: ExtensionSecretBindings;
  capabilityCompatibility: ExtensionCapabilityCompatibility;
  policyReconciliation: ExtensionPolicyReconciliation;
}

export interface ExtensionActivationResult {
  state: "allow" | "deny";
  privileged: boolean;
  reasons: string[];
}

const DEFAULT_PRIVILEGED_CAPABILITY_PATTERN =
  /(secret|credential|provider-session|workspace-binding|filesystem-write|network-egress|exec)/i;

export function deriveRequestedPrivilegedCapabilities(requestedCapabilities: string[] = []): string[] {
  return [...new Set(
    requestedCapabilities.filter((capability) => DEFAULT_PRIVILEGED_CAPABILITY_PATTERN.test(capability)),
  )];
}

export function evaluateExtensionActivation(
  input: ExtensionActivationInput,
): ExtensionActivationResult {
  const reasons: string[] = [];
  const privileged = detectPrivilegedActivation(input);

  if (input.manifest.state === "deny") {
    reasons.push(...input.manifest.reasons);
  }

  if (input.secretBindings.state === "unresolved") {
    reasons.push(...(input.secretBindings.missing ?? []).map((name) => `secret_missing:${name}`));
    if ((input.secretBindings.missing ?? []).length === 0) {
      reasons.push("secret_bindings_unresolved");
    }
  }

  if (input.capabilityCompatibility.state === "incompatible") {
    reasons.push(...(input.capabilityCompatibility.reasons ?? []));
    if ((input.capabilityCompatibility.reasons ?? []).length === 0) {
      reasons.push("capability_incompatible");
    }
  }

  if (input.policyReconciliation.state === "unresolved") {
    reasons.push(...(input.policyReconciliation.reasons ?? []));
    if ((input.policyReconciliation.reasons ?? []).length === 0) {
      reasons.push("policy_unresolved");
    }
  }

  if (privileged && input.trustReview.state !== "approved") {
    reasons.push(...(input.trustReview.reasons ?? []));
    if ((input.trustReview.reasons ?? []).length === 0) {
      reasons.push(`trust_review_${input.trustReview.state}`);
    }
  }

  return {
    state: reasons.length === 0 ? "allow" : "deny",
    privileged,
    reasons,
  };
}

function detectPrivilegedActivation(input: ExtensionActivationInput): boolean {
  if ((input.privilegedCapabilities ?? []).length > 0) {
    return true;
  }

  return deriveRequestedPrivilegedCapabilities(input.requestedCapabilities).length > 0;
}
