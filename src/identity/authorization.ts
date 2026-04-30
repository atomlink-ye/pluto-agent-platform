import type {
  ApiTokenRecordV0,
  IdentityStatusV0,
  MembershipBindingV0,
  PermissionLikeV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "../contracts/identity.js";

import { permissionsForRoleV0 } from "./role-matrix.js";

export const AUTHORIZATION_REASON_CODES_V0 = [
  "allowed",
  "denied",
  "suspended_workspace",
  "revoked_binding",
  "expired_token",
  "missing_workspace",
  "workspace_mismatch",
  "insufficient_role",
  "token_scope_exceeded",
] as const;

export type AuthorizationReasonCodeV0 = typeof AUTHORIZATION_REASON_CODES_V0[number];

export interface AuthorizationActorLifecycleV0 {
  status?: IdentityStatusV0 | null;
  suspendedAt?: string | null;
  revokedAt?: string | null;
}

export interface AuthorizationRequestV0 {
  now: string;
  workspaceId: string;
  principal: PrincipalRefV0;
  resource: WorkspaceScopedRefV0;
  action: PermissionLikeV0;
  workspace: WorkspaceRecordV0 | null;
  bindings: MembershipBindingV0[];
  token?: ApiTokenRecordV0 | null;
  principalLifecycle?: AuthorizationActorLifecycleV0 | null;
}

export interface AuthorizationDecisionV0 {
  schemaVersion: 0;
  allowed: boolean;
  reasonCode: AuthorizationReasonCodeV0;
  evaluatedAt: string;
  workspaceId: string;
  action: PermissionLikeV0;
  principal: PrincipalRefV0;
  resource: WorkspaceScopedRefV0;
  effectivePermissions: PermissionLikeV0[];
  matchedBindingIds: string[];
  tokenId: string | null;
}

export function authorizeActionV0(request: AuthorizationRequestV0): AuthorizationDecisionV0 {
  const matchingBindings = request.bindings.filter((binding) => isBindingForPrincipal(request, binding));

  if (request.workspace === null) {
    return deny(request, "missing_workspace", matchingBindings, []);
  }

  if (!workspaceMatches(request)) {
    return deny(request, "workspace_mismatch", matchingBindings, []);
  }

  if (isWorkspaceSuspended(request.workspace, request.now)) {
    return deny(request, "suspended_workspace", matchingBindings, []);
  }

  if (isLifecycleBlocked(request.principalLifecycle, request.now)) {
    return deny(request, "denied", matchingBindings, []);
  }

  const revokedBindings = matchingBindings.filter((binding) => isBindingRevoked(binding, request.now));
  const activeBindings = matchingBindings.filter((binding) => isBindingActive(binding, request.now));

  if (activeBindings.length === 0 && revokedBindings.length > 0) {
    return deny(request, "revoked_binding", matchingBindings, []);
  }

  const effectivePermissions = collectEffectivePermissionsV0(activeBindings);
  if (!effectivePermissions.includes(request.action)) {
    const reasonCode: AuthorizationReasonCodeV0 = matchingBindings.length === 0 ? "insufficient_role" : "insufficient_role";
    return deny(request, reasonCode, activeBindings, effectivePermissions);
  }

  if (request.token) {
    if (!tokenMatches(request)) {
      return deny(request, "denied", activeBindings, effectivePermissions);
    }

    if (isTokenExpired(request.token, request.now)) {
      return deny(request, "expired_token", activeBindings, effectivePermissions);
    }

    if (isTokenRevokedOrInvalid(request.token, request.now)) {
      return deny(request, "denied", activeBindings, effectivePermissions);
    }

    if (!request.token.allowedActions.includes(request.action)) {
      return deny(request, "token_scope_exceeded", activeBindings, effectivePermissions);
    }
  }

  return {
    schemaVersion: 0,
    allowed: true,
    reasonCode: "allowed",
    evaluatedAt: request.now,
    workspaceId: request.workspaceId,
    action: request.action,
    principal: request.principal,
    resource: request.resource,
    effectivePermissions,
    matchedBindingIds: activeBindings.map((binding) => binding.id).sort((left, right) => left.localeCompare(right)),
    tokenId: request.token?.id ?? null,
  };
}

export function collectEffectivePermissionsV0(bindings: MembershipBindingV0[]): PermissionLikeV0[] {
  const permissions = new Set<PermissionLikeV0>();

  for (const binding of bindings) {
    for (const permission of permissionsForRoleV0(binding.role)) {
      permissions.add(permission);
    }
    for (const permission of binding.permissions) {
      permissions.add(permission);
    }
  }

  return [...permissions].sort((left, right) => left.localeCompare(right));
}

function deny(
  request: AuthorizationRequestV0,
  reasonCode: AuthorizationReasonCodeV0,
  bindings: MembershipBindingV0[],
  effectivePermissions: PermissionLikeV0[],
): AuthorizationDecisionV0 {
  return {
    schemaVersion: 0,
    allowed: false,
    reasonCode,
    evaluatedAt: request.now,
    workspaceId: request.workspaceId,
    action: request.action,
    principal: request.principal,
    resource: request.resource,
    effectivePermissions: [...effectivePermissions],
    matchedBindingIds: bindings.map((binding) => binding.id).sort((left, right) => left.localeCompare(right)),
    tokenId: request.token?.id ?? null,
  };
}

function workspaceMatches(request: AuthorizationRequestV0): boolean {
  if (request.workspace?.id !== request.workspaceId) {
    return false;
  }

  if (request.principal.workspaceId !== request.workspaceId) {
    return false;
  }

  if (request.resource.workspaceId !== request.workspaceId) {
    return false;
  }

  if (request.token && request.token.workspaceId !== request.workspaceId) {
    return false;
  }

  return true;
}

function tokenMatches(request: AuthorizationRequestV0): boolean {
  const token = request.token;
  if (!token) {
    return true;
  }

  return token.principal.workspaceId === request.workspaceId
    && token.principal.kind === request.principal.kind
    && token.principal.principalId === request.principal.principalId;
}

function isBindingForPrincipal(request: AuthorizationRequestV0, binding: MembershipBindingV0): boolean {
  return binding.workspaceId === request.workspaceId
    && binding.principal.workspaceId === request.workspaceId
    && binding.principal.kind === request.principal.kind
    && binding.principal.principalId === request.principal.principalId;
}

function isWorkspaceSuspended(workspace: WorkspaceRecordV0, now: string): boolean {
  return workspace.status === "suspended" || hasReached(workspace.suspendedAt, now);
}

function isBindingActive(binding: MembershipBindingV0, now: string): boolean {
  return binding.status === "active"
    && !isBindingRevoked(binding, now)
    && !hasReached(binding.expiresAt, now);
}

function isBindingRevoked(binding: MembershipBindingV0, now: string): boolean {
  return binding.status === "revoked" || hasReached(binding.revokedAt, now);
}

function isTokenExpired(token: ApiTokenRecordV0, now: string): boolean {
  return token.verification.verificationState === "expired" || hasReached(token.expiresAt, now);
}

function isTokenRevokedOrInvalid(token: ApiTokenRecordV0, now: string): boolean {
  return token.status !== "active"
    || token.verification.verificationState === "revoked"
    || token.verification.verificationState === "unverified"
    || hasReached(token.revokedAt, now)
    || hasReached(token.rotatedAt, now);
}

function isLifecycleBlocked(lifecycle: AuthorizationActorLifecycleV0 | null | undefined, now: string): boolean {
  if (!lifecycle) {
    return false;
  }

  return lifecycle.status === "suspended"
    || lifecycle.status === "revoked"
    || lifecycle.status === "disabled"
    || lifecycle.status === "archived"
    || hasReached(lifecycle.suspendedAt, now)
    || hasReached(lifecycle.revokedAt, now);
}

function hasReached(timestamp: string | null | undefined, now: string): boolean {
  return typeof timestamp === "string" && timestamp <= now;
}
