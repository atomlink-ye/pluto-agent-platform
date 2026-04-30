import { describe, expect, it } from "vitest";

import type {
  MembershipBindingV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "@/contracts/identity.js";
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
const workspace: WorkspaceRecordV0 = {
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
};

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
    role: "reviewer",
    permissions: [],
    ...overrides,
  };
}

function authorize(role: MembershipBindingV0["role"], action: Parameters<typeof authorizeActionV0>[0]["action"], permissions: MembershipBindingV0["permissions"] = []) {
  return authorizeActionV0({
    now,
    workspaceId,
    principal: actor,
    resource,
    action,
    workspace,
    bindings: [binding({ role, permissions })],
  });
}

describe("authorizeActionV0", () => {
  it("maps fixed roles to the required read, write, review, approval, publish, run, membership, and token permissions", () => {
    expect(authorize("viewer", "workspace.read").allowed).toBe(true);
    expect(authorize("viewer", "workspace.write").reasonCode).toBe("insufficient_role");

    expect(authorize("editor", "workspace.write").allowed).toBe(true);
    expect(authorize("editor", "runs.trigger").allowed).toBe(true);
    expect(authorize("editor", "governance.review").reasonCode).toBe("insufficient_role");

    expect(authorize("reviewer", "governance.review").allowed).toBe(true);
    expect(authorize("reviewer", "governance.approve").reasonCode).toBe("insufficient_role");

    expect(authorize("approver", "governance.review").allowed).toBe(true);
    expect(authorize("approver", "governance.approve").allowed).toBe(true);
    expect(authorize("approver", "governance.publish").reasonCode).toBe("insufficient_role");

    expect(authorize("publisher", "workspace.write").allowed).toBe(true);
    expect(authorize("publisher", "governance.publish").allowed).toBe(true);
    expect(authorize("publisher", "runs.trigger").allowed).toBe(true);
    expect(authorize("publisher", "governance.approve").reasonCode).toBe("insufficient_role");

    expect(authorize("admin", "workspace.read").allowed).toBe(true);
    expect(authorize("admin", "workspace.write").allowed).toBe(true);
    expect(authorize("admin", "governance.review").allowed).toBe(true);
    expect(authorize("admin", "runs.trigger").allowed).toBe(true);
    expect(authorize("admin", "membership.manage").allowed).toBe(true);
    expect(authorize("admin", "token.manage").allowed).toBe(true);
    expect(authorize("admin", "permit.manage").allowed).toBe(true);
    expect(authorize("admin", "record.delete").allowed).toBe(true);
    expect(authorize("admin", "governance.approve").reasonCode).toBe("insufficient_role");
    expect(authorize("admin", "governance.publish").reasonCode).toBe("insufficient_role");
  });

  it("allows actions from the union of active bindings and canonical role permissions", () => {
    const decision = authorizeActionV0({
      now,
      workspaceId,
      principal: actor,
      resource,
      action: "governance.approve",
      workspace,
      bindings: [
        binding({ id: "bind_review", role: "reviewer" }),
        binding({ id: "bind_approve", role: "viewer", permissions: ["governance.approve"] }),
      ],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("allowed");
    expect(decision.effectivePermissions).toEqual([
      "governance.approve",
      "governance.review",
      "workspace.read",
    ]);
    expect(decision.matchedBindingIds).toEqual(["bind_approve", "bind_review"]);
  });

  it("fails closed for unknown roles unless an explicit permission grant covers the action", () => {
    expect(authorize("delegated_reviewer", "governance.review").allowed).toBe(false);
    expect(authorize("delegated_reviewer", "governance.review", ["governance.review"]).allowed).toBe(true);
  });

  it("returns explicit reason codes for missing workspace, mismatch, and insufficient role", () => {
    expect(authorizeActionV0({
      now,
      workspaceId,
      principal: actor,
      resource,
      action: "workspace.read",
      workspace: null,
      bindings: [],
    }).reasonCode).toBe("missing_workspace");

    expect(authorizeActionV0({
      now,
      workspaceId,
      principal: actor,
      resource: { ...resource, workspaceId: "ws_other" },
      action: "workspace.read",
      workspace,
      bindings: [binding({ role: "viewer" })],
    }).reasonCode).toBe("workspace_mismatch");

    expect(authorizeActionV0({
      now,
      workspaceId,
      principal: actor,
      resource,
      action: "membership.manage",
      workspace,
      bindings: [binding({ role: "reviewer" })],
    }).reasonCode).toBe("insufficient_role");
  });
});
