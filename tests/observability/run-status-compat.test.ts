import { describe, expect, it } from "vitest";

import {
  normalizeRunHealthSummaryStatusV0,
  validateRunHealthSummaryV0,
} from "@/contracts/observability.js";

const baseSummary = {
  schema: "pluto.observability.run-health-summary" as const,
  schemaVersion: 0 as const,
  kind: "run_health_summary" as const,
  id: "run-health-legacy",
  workspaceId: "workspace-1",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  audit: {
    eventId: "audit-1",
    eventType: "run_health_summary.recorded",
    recordedAt: "2026-04-30T00:00:00.000Z",
    correlationId: "corr-1",
    actorId: "user-1",
    principalId: "service-1",
    action: "run.observe",
    target: "run-1",
    outcome: "done",
    reasonCode: null,
    redaction: {
      containsSensitiveData: false,
      state: "clear",
      redactionCount: 0,
      redactedPaths: [],
    },
  },
  runId: "run-1",
  severity: "info",
  blockerReason: null,
  summary: "Legacy run completed before succeeded became reader-facing.",
  traceRef: null,
  evidenceRefs: ["evidence:run-1-summary"],
  observedAt: "2026-04-30T00:00:01.000Z",
};

describe("observability run status compatibility", () => {
  it("treats legacy done as a synonym for succeeded", () => {
    expect(normalizeRunHealthSummaryStatusV0("done")).toBe("succeeded");
    expect(normalizeRunHealthSummaryStatusV0("succeeded")).toBe("succeeded");
  });

  it("keeps legacy done records readable without mutating stored values", () => {
    const legacy = { ...baseSummary, status: "done" };
    expect(validateRunHealthSummaryV0(legacy).ok).toBe(true);
    expect(legacy.status).toBe("done");
    expect(normalizeRunHealthSummaryStatusV0(legacy.status)).toBe("succeeded");
  });

  it("passes through existing statuses and future additive values", () => {
    expect(normalizeRunHealthSummaryStatusV0("blocked")).toBe("blocked");
    expect(normalizeRunHealthSummaryStatusV0("degraded")).toBe("degraded");
    expect(normalizeRunHealthSummaryStatusV0(42)).toBeNull();
  });
});
