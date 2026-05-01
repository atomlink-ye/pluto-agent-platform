import { describe, expect, it } from "vitest";

import {
  SCOPED_TOOL_ACTION_FAMILIES_V0,
  allowsMutatingActionV0,
  allowsSensitiveDataV0,
  isScopedToolPermitActiveV0,
  validateScopedToolPermitV0,
} from "@/contracts/security.js";

const permit = {
  schemaVersion: 0 as const,
  kind: "scoped_tool_permit" as const,
  workspaceId: "workspace-1",
  permitId: "permit-1",
  targetSummary: {
    allow: ["workspace://src/*", "repo:pluto/*", "https://api.github.com/repos/pluto/*"],
    deny: ["workspace://secrets/*", "repo:pluto/legacy", "https://api.github.com/repos/pluto/legacy*"],
  },
  sensitivityCeiling: "confidential",
  sandboxPosture: "local_v0",
  trustBoundary: "operator_approved",
  grantedAt: "2026-04-30T00:00:00.000Z",
  expiresAt: null,
  approvalRefs: ["approval-1"],
};

describe("scoped tool permits", () => {
  it("supports the expected action families including future connector actions", () => {
    expect(SCOPED_TOOL_ACTION_FAMILIES_V0).toEqual([
      "filesystem",
      "shell",
      "browser",
      "http",
      "mcp",
      "lark",
      "github",
      "connector",
    ]);
  });

  it("fails closed when permit state, trust, or targets do not match", () => {
    const validated = validateScopedToolPermitV0({
      ...permit,
      actionFamily: "filesystem",
    });

    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error("expected valid permit fixture");
    }

    expect(isScopedToolPermitActiveV0(validated.value, "2026-04-30T12:00:00.000Z")).toBe(true);
    expect(allowsSensitiveDataV0(validated.value, "internal", "local_v0", "operator_approved")).toBe(true);
    expect(allowsMutatingActionV0(
      validated.value,
      "filesystem",
      "workspace://src/contracts/security.ts",
      "confidential",
      "local_v0",
      "operator_approved",
    )).toBe(true);

    expect(allowsMutatingActionV0(
      validated.value,
      "filesystem",
      "workspace://secrets/env",
      "confidential",
      "local_v0",
      "operator_approved",
    )).toBe(false);

    expect(allowsMutatingActionV0(
      validated.value,
      "filesystem",
      "workspace://src/contracts/security.ts",
      "restricted",
      "local_v0",
      "operator_approved",
    )).toBe(false);

    expect(allowsMutatingActionV0(
      validated.value,
      "filesystem",
      "workspace://src/contracts/security.ts",
      "internal",
      "network_egress",
      "operator_approved",
    )).toBe(false);

    expect(allowsMutatingActionV0(
      validated.value,
      "filesystem",
      "workspace://src/contracts/security.ts",
      "internal",
      "local_v0",
      "external_service",
    )).toBe(false);

    expect(isScopedToolPermitActiveV0({
      ...validated.value,
      revokedAt: "2026-04-30T12:00:00.000Z",
    })).toBe(false);

    expect(isScopedToolPermitActiveV0({
      ...validated.value,
      expiresAt: "2026-04-29T23:59:59.000Z",
    }, "2026-04-30T12:00:00.000Z")).toBe(false);
  });
});
