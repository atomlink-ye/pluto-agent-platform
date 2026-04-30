import type {
  ApiTokenRecordV0,
  MembershipBindingV0,
  PermissionLikeV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "../contracts/identity.js";

export const PRIVILEGED_LIFECYCLE_AUDIT_EVENT_TYPES_V0 = [
  "membership_granted",
  "membership_revoked",
  "token_issued",
  "token_rotated",
  "token_revoked",
  "workspace_suspended",
  "workspace_activated",
  "service_account_activated",
  "service_account_revoked",
  "permit_granted",
  "permit_revoked",
  "approval_recorded",
  "publish_decision_recorded",
] as const;

export type PrivilegedLifecycleAuditEventTypeV0 = typeof PRIVILEGED_LIFECYCLE_AUDIT_EVENT_TYPES_V0[number];

export interface PrivilegedLifecycleAuditEventV0 {
  schemaVersion: 0;
  eventType: PrivilegedLifecycleAuditEventTypeV0;
  workspaceId: string;
  occurredAt: string;
  actorRef: PrincipalRefV0;
  subjectRef: PrincipalRefV0 | WorkspaceScopedRefV0;
  objectRef: WorkspaceScopedRefV0;
  details: Record<string, string | null>;
}

export interface PermitAuditInputV0 {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  subjectRef: PrincipalRefV0;
  permitRef: WorkspaceScopedRefV0;
  permission: PermissionLikeV0;
}

export interface ApprovalAuditInputV0 {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  approvalRef: WorkspaceScopedRefV0;
  approverRef: PrincipalRefV0;
  documentRef: WorkspaceScopedRefV0;
}

export interface PublishDecisionAuditInputV0 {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  decisionRef: WorkspaceScopedRefV0;
  documentRef: WorkspaceScopedRefV0;
  outcome: "approved" | "rejected" | "blocked" | (string & {});
}

export function membershipGrantedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  binding: MembershipBindingV0;
}): PrivilegedLifecycleAuditEventV0 {
  return fromBinding("membership_granted", input, {
    role: input.binding.role,
    permissions: input.binding.permissions.slice().sort((left, right) => left.localeCompare(right)).join(","),
  });
}

export function membershipRevokedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  binding: MembershipBindingV0;
}): PrivilegedLifecycleAuditEventV0 {
  return fromBinding("membership_revoked", input, {
    role: input.binding.role,
    revokedAt: input.binding.revokedAt ?? input.occurredAt,
  });
}

export function tokenIssuedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  token: ApiTokenRecordV0;
}): PrivilegedLifecycleAuditEventV0 {
  return fromToken("token_issued", input, {
    label: input.token.label,
    tokenPrefix: input.token.tokenPrefix,
  });
}

export function tokenRotatedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  token: ApiTokenRecordV0;
}): PrivilegedLifecycleAuditEventV0 {
  return fromToken("token_rotated", input, {
    replacedByTokenId: input.token.replacedByTokenId ?? null,
    rotatedAt: input.token.rotatedAt ?? input.occurredAt,
  });
}

export function tokenRevokedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  token: ApiTokenRecordV0;
}): PrivilegedLifecycleAuditEventV0 {
  return fromToken("token_revoked", input, {
    revokedAt: input.token.revokedAt ?? input.occurredAt,
    verificationState: input.token.verification.verificationState,
  });
}

export function workspaceSuspendedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  workspace: WorkspaceRecordV0;
}): PrivilegedLifecycleAuditEventV0 {
  return fromWorkspace("workspace_suspended", input, {
    suspendedAt: input.workspace.suspendedAt ?? input.occurredAt,
    status: input.workspace.status,
  });
}

export function workspaceActivatedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  workspace: WorkspaceRecordV0;
}): PrivilegedLifecycleAuditEventV0 {
  return fromWorkspace("workspace_activated", input, {
    status: input.workspace.status,
  });
}

export function serviceAccountActivatedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  serviceAccountRef: PrincipalRefV0;
}): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType: "service_account_activated",
    workspaceId: input.serviceAccountRef.workspaceId,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: input.serviceAccountRef,
    objectRef: toPrincipalObjectRef(input.serviceAccountRef),
    details: {},
  };
}

export function serviceAccountRevokedAuditEventV0(input: {
  occurredAt: string;
  actorRef: PrincipalRefV0;
  serviceAccountRef: PrincipalRefV0;
}): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType: "service_account_revoked",
    workspaceId: input.serviceAccountRef.workspaceId,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: input.serviceAccountRef,
    objectRef: toPrincipalObjectRef(input.serviceAccountRef),
    details: {},
  };
}

export function permitGrantedAuditEventV0(input: PermitAuditInputV0): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType: "permit_granted",
    workspaceId: input.permitRef.workspaceId,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: input.subjectRef,
    objectRef: input.permitRef,
    details: {
      permission: input.permission,
    },
  };
}

export function permitRevokedAuditEventV0(input: PermitAuditInputV0): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType: "permit_revoked",
    workspaceId: input.permitRef.workspaceId,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: input.subjectRef,
    objectRef: input.permitRef,
    details: {
      permission: input.permission,
    },
  };
}

export function approvalRecordedAuditEventV0(input: ApprovalAuditInputV0): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType: "approval_recorded",
    workspaceId: input.approvalRef.workspaceId,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: input.approverRef,
    objectRef: input.approvalRef,
    details: {
      documentId: input.documentRef.id,
    },
  };
}

export function publishDecisionRecordedAuditEventV0(input: PublishDecisionAuditInputV0): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType: "publish_decision_recorded",
    workspaceId: input.decisionRef.workspaceId,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: input.documentRef,
    objectRef: input.decisionRef,
    details: {
      outcome: input.outcome,
      documentId: input.documentRef.id,
    },
  };
}

function fromBinding(
  eventType: "membership_granted" | "membership_revoked",
  input: { occurredAt: string; actorRef: PrincipalRefV0; binding: MembershipBindingV0 },
  details: Record<string, string | null>,
): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType,
    workspaceId: input.binding.workspaceId,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: input.binding.principal,
    objectRef: {
      workspaceId: input.binding.workspaceId,
      kind: input.binding.kind,
      id: input.binding.id,
    },
    details,
  };
}

function fromToken(
  eventType: "token_issued" | "token_rotated" | "token_revoked",
  input: { occurredAt: string; actorRef: PrincipalRefV0; token: ApiTokenRecordV0 },
  details: Record<string, string | null>,
): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType,
    workspaceId: input.token.workspaceId,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: input.token.principal,
    objectRef: {
      workspaceId: input.token.workspaceId,
      kind: input.token.kind,
      id: input.token.id,
    },
    details,
  };
}

function fromWorkspace(
  eventType: "workspace_suspended" | "workspace_activated",
  input: { occurredAt: string; actorRef: PrincipalRefV0; workspace: WorkspaceRecordV0 },
  details: Record<string, string | null>,
): PrivilegedLifecycleAuditEventV0 {
  return {
    schemaVersion: 0,
    eventType,
    workspaceId: input.workspace.id,
    occurredAt: input.occurredAt,
    actorRef: input.actorRef,
    subjectRef: {
      workspaceId: input.workspace.id,
      kind: "workspace",
      id: input.workspace.id,
    },
    objectRef: {
      workspaceId: input.workspace.id,
      kind: input.workspace.kind,
      id: input.workspace.id,
    },
    details,
  };
}

function toPrincipalObjectRef(principalRef: PrincipalRefV0): WorkspaceScopedRefV0 {
  return {
    workspaceId: principalRef.workspaceId,
    kind: principalRef.kind,
    id: principalRef.principalId,
  };
}
