import { describe, expect, it } from "vitest";

import { evaluateBootstrapReadinessV0 } from "@/bootstrap/readiness-gates.js";

describe("bootstrap readiness fail-closed gates", () => {
  it("fails closed when the policy fixture is missing", () => {
    const result = evaluateBootstrapReadinessV0({
      workspaceId: "workspace-1",
      sessionId: "bootstrap-session-1",
      budget: { storageVersion: "local-v0", state: "ready" },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.blockingReason).toBe("policy_blocked");
    expect(result.failure.resolutionHint).toContain("Missing policy status");
  });

  it("fails closed when the budget fixture is missing", () => {
    const result = evaluateBootstrapReadinessV0({
      workspaceId: "workspace-1",
      sessionId: "bootstrap-session-1",
      policy: { storageVersion: "local-v0", state: "ready" },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.blockingReason).toBe("budget_blocked");
    expect(result.failure.resolutionHint).toContain("Missing budget status");
  });

  it("fails closed when a local-v0 policy fixture reports blocked", () => {
    const result = evaluateBootstrapReadinessV0({
      workspaceId: "workspace-1",
      sessionId: "bootstrap-session-1",
      policy: {
        storageVersion: "local-v0",
        state: "blocked",
        reason: "operator review has not cleared the runtime policy yet",
      },
      budget: { storageVersion: "local-v0", state: "ready" },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.blockingReason).toBe("policy_blocked");
    expect(result.failure.resolutionHint).toContain("operator review has not cleared the runtime policy yet");
  });

  it("fails closed when a budget fixture does not come from local-v0", () => {
    const result = evaluateBootstrapReadinessV0({
      workspaceId: "workspace-1",
      sessionId: "bootstrap-session-1",
      policy: { storageVersion: "local-v0", state: "ready" },
      budget: { storageVersion: "future-v1", state: "ready" },
      now: "2026-04-30T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.failure.blockingReason).toBe("budget_blocked");
    expect(result.failure.resolutionHint).toContain("Unsupported budget fixture source: future-v1");
  });
});
