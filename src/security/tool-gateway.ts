import type { ScopedToolPermitV0, SecurityReasonCodeLikeV0 } from "../contracts/security.js";
import { allowsMutatingActionV0, isScopedToolPermitActiveV0 } from "../contracts/security.js";
import type { RuntimeCapabilityDescriptorV0 } from "../contracts/types.js";
import type { AuthorizationDecisionV0 } from "../identity/authorization.js";

export interface EvaluateScopedToolPermitInputV0 {
  now: string;
  workspaceId?: string;
  actionFamily: string;
  action: string;
  httpMethod?: string;
  target: string;
  requestedSensitivity: string;
  sandboxPosture: string;
  trustBoundary: string;
  authorization: AuthorizationDecisionV0;
  runtimeCapability: RuntimeCapabilityDescriptorV0 | null;
  permit: ScopedToolPermitV0 | null;
  approvalRefs?: string[];
}

export interface ScopedToolPermitDecisionV0 {
  schemaVersion: 0;
  supported: boolean;
  allowed: boolean;
  actionFamily: string;
  action: string;
  target: string;
  reasonCode: SecurityReasonCodeLikeV0;
  reasonCodes: SecurityReasonCodeLikeV0[];
  permitId: string | null;
  approvalRefs: string[];
}

const ENFORCED_FAMILIES = new Set(["filesystem", "http"]);
const HTTP_MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXPORT_HINT_RE = /export/i;

export function evaluateScopedToolPermitV0(input: EvaluateScopedToolPermitInputV0): ScopedToolPermitDecisionV0 {
  const supported = ENFORCED_FAMILIES.has(input.actionFamily);
  if (!supported) {
    return decision(input, false, false, "unsupported_family", null, []);
  }

  if (!isMutatingAction(input.actionFamily, input.action, input.httpMethod)) {
    return decision(input, false, false, "unsupported_action", input.permit?.permitId ?? null, []);
  }

  if (!runtimeSupports(input.actionFamily, input.runtimeCapability)) {
    return decision(input, true, false, "runtime_capability_required", input.permit?.permitId ?? null, []);
  }

  if (!input.authorization.allowed) {
    return decision(input, true, false, "identity_denied", input.permit?.permitId ?? null, [], ["identity_denied", input.authorization.reasonCode]);
  }

  if (!input.permit) {
    return decision(input, true, false, "policy_required", null, []);
  }

  if (input.permit.actionFamily !== input.actionFamily) {
    return decision(input, true, false, "policy_required", input.permit.permitId, []);
  }

  if (input.workspaceId && input.permit.workspaceId !== input.workspaceId) {
    return decision(input, true, false, "target_denied", input.permit.permitId, []);
  }

  if (!isScopedToolPermitActiveV0(input.permit, input.now)) {
    return decision(
      input,
      true,
      false,
      input.permit.revokedAt ? "permit_revoked" : "permit_expired",
      input.permit.permitId,
      [],
    );
  }

  if (input.permit.trustBoundary !== input.trustBoundary) {
    return decision(input, true, false, "trust_boundary_required", input.permit.permitId, []);
  }

  if (input.permit.sandboxPosture !== input.sandboxPosture) {
    return decision(input, true, false, "sandbox_required", input.permit.permitId, []);
  }

  if (!allowsMutatingActionV0(
    input.permit,
    input.actionFamily,
    input.target,
    input.requestedSensitivity,
    input.sandboxPosture,
    input.trustBoundary,
  )) {
    return decision(input, true, false, inferPermitFailureReason(input), input.permit.permitId, []);
  }

  const matchedApprovalRefs = resolveApprovalRefs(input);
  if (requiresApprovalRefs(input) && matchedApprovalRefs.length === 0) {
    return decision(input, true, false, "approval_missing", input.permit.permitId, []);
  }

  return decision(
    input,
    true,
    true,
    matchedApprovalRefs.length > 0 ? "operator_approved" : "policy_required",
    input.permit.permitId,
    matchedApprovalRefs,
  );
}

function decision(
  input: EvaluateScopedToolPermitInputV0,
  supported: boolean,
  allowed: boolean,
  reasonCode: SecurityReasonCodeLikeV0,
  permitId: string | null,
  approvalRefs: string[],
  reasonCodes?: SecurityReasonCodeLikeV0[],
): ScopedToolPermitDecisionV0 {
  return {
    schemaVersion: 0,
    supported,
    allowed,
    actionFamily: input.actionFamily,
    action: input.action,
    target: input.target,
    reasonCode,
    reasonCodes: reasonCodes ?? [reasonCode],
    permitId,
    approvalRefs,
  };
}

function runtimeSupports(actionFamily: string, capability: RuntimeCapabilityDescriptorV0 | null): boolean {
  if (!capability) {
    return false;
  }

  if (actionFamily === "filesystem") {
    return capability.files?.write === true;
  }

  if (actionFamily === "http") {
    return capability.tools?.web_fetch === true;
  }

  return false;
}

function isMutatingAction(actionFamily: string, action: string, httpMethod?: string): boolean {
  if (actionFamily === "filesystem") {
    return /(?:write|append|create|delete|move|rename|patch)/i.test(action);
  }

  if (actionFamily === "http") {
    const method = (httpMethod ?? action).toUpperCase();
    return HTTP_MUTATING_METHODS.has(method);
  }

  return false;
}

function inferPermitFailureReason(input: EvaluateScopedToolPermitInputV0): SecurityReasonCodeLikeV0 {
  if (input.permit && input.permit.targetSummary.deny.some((pattern) => targetMatches(pattern, input.target))) {
    return "target_denied";
  }
  if (input.permit && !input.permit.targetSummary.allow.some((pattern) => targetMatches(pattern, input.target))) {
    return "target_denied";
  }
  if (!sensitivityAllowed(input.permit?.sensitivityCeiling, input.requestedSensitivity)) {
    return "sensitivity_exceeded";
  }
  return "policy_required";
}

function resolveApprovalRefs(input: EvaluateScopedToolPermitInputV0): string[] {
  if (!input.permit) {
    return [];
  }

  const requested = new Set(input.approvalRefs ?? []);
  return input.permit.approvalRefs.filter((ref) => requested.has(ref));
}

function requiresApprovalRefs(input: EvaluateScopedToolPermitInputV0): boolean {
  if (!input.permit) {
    return true;
  }
  if (input.actionFamily !== "http") {
    return false;
  }

  const approvalRequired = input.requestedSensitivity === "restricted"
    || input.requestedSensitivity === "regulated"
    || EXPORT_HINT_RE.test(input.action)
    || EXPORT_HINT_RE.test(input.target);

  return approvalRequired && input.permit.approvalRefs.length === 0
    ? true
    : approvalRequired;
}

function sensitivityAllowed(maxSensitivity: string | undefined, requested: string): boolean {
  const order: Record<string, number> = {
    public: 0,
    internal: 1,
    confidential: 2,
    restricted: 3,
    regulated: 4,
  };
  if (!(maxSensitivity && maxSensitivity in order) || !(requested in order)) {
    return false;
  }
  const requestedRank = order[requested];
  const maxRank = order[maxSensitivity];
  return requestedRank !== undefined && maxRank !== undefined && requestedRank <= maxRank;
}

function targetMatches(pattern: string, target: string): boolean {
  if (pattern === "*") {
    return true;
  }
  if (pattern.endsWith("*")) {
    return target.startsWith(pattern.slice(0, -1));
  }
  return pattern === target;
}
