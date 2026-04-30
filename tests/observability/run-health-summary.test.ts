import { describe, expect, it } from "vitest";

import { validateRunHealthSummaryV0 } from "@/contracts/observability.js";
import { buildRunHealthSummaryV0 } from "@/observability/summaries.js";

const audit = {
  eventId: "audit-run-health-1",
  eventType: "run_health_summary.recorded",
  recordedAt: "2026-04-30T00:10:00.000Z",
  correlationId: "corr-run-health-1",
  actorId: null,
  principalId: "service-observability",
  action: "run.observe",
  target: "run-health",
  outcome: "recorded",
  reasonCode: "health_rollup",
  redaction: {
    containsSensitiveData: false,
    state: "clear" as const,
    redactionCount: 0,
    redactedPaths: [],
  },
};

describe("buildRunHealthSummaryV0", () => {
  it("builds low-cardinality summaries from run status, blocker, retries, and time window", () => {
    const summary = buildRunHealthSummaryV0({
      id: "run-health-1",
      workspaceId: "workspace-1",
      audit,
      run: {
        runId: "run-1",
        status: "done",
        blockerReason: null,
        startedAt: "2026-04-30T00:00:00.000Z",
        finishedAt: "2026-04-30T00:04:00.000Z",
        parseWarnings: 0,
      },
      retryCount: 2,
      traceRef: { kind: "redacted_trace", id: "trace-1" },
      evidenceRefs: ["sealed-evidence-1"],
    });

    expect(validateRunHealthSummaryV0(summary).ok).toBe(true);
    expect(summary.status).toBe("succeeded");
    expect(summary.severity).toBe("info");
    expect(summary.summary).toBe("status=succeeded; blocker=none; retries=2_3; window=medium");
  });

  it("keeps blocked retryable runs warning-level without leaking high-cardinality detail", () => {
    const summary = buildRunHealthSummaryV0({
      id: "run-health-2",
      workspaceId: "workspace-1",
      audit,
      run: {
        runId: "run-2",
        status: "blocked",
        blockerReason: "runtime_timeout",
        startedAt: "2026-04-30T00:00:00.000Z",
        finishedAt: "2026-04-30T00:00:20.000Z",
        parseWarnings: 3,
      },
      retryCount: 4,
    });

    expect(summary.severity).toBe("warn");
    expect(summary.summary).toBe("status=blocked; blocker=runtime_timeout; retries=4_plus; window=short");
    expect(summary.summary.includes("00:00:20")).toBe(false);
  });
});
