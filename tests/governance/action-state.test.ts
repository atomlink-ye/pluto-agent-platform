import { describe, expect, it } from "vitest";

import { buildActionState, buildPageState } from "@/governance/projections.js";

describe("action and page state", () => {
  it("uses evidence_missing when no current version is available for an action", () => {
    expect(buildActionState({ hasCurrentVersion: false })).toEqual({
      enabled: false,
      state: "disabled",
      reason: "evidence_missing",
    });
  });

  it("uses approval_missing when approval is required but absent", () => {
    expect(buildActionState({ hasCurrentVersion: true, hasApproval: false, hasEvidence: true })).toEqual({
      enabled: false,
      state: "disabled",
      reason: "approval_missing",
    });
  });

  it("uses runtime_unavailable when runtime support is degraded", () => {
    expect(buildActionState({ hasCurrentVersion: true, hasApproval: true, runtimeAvailable: false })).toEqual({
      enabled: false,
      state: "degraded",
      reason: "runtime_unavailable",
    });
  });

  it("derives page state for empty, blocked, degraded, not found, and error views", () => {
    expect(buildPageState({ hasItems: false })).toBe("empty");
    expect(buildPageState({ hasDocument: false })).toBe("not_found");
    expect(buildPageState({ governanceStatus: "blocked" })).toBe("blocked");
    expect(buildPageState({ runtimeAvailable: false })).toBe("degraded");
    expect(buildPageState({ hasError: true })).toBe("error");
    expect(buildPageState({ hasDocument: true, hasItems: true, governanceStatus: "ready" })).toBe("ready");
  });
});
