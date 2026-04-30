import type { PermissionLikeV0, RoleLikeV0 } from "../contracts/identity.js";

export const ROLE_PERMISSION_MATRIX_V0 = {
  viewer: ["workspace.read"],
  editor: ["workspace.read", "workspace.write", "runs.trigger"],
  reviewer: ["workspace.read", "governance.review"],
  approver: ["workspace.read", "governance.review", "governance.approve"],
  publisher: ["workspace.read", "workspace.write", "governance.publish", "runs.trigger"],
  admin: [
    "workspace.read",
    "workspace.write",
    "governance.review",
    "runs.trigger",
    "membership.manage",
    "token.manage",
    "permit.manage",
    "record.delete",
  ],
} as const satisfies Record<string, readonly PermissionLikeV0[]>;

export type CanonicalRoleV0 = keyof typeof ROLE_PERMISSION_MATRIX_V0;

export function permissionsForRoleV0(role: RoleLikeV0): PermissionLikeV0[] {
  const permissions = ROLE_PERMISSION_MATRIX_V0[role as CanonicalRoleV0];
  return permissions ? [...permissions] : [];
}
