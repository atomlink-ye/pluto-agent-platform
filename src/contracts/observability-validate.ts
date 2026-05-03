import type { ObservabilityObjectKindV0, ObservabilityObjectKindLikeV0, BudgetBehaviorV0, BudgetBehaviorLikeV0, AlertLifecycleV0, AlertLifecycleLikeV0, ObservabilitySeverityV0, ObservabilitySeverityLikeV0, RedactionStateV0, RedactionStateLikeV0, RunHealthSummaryStatusV0, RunHealthSummaryStatusLikeV0 } from "./observability-schema.js";

import type {
  RedactionSummaryV0,
  CanonicalAuditEnvelopeV0,
  MetricSeriesV0,
  RunHealthSummaryV0,
  AdapterHealthSummaryV0,
  RedactedTraceV0,
  AlertV0,
  DashboardDefinitionV0,
  UsageMeterV0,
  BudgetV0,
  BudgetSnapshotV0,
  BudgetDecisionV0,
  ObservabilityRecordValidationResult,
} from "./observability-schema.js";

const OBSERVABILITY_OBJECT_KIND_SET = new Set<string>([
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
]);
const BUDGET_BEHAVIOR_SET = new Set<string>(["allow", "warn", "block", "require_override"]);
const ALERT_LIFECYCLE_SET = new Set<string>(["armed", "triggered", "acknowledged", "resolved"]);
const RUN_HEALTH_SUMMARY_STATUS_SET = new Set<string>(["queued", "running", "blocked", "failed", "succeeded"]);
const OBSERVABILITY_SEVERITY_SET = new Set<string>(["info", "warn", "error", "critical"]);
const REDACTION_STATE_SET = new Set<string>(["clear", "redacted", "summary_only", "blocked"]);

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

function validateStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "string") {
    errors.push(`${field} must be a string`);
  }
}

function validateNullableStringField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (value !== null && typeof value !== "string") {
    errors.push(`${field} must be a string or null`);
  }
}

function validateBooleanField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "boolean") {
    errors.push(`${field} must be a boolean`);
  }
}

function validateNumberField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
    errors.push(`${field} must be a finite number`);
  }
}

