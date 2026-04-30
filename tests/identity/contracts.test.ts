import { describe, expect, it } from "vitest";

import {
  parsePermissionV0,
  parseRoleV0,
  validateMembershipBindingV0,
  validateOrgRecordV0,
  validateProjectRecordV0,
  validateServiceAccountRecordV0,
  validateUserRecordV0,
  validateWorkspaceRecordV0,
} from "@/contracts/identity.js";

const lifecycle = {
  schemaVersion: 0 as const,
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "active",
};

describe("identity contracts", () => {
  it("require schema markers, opaque ids, lifecycle timestamps, and workspace refs where applicable", () => {
    expect(validateOrgRecordV0({
      ...lifecycle,
      kind: "org",
      id: "org_01JTS9X1HFW9Q",
      slug: "pluto-labs",
      displayName: "Pluto Labs",
    }).ok).toBe(true);

    expect(validateWorkspaceRecordV0({
      ...lifecycle,
      kind: "workspace",
      id: "ws_01JTS9X1M5N4Q",
      orgId: "org_01JTS9X1HFW9Q",
      slug: "core-platform",
      displayName: "Core Platform",
      ownerRef: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "user",
        principalId: "user_01JTS9X1TK6D2",
      },
    }).ok).toBe(true);

    expect(validateProjectRecordV0({
      ...lifecycle,
      kind: "project",
      id: "proj_01JTS9X1R5Q2A",
      orgId: "org_01JTS9X1HFW9Q",
      workspaceId: "ws_01JTS9X1M5N4Q",
      projectKey: "identity-hardening",
      displayName: "Identity Hardening",
      groupingOnly: true,
    }).ok).toBe(true);

    expect(validateUserRecordV0({
      ...lifecycle,
      kind: "user",
      id: "user_01JTS9X1TK6D2",
      orgId: "org_01JTS9X1HFW9Q",
      displayName: "Casey Reviewer",
      primaryWorkspaceRef: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "workspace",
        id: "ws_01JTS9X1M5N4Q",
      },
    }).ok).toBe(true);

    expect(validateServiceAccountRecordV0({
      ...lifecycle,
      kind: "service_account",
      id: "sa_01JTS9X23Q8A7",
      orgId: "org_01JTS9X1HFW9Q",
      workspaceId: "ws_01JTS9X1M5N4Q",
      displayName: "Publisher Bot",
      ownerRef: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "user",
        principalId: "user_01JTS9X1TK6D2",
      },
    }).ok).toBe(true);

    expect(validateMembershipBindingV0({
      ...lifecycle,
      kind: "membership_binding",
      id: "bind_01JTS9X2B10PM",
      orgId: "org_01JTS9X1HFW9Q",
      workspaceId: "ws_01JTS9X1M5N4Q",
      principal: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "user",
        principalId: "user_01JTS9X1TK6D2",
      },
      role: "reviewer",
      permissions: ["workspace.read", "governance.review"],
    }).ok).toBe(true);
  });

  it("tolerate additive fields and preserve additive role and permission strings", () => {
    const result = validateMembershipBindingV0({
      ...lifecycle,
      kind: "membership_binding",
      id: "bind_01JTS9X2B10PM",
      orgId: "org_01JTS9X1HFW9Q",
      workspaceId: "ws_01JTS9X1M5N4Q",
      principal: {
        workspaceId: "ws_01JTS9X1M5N4Q",
        kind: "user",
        principalId: "user_01JTS9X1TK6D2",
      },
      role: "delegated_reviewer",
      permissions: ["workspace.read", "governance.comment"],
      futureField: { additive: true },
    });

    expect(result.ok).toBe(true);
    expect(parseRoleV0("admin")).toBe("admin");
    expect(parseRoleV0("delegated_reviewer")).toBe("delegated_reviewer");
    expect(parsePermissionV0("governance.approve")).toBe("governance.approve");
    expect(parsePermissionV0("governance.comment")).toBe("governance.comment");
  });

  it("fails invalid workspace-scoped refs instead of silently accepting them", () => {
    const result = validateUserRecordV0({
      ...lifecycle,
      kind: "user",
      id: "user_01JTS9X1TK6D2",
      orgId: "org_01JTS9X1HFW9Q",
      displayName: "Casey Reviewer",
      primaryWorkspaceRef: {
        workspaceId: 42,
        kind: "workspace",
        id: "ws_01JTS9X1M5N4Q",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("workspaceId must be a string");
  });
});
