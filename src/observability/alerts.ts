import type {
  AlertV0,
  CanonicalAuditEnvelopeV0,
  ObservabilitySeverityV0,
  RecordRefV0,
} from "../contracts/observability.js";
import type {
  AdapterHealthSummarySnapshotV0,
  EvidenceReadinessSummaryV0,
} from "./summaries.js";

interface AlertRecordContextV0 {
  id: string;
  workspaceId: string;
  audit: CanonicalAuditEnvelopeV0;
  createdAt?: string;
  updatedAt?: string;
}

export interface BuildAlertRecordInputV0 extends AlertRecordContextV0 {
  alertKey: string;
  severity: ObservabilitySeverityV0;
  summary: string;
  sourceRef?: RecordRefV0 | null;
  firstObservedAt: string;
  lastObservedAt?: string;
}

export interface BuildEvidenceReadinessDropAlertV0Input extends AlertRecordContextV0 {
  summary: EvidenceReadinessSummaryV0;
  sourceRef?: RecordRefV0 | null;
  previousReadiness?: EvidenceReadinessSummaryV0["readiness"] | null;
}

export interface BuildBudgetBreachAlertV0Input extends AlertRecordContextV0 {
  budgetId: string;
  behavior: string;
  observedAt: string;
  sourceRef?: RecordRefV0 | null;
}

export interface BuildIngestionFailureAlertV0Input extends AlertRecordContextV0 {
  failureClass: "parse_failed" | "validation_failed" | "storage_failed" | "unknown";
  observedAt: string;
  sourceRef?: RecordRefV0 | null;
}

export function buildAdapterUnreachabilityAlertV0(input: {
  id: string;
  workspaceId: string;
  audit: CanonicalAuditEnvelopeV0;
  summary: AdapterHealthSummarySnapshotV0;
  sourceRef?: RecordRefV0 | null;
}): AlertV0 | null {
  if (!input.summary.alertable) {
    return null;
  }

  return buildAlertRecordV0({
    id: input.id,
    workspaceId: input.workspaceId,
    audit: input.audit,
    alertKey: "adapter.unreachable",
    severity: input.summary.severity === "critical" ? "critical" : "error",
    summary: `adapter=${input.summary.adapterKind}; status=${input.summary.status}; reason_class=${input.summary.reasonClass}; window=${input.summary.unreachableWindow}`,
    sourceRef: input.sourceRef ?? { kind: input.summary.kind, id: input.summary.id },
    firstObservedAt: input.summary.observedAt,
    lastObservedAt: input.summary.observedAt,
  });
}

export function buildEvidenceReadinessDropAlertV0(
  input: BuildEvidenceReadinessDropAlertV0Input,
): AlertV0 | null {
  if (input.summary.readiness === "ready") {
    return null;
  }
  if (input.previousReadiness !== null && input.previousReadiness !== undefined && input.previousReadiness !== "ready") {
    return null;
  }

  return buildAlertRecordV0({
    id: input.id,
    workspaceId: input.workspaceId,
    audit: input.audit,
    alertKey: "evidence.readiness_drop",
    severity: input.summary.severity,
    summary: `run=${input.summary.runId}; readiness=${input.summary.readiness}; validation=${input.summary.validationOutcome}; sealed=${input.summary.sealed ? "yes" : "no"}; redacted=${input.summary.redacted ? "yes" : "no"}`,
    sourceRef: input.sourceRef ?? null,
    firstObservedAt: input.summary.observedAt,
    lastObservedAt: input.summary.observedAt,
  });
}

export function buildBudgetBreachAlertV0(input: BuildBudgetBreachAlertV0Input): AlertV0 {
  return buildAlertRecordV0({
    id: input.id,
    workspaceId: input.workspaceId,
    audit: input.audit,
    alertKey: "budget.breach",
    severity: input.behavior === "block" || input.behavior === "require_override" ? "error" : "warn",
    summary: `budget=${input.budgetId}; behavior=${input.behavior}; state=breached`,
    sourceRef: input.sourceRef ?? null,
    firstObservedAt: input.observedAt,
    lastObservedAt: input.observedAt,
  });
}

export function buildIngestionFailureAlertV0(input: BuildIngestionFailureAlertV0Input): AlertV0 {
  return buildAlertRecordV0({
    id: input.id,
    workspaceId: input.workspaceId,
    audit: input.audit,
    alertKey: "observability.ingestion_failure",
    severity: input.failureClass === "storage_failed" ? "error" : "warn",
    summary: `failure_class=${input.failureClass}; state=ingestion_failed`,
    sourceRef: input.sourceRef ?? null,
    firstObservedAt: input.observedAt,
    lastObservedAt: input.observedAt,
  });
}

export function buildAlertRecordV0(input: BuildAlertRecordInputV0): AlertV0 {
  return {
    schemaVersion: 0,
    schema: "pluto.observability.alert",
    kind: "alert",
    id: input.id,
    workspaceId: input.workspaceId,
    createdAt: input.createdAt ?? input.firstObservedAt,
    updatedAt: input.updatedAt ?? input.lastObservedAt ?? input.firstObservedAt,
    audit: input.audit,
    alertKey: input.alertKey,
    lifecycle: "triggered",
    severity: input.severity,
    sourceRef: input.sourceRef ?? null,
    summary: input.summary,
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt ?? input.firstObservedAt,
    acknowledgedAt: null,
    resolvedAt: null,
  };
}
