import { describe, expect, it } from "vitest";

import { validateAdapterHealthSummaryV0, validateAlertV0 } from "@/contracts/observability.js";
import {
  buildAdapterUnreachabilityAlertV0,
  buildBudgetBreachAlertV0,
  buildEvidenceReadinessDropAlertV0,
  buildIngestionFailureAlertV0,
} from "@/observability/alerts.js";
import {
  buildAdapterHealthSummaryV0,
  buildEvidenceReadinessSummaryV0,
} from "@/observability/summaries.js";

const audit = {
  eventId: "audit-adapter-health-1",
  eventType: "adapter_health.recorded",
  recordedAt: "2026-04-30T00:20:00.000Z",
  correlationId: "corr-adapter-health-1",
  actorId: null,
  principalId: "service-observability",
  action: "adapter.observe",
  target: "adapter-1",
  outcome: "recorded",
  reasonCode: "health_rollup",
  redaction: {
    containsSensitiveData: true,
    state: "summary_only" as const,
    redactionCount: 2,
    redactedPaths: ["provider.stderr", "credentials.apiKey"],
  },
};

describe("adapter health summaries and alerts", () => {
  it("redacts adapter reason classes and emits prolonged unreachability alerts", () => {
    const summary = buildAdapterHealthSummaryV0({
      id: "adapter-health-1",
      workspaceId: "workspace-1",
      audit,
      adapterId: "adapter-1",
      adapterKind: "paseo-opencode",
      status: "unreachable",
      unreachableSince: "2026-04-30T00:00:00.000Z",
      consecutiveFailures: 5,
      observedAt: "2026-04-30T00:20:00.000Z",
      lastError: {
        message: "ECONNREFUSED from provider stderr token=secret-value",
        code: 503,
      },
    });

    expect(validateAdapterHealthSummaryV0(summary).ok).toBe(true);
    expect(summary.reasonClass).toBe("provider_unavailable");
    expect(summary.alertable).toBe(true);
    expect(summary.summary).toBe("status=unreachable; reason_class=provider_unavailable; failures=4_plus; window=prolonged");
    expect(summary.summary.includes("secret-value")).toBe(false);

    const alert = buildAdapterUnreachabilityAlertV0({
      id: "alert-adapter-1",
      workspaceId: "workspace-1",
      audit,
      summary,
    });

    expect(alert).not.toBeNull();
    expect(validateAlertV0(alert).ok).toBe(true);
    expect(alert?.summary).toBe("adapter=paseo-opencode; status=unreachable; reason_class=provider_unavailable; window=prolonged");
    expect(alert?.summary.includes("stderr")).toBe(false);
  });

  it("creates redacted alerts for evidence readiness drops, budget breaches, and ingestion failures", () => {
    const evidenceSummary = buildEvidenceReadinessSummaryV0({
      packet: {
        runId: "run-2",
        status: "done",
        blockerReason: null,
        workers: [],
        validation: { outcome: "pass", reason: null },
        generatedAt: "2026-04-30T00:21:00.000Z",
      },
      sealedEvidence: null,
      readiness: { governanceReady: false, ingestionOk: true },
    });

    const readinessAlert = buildEvidenceReadinessDropAlertV0({
      id: "alert-evidence-1",
      workspaceId: "workspace-1",
      audit,
      summary: evidenceSummary,
      previousReadiness: "ready",
      sourceRef: { kind: "run_health_summary", id: "run-health-2" },
    });
    const budgetAlert = buildBudgetBreachAlertV0({
      id: "alert-budget-1",
      workspaceId: "workspace-1",
      audit,
      budgetId: "workspace-monthly-spend",
      behavior: "require_override",
      observedAt: "2026-04-30T00:21:30.000Z",
      sourceRef: { kind: "budget_snapshot", id: "budget-snapshot-1" },
    });
    const ingestionAlert = buildIngestionFailureAlertV0({
      id: "alert-ingestion-1",
      workspaceId: "workspace-1",
      audit,
      failureClass: "validation_failed",
      observedAt: "2026-04-30T00:22:00.000Z",
    });

    expect(readinessAlert).not.toBeNull();
    expect(validateAlertV0(readinessAlert).ok).toBe(true);
    expect(readinessAlert?.summary).toBe("run=run-2; readiness=blocked; validation=pass; sealed=no; redacted=no");
    expect(validateAlertV0(budgetAlert).ok).toBe(true);
    expect(budgetAlert.summary).toBe("budget=workspace-monthly-spend; behavior=require_override; state=breached");
    expect(validateAlertV0(ingestionAlert).ok).toBe(true);
    expect(ingestionAlert.summary).toBe("failure_class=validation_failed; state=ingestion_failed");
  });
});
