import type {
  ApiTokenRecordV0,
  MembershipBindingV0,
  PermissionLikeV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "../contracts/identity.js";
import type {
  AuditEventV0,
  AuditEventOutcomeLikeV0,
  ScopedToolPermitV0,
  SecurityReasonCodeLikeV0,
} from "../contracts/security.js";
import type { StorageRefV0, StorageStatusV0 } from "../contracts/storage.js";
import type {
  AgentEvent,
  EvidencePacketV0,
  RunsListItemV0,
  RuntimeCapabilityDescriptorV0,
  RuntimeRequirementsV0,
  TeamRunResult,
} from "../contracts/types.js";
import { workspaceScopeAllowsV0 } from "../contracts/identity.js";
import { authorizeActionV0, type AuthorizationActorLifecycleV0, type AuthorizationDecisionV0 } from "./authorization.js";
import { createAuditEventV0, type AuditEnvelopeEventV0 } from "../security/audit.js";
import { evaluateScopedToolPermitV0, type ScopedToolPermitDecisionV0 } from "../security/tool-gateway.js";
import { matchRuntimeCapabilities, type CapabilityMismatchV0 } from "../runtime/index.js";
import { normalizeStorageEventResultStatusV0, type StorageEventResultStatusLikeV0 } from "../storage/event-ledger.js";

export const LOCAL_V0_UNSUPPORTED_SURFACES_V0 = [
  "real_signing",
  "sso",
  "secret_manager",
  "multi_tenant_infrastructure",
  "provider_storage_integration",
  "enterprise_compliance",
] as const;

export type LocalV0UnsupportedSurfaceV0 = typeof LOCAL_V0_UNSUPPORTED_SURFACES_V0[number];

export interface GovernedLocalActionInputV0 {
  now: string;
  workspaceId: string;
  actorRef: PrincipalRefV0;
  principalRef: PrincipalRefV0;
  resourceRef: WorkspaceScopedRefV0;
  action: PermissionLikeV0;
  workspace: WorkspaceRecordV0 | null;
  bindings: MembershipBindingV0[];
  token?: ApiTokenRecordV0 | null;
  principalLifecycle?: AuthorizationActorLifecycleV0 | null;
  actionFamily: string;
  actionName: string;
  httpMethod?: string;
  target: string;
  requestedSensitivity: string;
  sandboxPosture: string;
  trustBoundary: string;
  runtimeCapability: RuntimeCapabilityDescriptorV0 | null;
  runtimeRequirements?: RuntimeRequirementsV0;
  permit: ScopedToolPermitV0 | null;
  permitRef?: WorkspaceScopedRefV0 | null;
  approvalRefs?: string[];
  approvalObjectRefs?: WorkspaceScopedRefV0[];
  storageStatus: StorageStatusV0 | null;
  storageEventStatus?: unknown;
  requestedSurface?: LocalV0UnsupportedSurfaceV0 | (string & {});
  correlationId?: string;
  auditEventId?: string;
}

export interface GovernedRuntimeBoundaryV0 {
  supported: boolean;
  matched: boolean;
  reasonCode: string | null;
  mismatches: CapabilityMismatchV0[];
}

export interface GovernedStorageBoundaryV0 {
  supported: boolean;
  ready: boolean;
  reasonCode: string | null;
  eventStatus: StorageEventResultStatusLikeV0 | null;
  ref: StorageRefV0 | null;
  objectRef: WorkspaceScopedRefV0 | null;
}

export interface GovernedLocalActionBoundaryDecisionV0 {
  schemaVersion: 0;
  supported: boolean;
  allowed: boolean;
  workspaceScoped: boolean;
  reasonCode: string;
  reasonCodes: string[];
  unsupportedSurface: LocalV0UnsupportedSurfaceV0 | null;
  authorization: AuthorizationDecisionV0;
  permitDecision: ScopedToolPermitDecisionV0;
  runtime: GovernedRuntimeBoundaryV0;
  storage: GovernedStorageBoundaryV0;
  audit: AuditEnvelopeEventV0;
}

export interface GovernedRuntimeOutcomeProjectionV0 {
  eventType: Extract<AgentEvent["type"], "run_completed" | "run_failed">;
  runsStatus: RunsListItemV0["status"];
  evidenceStatus: EvidencePacketV0["status"];
}

const LOCAL_V0_UNSUPPORTED_SURFACE_SET = new Set<string>(LOCAL_V0_UNSUPPORTED_SURFACES_V0);

export function composeGovernedLocalActionBoundaryV0(
  input: GovernedLocalActionInputV0,
): GovernedLocalActionBoundaryDecisionV0 {
  const authorization = authorizeActionV0({
    now: input.now,
    workspaceId: input.workspaceId,
    principal: input.principalRef,
    resource: input.resourceRef,
    action: input.action,
    workspace: input.workspace,
    bindings: input.bindings,
    token: input.token,
    principalLifecycle: input.principalLifecycle,
  });
  const permitDecision = evaluateScopedToolPermitV0({
    now: input.now,
    workspaceId: input.workspaceId,
    actionFamily: input.actionFamily,
    action: input.actionName,
    httpMethod: input.httpMethod,
    target: input.target,
    requestedSensitivity: input.requestedSensitivity,
    sandboxPosture: input.sandboxPosture,
    trustBoundary: input.trustBoundary,
    authorization,
    runtimeCapability: input.runtimeCapability,
    permit: input.permit,
    approvalRefs: input.approvalRefs,
  });
  const runtime = evaluateRuntimeBoundaryV0(input.runtimeCapability, input.runtimeRequirements);
  const storage = evaluateStorageBoundaryV0(input.workspaceId, input.storageStatus, input.storageEventStatus);
  const workspaceScoped = workspaceScopeAllowsV0(input.workspaceId, input.resourceRef)
    && input.actorRef.workspaceId === input.workspaceId
    && input.principalRef.workspaceId === input.workspaceId;
  const unsupportedSurface = resolveUnsupportedSurfaceV0(input);

  const reasonCodes = compactReasonCodes([
    !workspaceScoped ? "workspace_mismatch" : null,
    unsupportedSurface ? `local_v0_only:${unsupportedSurface}` : null,
    permitDecision.reasonCode,
    runtime.reasonCode,
    storage.reasonCode,
    !hasRequiredGovernedRefsV0(input, permitDecision) ? missingRefReasonCodeV0(input, permitDecision) : null,
    ...permitDecision.reasonCodes,
  ]);

  const supported = permitDecision.supported
    && runtime.supported
    && storage.supported
    && unsupportedSurface === null;
  const allowed = supported
    && workspaceScoped
    && authorization.allowed
    && permitDecision.allowed
    && runtime.matched
    && storage.ready
    && hasRequiredGovernedRefsV0(input, permitDecision);

  const outcome: AuditEventOutcomeLikeV0 = allowed ? "allowed" : "denied";
  const audit = createAuditEventV0({
    workspaceId: input.workspaceId,
    eventId: input.auditEventId ?? buildBoundaryAuditEventIdV0(input),
    occurredAt: input.now,
    actorRef: input.actorRef,
    principalRef: input.principalRef,
    actionFamily: input.actionFamily,
    action: input.actionName,
    target: input.target,
    permitId: permitDecision.permitId,
    approvalRefs: allowed ? permitDecision.approvalRefs : [],
    outcome,
    sensitivity: input.requestedSensitivity,
    sandboxPosture: input.sandboxPosture,
    trustBoundary: input.trustBoundary,
    reasonCodes: reasonCodes.length === 0 ? [allowed ? "operator_approved" : "policy_required"] : reasonCodes,
    correlationId: input.correlationId ?? input.auditEventId ?? input.resourceRef.id,
    details: {
      resourceRef: input.resourceRef,
      permitRef: input.permitRef ?? null,
      storageRef: storage.ref,
      storageObjectRef: storage.objectRef,
      runtimeSupported: runtime.supported,
      runtimeMatched: runtime.matched,
      storageReady: storage.ready,
      unsupportedSurface,
    },
  });

  return {
    schemaVersion: 0,
    supported,
    allowed,
    workspaceScoped,
    reasonCode: (reasonCodes[0] ?? (allowed ? "operator_approved" : "policy_required")) as string,
    reasonCodes,
    unsupportedSurface,
    authorization,
    permitDecision,
    runtime,
    storage,
    audit,
  };
}

export function projectGovernedRuntimeOutcomeV0(result: TeamRunResult): GovernedRuntimeOutcomeProjectionV0 {
  if (result.status === "completed") {
    return {
      eventType: "run_completed",
      runsStatus: "done",
      evidenceStatus: "done",
    };
  }

  const blocked = result.blockerReason !== null && result.blockerReason !== undefined;
  return {
    eventType: "run_failed",
    runsStatus: blocked ? "blocked" : "failed",
    evidenceStatus: blocked ? "blocked" : "failed",
  };
}

export function normalizeGovernedStorageEventStatusV0(
  value: unknown,
): StorageEventResultStatusLikeV0 | null {
  return normalizeStorageEventResultStatusV0(value);
}

function evaluateRuntimeBoundaryV0(
  runtimeCapability: RuntimeCapabilityDescriptorV0 | null,
  runtimeRequirements?: RuntimeRequirementsV0,
): GovernedRuntimeBoundaryV0 {
  if (!runtimeRequirements) {
    return {
      supported: runtimeCapability !== null,
      matched: runtimeCapability !== null,
      reasonCode: runtimeCapability === null ? "runtime_capability_required" : null,
      mismatches: [],
    };
  }

  if (runtimeCapability === null) {
    return {
      supported: false,
      matched: false,
      reasonCode: "runtime_capability_required",
      mismatches: [],
    };
  }

  const match = matchRuntimeCapabilities(runtimeCapability, runtimeRequirements);
  return {
    supported: true,
    matched: match.ok,
    reasonCode: match.ok ? null : "runtime_capability_required",
    mismatches: match.mismatches,
  };
}

function evaluateStorageBoundaryV0(
  workspaceId: string,
  storageStatus: StorageStatusV0 | null,
  storageEventStatus?: unknown,
): GovernedStorageBoundaryV0 {
  if (storageStatus === null) {
    return {
      supported: false,
      ready: false,
      reasonCode: "storage_status_required",
      eventStatus: normalizeStorageEventResultStatusV0(storageEventStatus),
      ref: null,
      objectRef: null,
    };
  }

  const normalizedStatus = storageEventStatus === undefined
    ? "succeeded"
    : normalizeStorageEventResultStatusV0(storageEventStatus);

  if (storageStatus.storageVersion !== "local-v0") {
    return {
      supported: false,
      ready: false,
      reasonCode: "storage_version_unsupported",
      eventStatus: normalizedStatus,
      ref: storageStatus.ref,
      objectRef: toStorageObjectRefV0(storageStatus.ref),
    };
  }

  if (storageStatus.ref.workspaceId !== workspaceId) {
    return {
      supported: true,
      ready: false,
      reasonCode: "workspace_mismatch",
      eventStatus: normalizedStatus,
      ref: storageStatus.ref,
      objectRef: toStorageObjectRefV0(storageStatus.ref),
    };
  }

  if (normalizedStatus === null) {
    return {
      supported: false,
      ready: false,
      reasonCode: "storage_projection_unsupported",
      eventStatus: null,
      ref: storageStatus.ref,
      objectRef: toStorageObjectRefV0(storageStatus.ref),
    };
  }

  if (normalizedStatus !== "succeeded") {
    return {
      supported: true,
      ready: false,
      reasonCode: "storage_not_ready",
      eventStatus: normalizedStatus,
      ref: storageStatus.ref,
      objectRef: toStorageObjectRefV0(storageStatus.ref),
    };
  }

  return {
    supported: true,
    ready: true,
    reasonCode: null,
    eventStatus: normalizedStatus,
    ref: storageStatus.ref,
    objectRef: toStorageObjectRefV0(storageStatus.ref),
  };
}

function resolveUnsupportedSurfaceV0(
  input: GovernedLocalActionInputV0,
): LocalV0UnsupportedSurfaceV0 | null {
  if (typeof input.requestedSurface === "string" && LOCAL_V0_UNSUPPORTED_SURFACE_SET.has(input.requestedSurface)) {
    return input.requestedSurface as LocalV0UnsupportedSurfaceV0;
  }

  const action = `${input.actionFamily}:${input.actionName}:${input.target}`.toLowerCase();
  if (action.includes("sign") || action.includes("signature") || action.includes("kms://")) {
    return "real_signing";
  }
  if (action.includes("sso") || action.includes("saml") || action.includes("oidc")) {
    return "sso";
  }
  if (action.includes("secret-manager://") || action.includes("vault://")) {
    return "secret_manager";
  }
  if (action.includes("multi-tenant") || action.includes("tenant://")) {
    return "multi_tenant_infrastructure";
  }
  if (action.includes("provider-storage://") || action.includes("s3://") || action.includes("gs://") || action.includes("azure://")) {
    return "provider_storage_integration";
  }
  if (action.includes("soc2") || action.includes("hipaa") || action.includes("iso27001") || action.includes("compliance://")) {
    return "enterprise_compliance";
  }

  return null;
}

function hasRequiredGovernedRefsV0(
  input: GovernedLocalActionInputV0,
  permitDecision: ScopedToolPermitDecisionV0,
): boolean {
  if (input.permit !== null && input.permitRef == null) {
    return false;
  }

  if (permitDecision.approvalRefs.length === 0) {
    return true;
  }

  const approvalObjectRefs = input.approvalObjectRefs ?? [];
  const byId = new Set(approvalObjectRefs.map((ref) => ref.id));
  return permitDecision.approvalRefs.every((ref) => byId.has(ref));
}

function missingRefReasonCodeV0(
  input: GovernedLocalActionInputV0,
  permitDecision: ScopedToolPermitDecisionV0,
): SecurityReasonCodeLikeV0 {
  if (input.permit !== null && input.permitRef == null) {
    return "permit_object_ref_required";
  }

  if (permitDecision.approvalRefs.length > 0) {
    return "approval_object_ref_required";
  }

  return "object_ref_required";
}

function compactReasonCodes(values: Array<string | null>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      unique.add(value);
    }
  }

  return [...unique];
}

function toStorageObjectRefV0(ref: StorageRefV0): WorkspaceScopedRefV0 {
  return {
    workspaceId: ref.workspaceId,
    kind: ref.kind,
    id: ref.recordId,
  };
}

function buildBoundaryAuditEventIdV0(input: GovernedLocalActionInputV0): string {
  return [
    "audit",
    input.workspaceId,
    input.resourceRef.kind,
    input.resourceRef.id,
    input.actionFamily,
  ].join(":");
}

export type GovernedLocalActionAuditEventV0 = AuditEventV0;
