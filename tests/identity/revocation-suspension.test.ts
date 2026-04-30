import { describe, expect, it } from "vitest";

import type { MembershipBindingV0, PrincipalRefV0, WorkspaceRecordV0, WorkspaceScopedRefV0 } from "@/contracts/identity.js";
import { authorizeActionV0 } from "@/identity/authorization.js";

const now = "2026-04-30T12:00:00.000Z";
const workspaceId = "ws_local_alpha";
const actor: PrincipalRefV0 = {
  workspaceId,
  kind: "user",
  principalId: "user_01JTS9X1TK6D2",
};
const resource: WorkspaceScopedRefV0 = {
  workspaceId,
  kind: "document",
  id: "doc_01",
};

function workspace(overrides: Partial<WorkspaceRecordV0> = {}): WorkspaceRecordV0 {
  return {
    schemaVersion: 0,
    kind: "workspace",
    id: workspaceId,
    orgId: "org_01JTS9X1HFW9Q",
    slug: "core-platform",
    displayName: "Core Platform",
    ownerRef: actor,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    status: "active",
    ...overrides,
  };
}

function binding(overrides: Partial<MembershipBindingV0> = {}): MembershipBindingV0 {
  return {
    schemaVersion: 0,
    kind: "membership_binding",
    id: "bind_01",
    orgId: "org_01JTS9X1HFW9Q",
    workspaceId,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    status: "active",
    principal: actor,
    role: "editor",
    permissions: [],
    ...overrides,
  };
}

describe("revocation and suspension", () => {
  it("blocks future actions when the workspace is suspended", () => {
    const decision = authorizeActionV0({
      now,
      workspaceId,
      principal: actor,
      resource,
      action: "workspace.write",
      workspace: workspace({ status: "suspended", suspendedAt: "2026-04-30T11:00:00.000Z" }),
      bindings: [binding()],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("suspended_workspace");
  });

  it("returns revoked_binding when only historical revoked bindings remain", () => {
    const decision = authorizeActionV0({
      now,
      workspaceId,
      principal: actor,
      resource,
      action: "workspace.write",
      workspace: workspace(),
      bindings: [binding({ status: "revoked", revokedAt: "2026-04-30T10:00:00.000Z" })],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("revoked_binding");
  });

  it("preserves historical attribution while blocking suspended or revoked actors", () => {
    const decision = authorizeActionV0({
      now,
      workspaceId,
      principal: actor,
      resource,
      action: "workspace.write",
      workspace: workspace(),
      bindings: [binding()],
      principalLifecycle: {
        status: "suspended",
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("denied");
    expect(decision.principal.principalId).toBe(actor.principalId);
  });
});
