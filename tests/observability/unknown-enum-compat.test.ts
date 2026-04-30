import { describe, expect, it } from "vitest";

import {
  parseAlertLifecycleV0,
  parseBudgetBehaviorV0,
  parseObservabilityObjectKindV0,
  parseObservabilitySeverityV0,
  parseRedactionStateV0,
  validateAlertV0,
  validateBudgetDecisionV0,
} from "@/contracts/observability.js";

const audit = {
  eventId: "audit-1",
  eventType: "observability.recorded",
  recordedAt: "2026-04-30T00:00:00.000Z",
  correlationId: "corr-1",
  actorId: "user-1",
  principalId: "service-1",
  action: "observability.capture",
  target: "workspace:workspace-1",
  outcome: "recorded",
  reasonCode: null,
  redaction: {
    containsSensitiveData: false,
    state: "clear",
    redactionCount: 0,
    redactedPaths: [],
  },
};

describe("observability unknown enum compatibility", () => {
  it("preserves unknown additive enum strings for tolerant readers", () => {
    expect(parseObservabilityObjectKindV0("metric_series")).toBe("metric_series");
    expect(parseObservabilityObjectKindV0("upgrade_snapshot")).toBe("upgrade_snapshot");
    expect(parseBudgetBehaviorV0("block")).toBe("block");
    expect(parseBudgetBehaviorV0("soft_cap")).toBe("soft_cap");
    expect(parseAlertLifecycleV0("triggered")).toBe("triggered");
    expect(parseAlertLifecycleV0("suppressed")).toBe("suppressed");
    expect(parseObservabilitySeverityV0("error")).toBe("error");
    expect(parseObservabilitySeverityV0("page")).toBe("page");
    expect(parseRedactionStateV0("summary_only")).toBe("summary_only");
    expect(parseRedactionStateV0("tokenized")).toBe("tokenized");
  });

  it("keeps records readable when future additive enum values appear", () => {
    expect(validateAlertV0({
      schema: "pluto.observability.alert",
      schemaVersion: 0,
      kind: "alert",
      id: "alert-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      alertKey: "future-alert",
      lifecycle: "suppressed",
      severity: "page",
      sourceRef: null,
      summary: "Reader should tolerate future enum values.",
      firstObservedAt: "2026-04-30T00:00:00.000Z",
      lastObservedAt: "2026-04-30T00:00:01.000Z",
      acknowledgedAt: null,
      resolvedAt: null,
    }).ok).toBe(true);

    expect(validateBudgetDecisionV0({
      schema: "pluto.observability.budget-decision",
      schemaVersion: 0,
      kind: "budget_decision",
      id: "budget-decision-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit: {
        ...audit,
        redaction: {
          containsSensitiveData: true,
          state: "tokenized",
          redactionCount: 1,
          redactedPaths: ["policy.overrideToken"],
        },
      },
      budgetId: "budget-1",
      snapshotId: null,
      subjectRef: { kind: "run_health_summary", id: "run-health-1" },
      behavior: "soft_cap",
      overrideRequired: false,
      reason: "Future additive policy mode.",
      decidedAt: "2026-04-30T00:00:02.000Z",
    }).ok).toBe(true);
  });
});
