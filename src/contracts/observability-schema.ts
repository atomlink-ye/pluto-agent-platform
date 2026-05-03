export const OBSERVABILITY_OBJECT_KINDS_V0 = [
  "metric_series",
  "run_health_summary",
  "adapter_health_summary",
  "redacted_trace",
  "alert",
  "dashboard_definition",
  "usage_meter",
  "budget",
  "budget_snapshot",
  "budget_decision",
] as const;

export type ObservabilityObjectKindV0 = typeof OBSERVABILITY_OBJECT_KINDS_V0[number];
export type ObservabilityObjectKindLikeV0 = ObservabilityObjectKindV0 | (string & {});

export const BUDGET_BEHAVIORS_V0 = ["allow", "warn", "block", "require_override"] as const;

export type BudgetBehaviorV0 = typeof BUDGET_BEHAVIORS_V0[number];
export type BudgetBehaviorLikeV0 = BudgetBehaviorV0 | (string & {});

export const ALERT_LIFECYCLES_V0 = ["armed", "triggered", "acknowledged", "resolved"] as const;

export type AlertLifecycleV0 = typeof ALERT_LIFECYCLES_V0[number];
export type AlertLifecycleLikeV0 = AlertLifecycleV0 | (string & {});

export const RUN_HEALTH_SUMMARY_STATUSES_V0 = ["queued", "running", "blocked", "failed", "succeeded"] as const;

export type RunHealthSummaryStatusV0 = typeof RUN_HEALTH_SUMMARY_STATUSES_V0[number];
export type RunHealthSummaryStatusLikeV0 = RunHealthSummaryStatusV0 | "done" | (string & {});

export const OBSERVABILITY_SEVERITIES_V0 = ["info", "warn", "error", "critical"] as const;

export type ObservabilitySeverityV0 = typeof OBSERVABILITY_SEVERITIES_V0[number];
export type ObservabilitySeverityLikeV0 = ObservabilitySeverityV0 | (string & {});

export const REDACTION_STATES_V0 = ["clear", "redacted", "summary_only", "blocked"] as const;

export type RedactionStateV0 = typeof REDACTION_STATES_V0[number];
export type RedactionStateLikeV0 = RedactionStateV0 | (string & {});

export interface ObservabilityRecordValidationError {
  ok: false;
  errors: string[];
}

export interface ObservabilityRecordValidationSuccess<T> {
  ok: true;
  value: T;
}

export type ObservabilityRecordValidationResult<T> =
  | ObservabilityRecordValidationSuccess<T>
  | ObservabilityRecordValidationError;

export interface RedactionSummaryV0 {
  [key: string]: unknown;
  containsSensitiveData: boolean;
  state: RedactionStateLikeV0;
  redactionCount: number;
  redactedPaths: string[];
}

export type ObservabilityRedactionSummaryV0 = RedactionSummaryV0;

export interface CanonicalAuditEnvelopeV0 {
  [key: string]: unknown;
  eventId: string;
  eventType: string;
  recordedAt: string;
  correlationId: string;
  actorId: string | null;
  principalId: string | null;
  action: string;
  target: string;
  outcome: string;
  reasonCode: string | null;
  redaction: RedactionSummaryV0;
}

export interface MetricPointV0 {
  ts: string;
  value: number;
}

export interface MetricDimensionV0 {
  key: string;
  value: string;
}

export interface ThresholdWindowV0 {
  unit: string;
  value: number;
}

export interface RecordRefV0 {
  kind: string;
  id: string;
}

interface ObservabilityRecordBaseV0<K extends ObservabilityObjectKindV0> {
  schemaVersion: 0;
  schema: string;
  kind: K;
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  audit: CanonicalAuditEnvelopeV0;
}

export interface MetricSeriesV0 extends ObservabilityRecordBaseV0<"metric_series"> {
  schema: "pluto.observability.metric-series";
  metricKey: string;
  unit: string;
  dimensions: MetricDimensionV0[];
  points: MetricPointV0[];
}

export interface RunHealthSummaryV0 extends ObservabilityRecordBaseV0<"run_health_summary"> {
  schema: "pluto.observability.run-health-summary";
  runId: string;
  status: RunHealthSummaryStatusLikeV0;
  severity: ObservabilitySeverityLikeV0;
  blockerReason: string | null;
  summary: string;
  traceRef: RecordRefV0 | null;
  evidenceRefs: string[];
  observedAt: string;
}

export interface AdapterHealthSummaryV0 extends ObservabilityRecordBaseV0<"adapter_health_summary"> {
  schema: "pluto.observability.adapter-health-summary";
  adapterId: string;
  adapterKind: string;
  status: string;
  severity: ObservabilitySeverityLikeV0;
  summary: string;
  observedAt: string;
}

export interface RedactedTraceV0 extends ObservabilityRecordBaseV0<"redacted_trace"> {
  schema: "pluto.observability.redacted-trace";
  traceId: string;
  runId: string | null;
  spanCount: number;
  preview: string;
  redaction: RedactionSummaryV0;
  capturedAt: string;
}

export interface AlertV0 extends ObservabilityRecordBaseV0<"alert"> {
  schema: "pluto.observability.alert";
  alertKey: string;
  lifecycle: AlertLifecycleLikeV0;
  severity: ObservabilitySeverityLikeV0;
  sourceRef: RecordRefV0 | null;
  summary: string;
  firstObservedAt: string;
  lastObservedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface DashboardWidgetV0 {
  id: string;
  title: string;
  seriesRefs: string[];
}

export interface DashboardDefinitionV0 extends ObservabilityRecordBaseV0<"dashboard_definition"> {
  schema: "pluto.observability.dashboard-definition";
  dashboardKey: string;
  title: string;
  widgets: DashboardWidgetV0[];
}

export interface UsageMeterV0 extends ObservabilityRecordBaseV0<"usage_meter"> {
  schema: "pluto.observability.usage-meter";
  meterKey: string;
  subjectRef: RecordRefV0;
  quantity: number;
  unit: string;
  window: ThresholdWindowV0;
  measuredAt: string;
}

export interface BudgetThresholdV0 {
  metricKey: string;
  limit: number;
  behavior: BudgetBehaviorLikeV0;
}

export interface BudgetV0 extends ObservabilityRecordBaseV0<"budget"> {
  schema: "pluto.observability.budget";
  budgetKey: string;
  scopeRef: RecordRefV0;
  thresholds: BudgetThresholdV0[];
  defaultBehavior: BudgetBehaviorLikeV0;
  currency: string | null;
}

export interface BudgetSnapshotV0 extends ObservabilityRecordBaseV0<"budget_snapshot"> {
  schema: "pluto.observability.budget-snapshot";
  budgetId: string;
  usageMeterId: string | null;
  observedAt: string;
  consumed: number;
  remaining: number;
  behavior: BudgetBehaviorLikeV0;
}

export interface BudgetDecisionV0 extends ObservabilityRecordBaseV0<"budget_decision"> {
  schema: "pluto.observability.budget-decision";
  budgetId: string;
  snapshotId: string | null;
  subjectRef: RecordRefV0;
  behavior: BudgetBehaviorLikeV0;
  overrideRequired: boolean;
  reason: string;
  decidedAt: string;
}