function validateStringArrayField(record: Record<string, unknown>, field: string, errors: string[]): void {
  if (!hasOwnProperty(record, field)) {
    errors.push(`missing required field: ${field}`);
    return;
  }

  const value = record[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

function validateRecordRefV0(value: unknown, field: string, errors: string[]): void {
  if (value === null) {
    return;
  }

  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object or null`);
    return;
  }

  if (typeof record["kind"] !== "string") {
    errors.push(`${field}.kind must be a string`);
  }

  if (typeof record["id"] !== "string") {
    errors.push(`${field}.id must be a string`);
  }
}

function validateRedactionSummaryV0(value: unknown, field: string): ObservabilityRecordValidationResult<RedactionSummaryV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: [`${field} must be an object`] };
  }

  const errors: string[] = [];
  if (typeof record["containsSensitiveData"] !== "boolean") {
    errors.push(`${field}.containsSensitiveData must be a boolean`);
  }

  if (typeof record["state"] !== "string") {
    errors.push(`${field}.state must be a string`);
  }

  if (typeof record["redactionCount"] !== "number" || !Number.isFinite(record["redactionCount"])) {
    errors.push(`${field}.redactionCount must be a finite number`);
  }

  if (!Array.isArray(record["redactedPaths"]) || record["redactedPaths"].some((entry) => typeof entry !== "string")) {
    errors.push(`${field}.redactedPaths must be an array of strings`);
  }

  const validationResult = errors.length === 0
    ? { ok: true, value: record as unknown as RedactionSummaryV0 }
    : { ok: false, errors };
  return validationResult;
}

function validateCanonicalAuditEnvelopeV0(
  value: unknown,
  field: string,
): ObservabilityRecordValidationResult<CanonicalAuditEnvelopeV0> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: [`${field} must be an object`] };
  }

  const errors: string[] = [];
  validateStringField(record, "eventId", errors);
  validateStringField(record, "eventType", errors);
  validateStringField(record, "recordedAt", errors);
  validateStringField(record, "correlationId", errors);
  validateStringField(record, "action", errors);
  validateStringField(record, "target", errors);
  validateStringField(record, "outcome", errors);

  if (record["actorId"] !== null && typeof record["actorId"] !== "string") {
    errors.push(`${field}.actorId must be a string or null`);
  }

  if (record["principalId"] !== null && typeof record["principalId"] !== "string") {
    errors.push(`${field}.principalId must be a string or null`);
  }

  if (record["reasonCode"] !== null && typeof record["reasonCode"] !== "string") {
    errors.push(`${field}.reasonCode must be a string or null`);
  }

  const redaction = validateRedactionSummaryV0(record["redaction"], `${field}.redaction`);
  if (!redaction.ok) {
    errors.push(...(redaction as any).errors);
  }

  const validationResult = errors.length === 0
    ? { ok: true, value: record as unknown as CanonicalAuditEnvelopeV0 }
    : { ok: false, errors };
  return validationResult;
}

function validateMetricDimensions(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`${field}[${index}] must be an object`);
      return;
    }

    if (typeof record["key"] !== "string") {
      errors.push(`${field}[${index}].key must be a string`);
    }

    if (typeof record["value"] !== "string") {
      errors.push(`${field}[${index}].value must be a string`);
    }
  });
}

function validateMetricPoints(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`${field}[${index}] must be an object`);
      return;
    }

    if (typeof record["ts"] !== "string") {
      errors.push(`${field}[${index}].ts must be a string`);
    }

    if (typeof record["value"] !== "number" || !Number.isFinite(record["value"])) {
      errors.push(`${field}[${index}].value must be a finite number`);
    }
  });
}

function validateThresholdWindowV0(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  if (typeof record["unit"] !== "string") {
    errors.push(`${field}.unit must be a string`);
  }

  if (typeof record["value"] !== "number" || !Number.isFinite(record["value"])) {
    errors.push(`${field}.value must be a finite number`);
  }
}

function validateDashboardWidgetsV0(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`${field}[${index}] must be an object`);
      return;
    }

    if (typeof record["id"] !== "string") {
      errors.push(`${field}[${index}].id must be a string`);
    }

    if (typeof record["title"] !== "string") {
      errors.push(`${field}[${index}].title must be a string`);
    }

    if (!Array.isArray(record["seriesRefs"]) || record["seriesRefs"].some((item) => typeof item !== "string")) {
      errors.push(`${field}[${index}].seriesRefs must be an array of strings`);
    }
  });
}

function validateBudgetThresholdsV0(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      errors.push(`${field}[${index}] must be an object`);
      return;
    }

    if (typeof record["metricKey"] !== "string") {
      errors.push(`${field}[${index}].metricKey must be a string`);
    }

    if (typeof record["limit"] !== "number" || !Number.isFinite(record["limit"])) {
      errors.push(`${field}[${index}].limit must be a finite number`);
    }

    if (typeof record["behavior"] !== "string") {
      errors.push(`${field}[${index}].behavior must be a string`);
    }
  });
}

function validateBaseRecord(
  value: unknown,
  expectedSchema: string,
  expectedKind: ObservabilityObjectKindV0,
): ObservabilityRecordValidationResult<Record<string, unknown>> {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const errors: string[] = [];

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  if (record["schema"] !== expectedSchema) {
    errors.push(`schema must be ${expectedSchema}`);
  }

  if (record["kind"] !== expectedKind) {
    errors.push(`kind must be ${expectedKind}`);
  }

  validateStringField(record, "id", errors);
  validateStringField(record, "workspaceId", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);

  if (!hasOwnProperty(record, "audit")) {
    errors.push("missing required field: audit");
  } else {
    const audit = validateCanonicalAuditEnvelopeV0(record["audit"], "audit");
    if (!audit.ok) {
      errors.push(...(audit as any).errors);
    }
  }

  const validationResult = errors.length === 0 
    ? { ok: true, value: record as Record<string, unknown> }
    : { ok: false, errors };
  return validationResult;
}

function parseKnownOrString<T extends string>(value: unknown, known: Set<string>): T | (string & {}) | null {
  if (typeof value !== "string") return null;
  if (known.has(value)) return value as T;
  return value;
}

export function parseObservabilityObjectKindV0(value: unknown): ObservabilityObjectKindLikeV0 | null {
  return parseKnownOrString<ObservabilityObjectKindV0>(value, OBSERVABILITY_OBJECT_KIND_SET);
}

export function parseBudgetBehaviorV0(value: unknown): BudgetBehaviorLikeV0 | null {
  return parseKnownOrString<BudgetBehaviorLikeV0>(value, BUDGET_BEHAVIOR_SET);
}

export function parseAlertLifecycleV0(value: unknown): AlertLifecycleLikeV0 | null {
  return parseKnownOrString<AlertLifecycleLikeV0>(value, ALERT_LIFECYCLE_SET);
}

export function parseObservabilitySeverityV0(value: unknown): ObservabilitySeverityLikeV0 | null {
  return parseKnownOrString<ObservabilitySeverityV0>(value, OBSERVABILITY_SEVERITY_SET);
}

export function parseRedactionStateV0(value: unknown): RedactionStateLikeV0 | null {
  return parseKnownOrString<RedactionStateV0>(value, REDACTION_STATE_SET);
}

export function normalizeRunHealthSummaryStatusV0(value: unknown): RunHealthSummaryStatusLikeV0 | null {
  if (typeof value !== "string") return null;
  if (value === "done") return "succeeded";
  if (RUN_HEALTH_SUMMARY_STATUS_SET.has(value)) {
    return value as RunHealthSummaryStatusLikeV0;
  }

  return value;
}

export function validateMetricSeriesV0(value: unknown): ObservabilityRecordValidationResult<MetricSeriesV0> {
  const base = validateBaseRecord(value, "pluto.observability.metric-series", "metric_series");
  if (!base.ok) return base as ObservabilityRecordValidationResult<MetricSeriesV0>;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "metricKey", errors);
  validateStringField(record, "unit", errors);
  validateMetricDimensions(record["dimensions"], "dimensions", errors);
  validateMetricPoints(record["points"], "points", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as MetricSeriesV0 }
    : { ok: false, errors };
}

export function validateRunHealthSummaryV0(value: unknown): ObservabilityRecordValidationResult<RunHealthSummaryV0> {
  const base = validateBaseRecord(value, "pluto.observability.run-health-summary", "run_health_summary");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "runId", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "severity", errors);
  validateNullableStringField(record, "blockerReason", errors);
  validateStringField(record, "summary", errors);
  validateStringArrayField(record, "evidenceRefs", errors);
  validateStringField(record, "observedAt", errors);
  if (!hasOwnProperty(record, "traceRef")) {
    errors.push("missing required field: traceRef");
  } else {
    validateRecordRefV0(record["traceRef"], "traceRef", errors);
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as RunHealthSummaryV0 }
    : { ok: false, errors };
}

export function validateAdapterHealthSummaryV0(
  value: unknown,
): ObservabilityRecordValidationResult<AdapterHealthSummaryV0> {
  const base = validateBaseRecord(value, "pluto.observability.adapter-health-summary", "adapter_health_summary");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "adapterId", errors);
  validateStringField(record, "adapterKind", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "severity", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "observedAt", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as AdapterHealthSummaryV0 }
    : { ok: false, errors };
}

export function validateRedactedTraceV0(value: unknown): ObservabilityRecordValidationResult<RedactedTraceV0> {
  const base = validateBaseRecord(value, "pluto.observability.redacted-trace", "redacted_trace");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "traceId", errors);
  validateNullableStringField(record, "runId", errors);
  validateNumberField(record, "spanCount", errors);
  validateStringField(record, "preview", errors);
  validateStringField(record, "capturedAt", errors);
  const redaction = validateRedactionSummaryV0(record["redaction"], "redaction");
  if (!redaction.ok) {
    errors.push(...redaction.errors);
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as RedactedTraceV0 }
    : { ok: false, errors };
}

export function validateAlertV0(value: unknown): ObservabilityRecordValidationResult<AlertV0> {
  const base = validateBaseRecord(value, "pluto.observability.alert", "alert");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "alertKey", errors);
  validateStringField(record, "lifecycle", errors);
  validateStringField(record, "severity", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "firstObservedAt", errors);
  validateStringField(record, "lastObservedAt", errors);
  validateNullableStringField(record, "acknowledgedAt", errors);
  validateNullableStringField(record, "resolvedAt", errors);
  if (!hasOwnProperty(record, "sourceRef")) {
    errors.push("missing required field: sourceRef");
  } else {
    validateRecordRefV0(record["sourceRef"], "sourceRef", errors);
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as AlertV0 }
    : { ok: false, errors };
}

export function validateDashboardDefinitionV0(
  value: unknown,
): ObservabilityRecordValidationResult<DashboardDefinitionV0> {
  const base = validateBaseRecord(value, "pluto.observability.dashboard-definition", "dashboard_definition");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "dashboardKey", errors);
  validateStringField(record, "title", errors);
  validateDashboardWidgetsV0(record["widgets"], "widgets", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as DashboardDefinitionV0 }
    : { ok: false, errors };
}

export function validateUsageMeterV0(value: unknown): ObservabilityRecordValidationResult<UsageMeterV0> {
  const base = validateBaseRecord(value, "pluto.observability.usage-meter", "usage_meter");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "meterKey", errors);
  validateNumberField(record, "quantity", errors);
  validateStringField(record, "unit", errors);
  validateStringField(record, "measuredAt", errors);
  validateRecordRefV0(record["subjectRef"], "subjectRef", errors);
  validateThresholdWindowV0(record["window"], "window", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as UsageMeterV0 }
    : { ok: false, errors };
}

export function validateBudgetV0(value: unknown): ObservabilityRecordValidationResult<BudgetV0> {
  const base = validateBaseRecord(value, "pluto.observability.budget", "budget");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "budgetKey", errors);
  validateRecordRefV0(record["scopeRef"], "scopeRef", errors);
  validateBudgetThresholdsV0(record["thresholds"], "thresholds", errors);
  validateStringField(record, "defaultBehavior", errors);
  if (record["currency"] !== null && typeof record["currency"] !== "string") {
    errors.push("currency must be a string or null");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as BudgetV0 }
    : { ok: false, errors };
}

export function validateBudgetSnapshotV0(value: unknown): ObservabilityRecordValidationResult<BudgetSnapshotV0> {
  const base = validateBaseRecord(value, "pluto.observability.budget-snapshot", "budget_snapshot");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "budgetId", errors);
  validateNullableStringField(record, "usageMeterId", errors);
  validateStringField(record, "observedAt", errors);
  validateNumberField(record, "consumed", errors);
  validateNumberField(record, "remaining", errors);
  validateStringField(record, "behavior", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as BudgetSnapshotV0 }
    : { ok: false, errors };
}

export function validateBudgetDecisionV0(value: unknown): ObservabilityRecordValidationResult<BudgetDecisionV0> {
  const base = validateBaseRecord(value, "pluto.observability.budget-decision", "budget_decision");
  if (!base.ok) return base;

  const record = base.value;
  const errors: string[] = [];
  validateStringField(record, "budgetId", errors);
  validateNullableStringField(record, "snapshotId", errors);
  validateStringField(record, "behavior", errors);
  validateBooleanField(record, "overrideRequired", errors);
  validateStringField(record, "reason", errors);
  validateStringField(record, "decidedAt", errors);
  validateRecordRefV0(record["subjectRef"], "subjectRef", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as BudgetDecisionV0 }
    : { ok: false, errors };
}