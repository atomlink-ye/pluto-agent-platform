import { describe, expect, it } from "vitest";

import type {
  ApiTokenRecordV0,
  MembershipBindingV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "@/contracts/identity.js";
import { authorizeActionV0 } from "@/identity/authorization.js";

const now = "2026-04-30T12:00:00.000Z";
const workspaceId = "ws_local_alpha";
const serviceAccount: PrincipalRefV0 = {
  workspaceId,
  kind: "service_account",
  principalId: "sa_01JTS9X23Q8A7",
};
const actorRef: PrincipalRefV0 = {
  workspaceId,
  kind: "user",
  principalId: "user_01JTS9X1TK6D2",
};
const resource: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "publish_package",
  id: "pkg_01",
};
const workspace: WorkspaceRecordV0 = {
  schemaVersion: 0,
  kind: "workspace",
  id: workspaceId,
  orgId: "org_01JTS9X1HFW9Q",
  slug: "core-platform",
  displayName: "Core Platform",
  ownerRef: actorRef,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
};
const binding: MembershipBindingV0 = {
  schemaVersion: 0,
  kind: "membership_binding",
  id: "bind_sa_publish",
  orgId: "org_01JTS9X1HFW9Q",
  workspaceId,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
  principal: serviceAccount,
  role: "publisher",
  permissions: [],
};

function token(overrides: Partial<ApiTokenRecordV0> = {}): ApiTokenRecordV0 {
  return {
    schemaVersion: 0,
    kind: "api_token",
    id: "tok_publish_01",
    orgId: "org_01JTS9X1HFW9Q",
    workspaceId,
    label: "publisher token",
    status: "active",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:05:00.000Z",
    tokenPrefix: "pluto_pub_",
    tokenHash: "sha256:publish",
    verification: {
      hashAlgorithm: "sha256",
      verificationState: "verified",
      verifiedAt: "2026-04-30T00:00:01.000Z",
      lastUsedAt: null,
    },
    allowedActions: ["governance.publish"],
    principal: serviceAccount,
    actorRef,
    ...overrides,
  };
}

describe("token-scoped authorization", () => {
  it("allows an action only when both binding permissions and token scope allow it", () => {
    const decision = authorizeActionV0({
      now,
      workspaceId,
      principal: serviceAccount,
      resource,
      action: "governance.publish",
      workspace,
      bindings: [binding],
      token: token(),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("allowed");
    expect(decision.tokenId).toBe("tok_publish_01");
  });

  it("fails closed when token scope is narrower than the binding permission set", () => {
    const decision = authorizeActionV0({
      now,
      workspaceId,
      principal: serviceAccount,
      resource,
      action: "workspace.write",
      workspace,
      bindings: [binding],
      token: token({ allowedActions: ["governance.publish"] }),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("token_scope_exceeded");
    expect(decision.effectivePermissions).toContain("workspace.write");
  });

  it("returns expired_token for an otherwise valid token after expiry", () => {
    const decision = authorizeActionV0({
      now,
      workspaceId,
      principal: serviceAccount,
      resource,
      action: "governance.publish",
      workspace,
      bindings: [binding],
      token: token({ expiresAt: "2026-04-30T11:59:59.000Z" }),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("expired_token");
  });
});
