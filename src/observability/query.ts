import type {
  AdapterHealthSummaryV0,
  AlertV0,
  BudgetDecisionV0,
  BudgetSnapshotV0,
  BudgetV0,
  DashboardDefinitionV0,
  MetricSeriesV0,
  ObservabilityObjectKindV0,
  ObservabilityRecordValidationResult,
  RedactedTraceV0,
  RunHealthSummaryStatusLikeV0,
  RunHealthSummaryV0,
  UsageMeterV0,
} from "../contracts/observability.js";
import {
  normalizeRunHealthSummaryStatusV0,
  validateAdapterHealthSummaryV0,
  validateAlertV0,
  validateBudgetDecisionV0,
  validateBudgetSnapshotV0,
  validateBudgetV0,
  validateDashboardDefinitionV0,
  validateMetricSeriesV0,
  validateRedactedTraceV0,
  validateRunHealthSummaryV0,
  validateUsageMeterV0,
} from "../contracts/observability.js";

export type ObservabilityRecordV0 =
  | MetricSeriesV0
  | RunHealthSummaryV0
  | AdapterHealthSummaryV0
  | RedactedTraceV0
  | AlertV0
  | DashboardDefinitionV0
  | UsageMeterV0
  | BudgetV0
  | BudgetSnapshotV0
  | BudgetDecisionV0;

export type ObservabilityRecordLikeV0 = ObservabilityRecordV0;

type ObservabilityValidator = (value: unknown) => ObservabilityRecordValidationResult<ObservabilityRecordV0>;

const VALIDATORS: Record<ObservabilityObjectKindV0, ObservabilityValidator> = {
  metric_series: validateMetricSeriesV0 as ObservabilityValidator,
  run_health_summary: validateRunHealthSummaryV0 as ObservabilityValidator,
  adapter_health_summary: validateAdapterHealthSummaryV0 as ObservabilityValidator,
  redacted_trace: validateRedactedTraceV0 as ObservabilityValidator,
  alert: validateAlertV0 as ObservabilityValidator,
  dashboard_definition: validateDashboardDefinitionV0 as ObservabilityValidator,
  usage_meter: validateUsageMeterV0 as ObservabilityValidator,
  budget: validateBudgetV0 as ObservabilityValidator,
  budget_snapshot: validateBudgetSnapshotV0 as ObservabilityValidator,
  budget_decision: validateBudgetDecisionV0 as ObservabilityValidator,
};

export interface CanonicalAuditEnvelopeQueryV0 {
  eventId?: string;
  eventType?: string;
  actorId?: string | null;
  principalId?: string | null;
  action?: string;
  target?: string;
  outcome?: string;
  reasonCode?: string | null;
  correlationId?: string;
  redactionState?: string;
  containsSensitiveData?: boolean;
  recordedFrom?: string;
  recordedTo?: string;
}

export interface ObservabilityQueryV0 {
  kind?: string | readonly string[];
  workspaceId?: string;
  from?: string;
  to?: string;
  actorId?: string;
  principalId?: string;
  action?: string;
  target?: string;
  outcome?: string;
  adapter?: string;
  schedule?: string;
  runStatus?: string;
  blockerReason?: string | null;
  costClass?: string;
  correlationId?: string;
  recordId?: string;
  runId?: string;
  audit?: CanonicalAuditEnvelopeQueryV0;
  auditEventId?: string;
  reasonCode?: string;
  redactionState?: string;
}

export type ObservabilityRecordQueryV0 = ObservabilityQueryV0;

export function validateObservabilityRecordV0(value: unknown): ObservabilityRecordValidationResult<ObservabilityRecordV0> {
  const record = asRecord(value);
  if (!record) return { ok: false, errors: ["record must be an object"] };
  const kind = record["kind"];
  if (typeof kind !== "string") return { ok: false, errors: ["kind must be a string"] };
  const validator = VALIDATORS[kind as ObservabilityObjectKindV0];
  if (!validator) return { ok: false, errors: [`unsupported observability kind: ${kind}`] };
  return validator(value);
}

export function matchesObservabilityQuery(record: ObservabilityRecordLikeV0, query: ObservabilityQueryV0 = {}): boolean {
  return filterObservabilityRecords([record], query).length === 1;
}

export function filterObservabilityRecords<T extends ObservabilityRecordLikeV0>(records: readonly T[], query: ObservabilityQueryV0 = {}): T[] {
  const kinds = query.kind === undefined ? null : new Set(Array.isArray(query.kind) ? query.kind : [query.kind]);
  return records.filter((record) => {
    if (kinds !== null && !kinds.has(record.kind)) return false;
    if (query.workspaceId !== undefined && record.workspaceId !== query.workspaceId) return false;
    if (query.recordId !== undefined && record.id !== query.recordId) return false;
    if (query.runId !== undefined && !matchesAny(candidateRunIds(record), query.runId)) return false;
    const effectiveAt = recordTimestamp(record);
    if (query.from !== undefined && effectiveAt < query.from) return false;
    if (query.to !== undefined && effectiveAt > query.to) return false;
    if (query.actorId !== undefined && !matchesAny(candidateActorIds(record), query.actorId)) return false;
    if (query.principalId !== undefined && !matchesAny(candidatePrincipalIds(record), query.principalId)) return false;
    if (query.action !== undefined && !matchesAny(candidateActions(record), query.action)) return false;
    if (query.target !== undefined && !matchesAny(candidateTargets(record), query.target)) return false;
    if (query.outcome !== undefined && !matchesAny(candidateOutcomes(record), query.outcome)) return false;
    if (query.adapter !== undefined && !matchesAny(candidateAdapters(record), query.adapter)) return false;
    if (query.schedule !== undefined && !matchesAny(candidateSchedules(record), query.schedule)) return false;
    if (query.runStatus !== undefined && !matchesAny(candidateRunStatuses(record), query.runStatus)) return false;
    if (query.blockerReason !== undefined && !matchesNullable(candidateBlockerReasons(record), query.blockerReason)) return false;
    if (query.costClass !== undefined && !matchesAny(candidateCostClasses(record), query.costClass)) return false;
    if (query.correlationId !== undefined && record.audit.correlationId !== query.correlationId) return false;
    const auditQuery = query.audit ?? buildAuditQuery(query);
    if (auditQuery !== null && !matchesAuditEnvelope(record, auditQuery)) return false;
    return true;
  });
}

export function queryObservabilityRecords<T extends ObservabilityRecordLikeV0>(records: readonly T[], query: ObservabilityRecordQueryV0 = {}): T[] {
  return sortObservabilityRecords(filterObservabilityRecords(records, query));
}

export function sortObservabilityRecords<T extends ObservabilityRecordLikeV0>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const byTime = recordTimestamp(right).localeCompare(recordTimestamp(left));
    if (byTime !== 0) return byTime;
    const byKind = left.kind.localeCompare(right.kind);
    if (byKind !== 0) return byKind;
    return left.id.localeCompare(right.id);
  });
}

export function queryByWorkspace<T extends ObservabilityRecordLikeV0>(records: readonly T[], workspaceId: string): T[] {
  return filterObservabilityRecords(records, { workspaceId });
}

export function queryByTimeRange<T extends ObservabilityRecordLikeV0>(records: readonly T[], range: { from?: string; to?: string }): T[] {
  return filterObservabilityRecords(records, range);
}

export function queryByActor<T extends ObservabilityRecordLikeV0>(records: readonly T[], actorId: string): T[] {
  return filterObservabilityRecords(records, { actorId });
}

export function queryByAction<T extends ObservabilityRecordLikeV0>(records: readonly T[], action: string): T[] {
  return filterObservabilityRecords(records, { action });
}

export function queryByTarget<T extends ObservabilityRecordLikeV0>(records: readonly T[], target: string): T[] {
  return filterObservabilityRecords(records, { target });
}

export function queryByOutcome<T extends ObservabilityRecordLikeV0>(records: readonly T[], outcome: string): T[] {
  return filterObservabilityRecords(records, { outcome });
}

export function queryByAdapter<T extends ObservabilityRecordLikeV0>(records: readonly T[], adapter: string): T[] {
  return filterObservabilityRecords(records, { adapter });
}

export function queryBySchedule<T extends ObservabilityRecordLikeV0>(records: readonly T[], schedule: string): T[] {
  return filterObservabilityRecords(records, { schedule });
}

export function queryByRunStatus<T extends ObservabilityRecordLikeV0>(records: readonly T[], runStatus: string): T[] {
  return filterObservabilityRecords(records, { runStatus });
}

export function queryByBlockerReason<T extends ObservabilityRecordLikeV0>(records: readonly T[], blockerReason: string | null): T[] {
  return filterObservabilityRecords(records, { blockerReason });
}

export function queryByCostClass<T extends ObservabilityRecordLikeV0>(records: readonly T[], costClass: string): T[] {
  return filterObservabilityRecords(records, { costClass });
}

export function queryByCorrelationId<T extends ObservabilityRecordLikeV0>(records: readonly T[], correlationId: string): T[] {
  return filterObservabilityRecords(records, { correlationId });
}

export function queryByAuditEnvelope<T extends ObservabilityRecordLikeV0>(records: readonly T[], audit: CanonicalAuditEnvelopeQueryV0): T[] {
  return filterObservabilityRecords(records, { audit });
}

export function recordTimestamp(record: ObservabilityRecordLikeV0): string {
  return candidateStringsAtPaths(record, [
    ["observedAt"],
    ["capturedAt"],
    ["measuredAt"],
    ["decidedAt"],
    ["lastObservedAt"],
    ["firstObservedAt"],
    ["updatedAt"],
    ["createdAt"],
    ["audit", "recordedAt"],
  ])[0] ?? record.updatedAt;
}

export function getObservabilityActorId(record: ObservabilityRecordLikeV0): string | null {
  return candidateActorIds(record)[0] ?? null;
}

export function getObservabilityPrincipalId(record: ObservabilityRecordLikeV0): string | null {
  return candidatePrincipalIds(record)[0] ?? null;
}

export function getObservabilityAction(record: ObservabilityRecordLikeV0): string | null {
  return candidateActions(record)[0] ?? null;
}

export function getObservabilityTarget(record: ObservabilityRecordLikeV0): string | null {
  return candidateTargets(record)[0] ?? null;
}

export function getObservabilityOutcome(record: ObservabilityRecordLikeV0): string | null {
  return candidateOutcomes(record)[0] ?? null;
}

export function getObservabilityAdapter(record: ObservabilityRecordLikeV0): string | null {
  return candidateAdapters(record)[0] ?? null;
}

export function getObservabilitySchedule(record: ObservabilityRecordLikeV0): string | null {
  return candidateSchedules(record)[0] ?? null;
}

export function getObservabilityRunStatus(record: ObservabilityRecordLikeV0): RunHealthSummaryStatusLikeV0 | string | null {
  return candidateRunStatuses(record)[0] ?? null;
}

export function getObservabilityBlockerReason(record: ObservabilityRecordLikeV0): string | null {
  return candidateBlockerReasons(record)[0] ?? null;
}

export function getObservabilityCostClass(record: ObservabilityRecordLikeV0): string | null {
  return candidateCostClasses(record)[0] ?? null;
}

export function getObservabilityCorrelationId(record: ObservabilityRecordLikeV0): string {
  return record.audit.correlationId;
}

export function getObservabilityRunId(record: ObservabilityRecordLikeV0): string | null {
  return candidateRunIds(record)[0] ?? null;
}

export function getObservabilityTimestamps(record: ObservabilityRecordLikeV0): string[] {
  return Array.from(new Set(candidateStringsAtPaths(record, [
    ["createdAt"],
    ["updatedAt"],
    ["observedAt"],
    ["capturedAt"],
    ["measuredAt"],
    ["decidedAt"],
    ["firstObservedAt"],
    ["lastObservedAt"],
    ["audit", "recordedAt"],
  ]))).sort((left, right) => left.localeCompare(right));
}

function buildAuditQuery(query: ObservabilityQueryV0): CanonicalAuditEnvelopeQueryV0 | null {
  if (
    query.auditEventId === undefined
    && query.action === undefined
    && query.target === undefined
    && query.outcome === undefined
    && query.reasonCode === undefined
    && query.redactionState === undefined
  ) {
    return null;
  }

  return {
    eventId: query.auditEventId,
    action: query.action,
    target: query.target,
    outcome: query.outcome,
    reasonCode: query.reasonCode,
    redactionState: query.redactionState,
  };
}

function matchesAuditEnvelope(record: ObservabilityRecordLikeV0, audit: CanonicalAuditEnvelopeQueryV0): boolean {
  if (audit.eventId !== undefined && record.audit.eventId !== audit.eventId) return false;
  if (audit.eventType !== undefined && record.audit.eventType !== audit.eventType) return false;
  if (audit.actorId !== undefined && record.audit.actorId !== audit.actorId) return false;
  if (audit.principalId !== undefined && record.audit.principalId !== audit.principalId) return false;
  if (audit.action !== undefined && record.audit.action !== audit.action) return false;
  if (audit.target !== undefined && record.audit.target !== audit.target) return false;
  if (audit.outcome !== undefined && record.audit.outcome !== audit.outcome) return false;
  if (audit.reasonCode !== undefined && record.audit.reasonCode !== audit.reasonCode) return false;
  if (audit.correlationId !== undefined && record.audit.correlationId !== audit.correlationId) return false;
  if (audit.redactionState !== undefined && record.audit.redaction.state !== audit.redactionState) return false;
  if (audit.containsSensitiveData !== undefined && record.audit.redaction.containsSensitiveData !== audit.containsSensitiveData) return false;
  if (audit.recordedFrom !== undefined && record.audit.recordedAt < audit.recordedFrom) return false;
  if (audit.recordedTo !== undefined && record.audit.recordedAt > audit.recordedTo) return false;
  return true;
}

function candidateActorIds(record: ObservabilityRecordLikeV0): string[] {
  return uniqueStrings(candidateStringsAtPaths(record, [["audit", "actorId"], ["actorId"], ["actor", "id"], ["actor", "principalId"]]));
}

function candidatePrincipalIds(record: ObservabilityRecordLikeV0): string[] {
  return uniqueStrings(candidateStringsAtPaths(record, [["audit", "principalId"], ["principalId"], ["principal", "id"], ["actor", "principalId"]]));
}

function candidateActions(record: ObservabilityRecordLikeV0): string[] {
  return uniqueStrings(candidateStringsAtPaths(record, [
    ["action"],
    ["actionId"],
    ["actionKey"],
    ["metadata", "action"],
    ["audit", "action"],
    ["audit", "actionId"],
    ["audit", "actionKey"],
    ["eventType"],
    ["audit", "eventType"],
  ]));
}

function candidateTargets(record: ObservabilityRecordLikeV0): string[] {
  return uniqueStrings([
    ...candidateStringsAtPaths(record, [
      ["target"],
      ["targetId"],
      ["audit", "target"],
      ["audit", "targetId"],
      ["runId"],
      ["traceId"],
      ["alertKey"],
      ["meterKey"],
      ["budgetId"],
      ["usageMeterId"],
      ["snapshotId"],
      ["targetRef", "id"],
      ["targetRef", "recordId"],
      ["subjectRef", "id"],
      ["sourceRef", "id"],
      ["scopeRef", "id"],
      ["traceRef", "id"],
      ["scheduleRef", "id"],
      ["metadata", "target"],
    ]),
    ...candidateStringsAtPaths(record, [["subjectRef", "kind"], ["sourceRef", "kind"], ["scopeRef", "kind"], ["traceRef", "kind"]]),
  ]);
}

function candidateOutcomes(record: ObservabilityRecordLikeV0): string[] {
  const values = candidateStringsAtPaths(record, [["outcome"], ["status"], ["lifecycle"], ["behavior"], ["metadata", "outcome"], ["audit", "outcome"]]);
  const rawStatus = getPath(record, ["status"]);
  if (record.kind === "run_health_summary" && typeof rawStatus === "string") {
    const normalized = normalizeRunHealthSummaryStatusV0(rawStatus);
    if (normalized !== null) values.unshift(normalized);
  }
  return uniqueStrings(values);
}

function candidateAdapters(record: ObservabilityRecordLikeV0): string[] {
  return uniqueStrings([
    ...candidateStringsAtPaths(record, [["adapterId"], ["adapterKind"], ["adapter", "id"], ["adapter", "kind"], ["metadata", "adapter"], ["audit", "adapter"], ["audit", "adapterId"], ["audit", "adapterKind"]]),
    ...dimensionValues(record, ["adapter", "adapterId", "adapterKind"]),
  ]);
}

function candidateSchedules(record: ObservabilityRecordLikeV0): string[] {
  return uniqueStrings([
    ...candidateStringsAtPaths(record, [["schedule"], ["scheduleId"], ["scheduleKey"], ["scheduleRef", "id"], ["metadata", "schedule"], ["audit", "schedule"], ["audit", "scheduleId"], ["audit", "scheduleKey"]]),
    ...dimensionValues(record, ["schedule", "scheduleId", "scheduleKey"]),
  ]);
}

function candidateRunStatuses(record: ObservabilityRecordLikeV0): string[] {
  const values = candidateStringsAtPaths(record, [["runStatus"], ["status"], ["metadata", "runStatus"], ["audit", "runStatus"]]);
  const rawStatus = getPath(record, ["status"]);
  if (record.kind === "run_health_summary" && typeof rawStatus === "string") {
    const normalized = normalizeRunHealthSummaryStatusV0(rawStatus);
    if (normalized !== null) values.unshift(normalized);
  }
  return uniqueStrings(values);
}

function candidateBlockerReasons(record: ObservabilityRecordLikeV0): Array<string | null> {
  const rawBlockerReason = getPath(record, ["blockerReason"]);
  return uniqueNullableStrings([
    record.kind === "run_health_summary" && (typeof rawBlockerReason === "string" || rawBlockerReason === null)
      ? rawBlockerReason as string | null
      : null,
    ...candidateNullableStringsAtPaths(record, [["blockerReason"], ["metadata", "blockerReason"], ["audit", "blockerReason"]]),
  ]);
}

function candidateCostClasses(record: ObservabilityRecordLikeV0): string[] {
  return uniqueStrings([
    ...candidateStringsAtPaths(record, [["costClass"], ["cost_class"], ["metadata", "costClass"], ["metadata", "cost_class"], ["audit", "costClass"], ["audit", "cost_class"]]),
    ...dimensionValues(record, ["costClass", "cost_class", "cost"]),
  ]);
}

function candidateRunIds(record: ObservabilityRecordLikeV0): string[] {
  return uniqueStrings(candidateStringsAtPaths(record, [["runId"], ["metadata", "runId"], ["audit", "target"]]));
}

function dimensionValues(record: ObservabilityRecordLikeV0, keys: readonly string[]): string[] {
  const dimensions = getPath(record, ["dimensions"]);
  if (record.kind !== "metric_series" || !Array.isArray(dimensions)) return [];
  const wanted = new Set(keys);
  return (dimensions as Array<Record<string, unknown>>)
    .filter((dimension) => typeof dimension["key"] === "string" && wanted.has(dimension["key"] as string))
    .flatMap((dimension) => typeof dimension["value"] === "string" ? [dimension["value"]] : []);
}

function candidateStringsAtPaths(value: unknown, paths: readonly string[][]): string[] {
  return paths.map((path) => getPath(value, path)).flatMap((entry) => typeof entry === "string" ? [entry] : []);
}

function candidateNullableStringsAtPaths(value: unknown, paths: readonly string[][]): Array<string | null> {
  return paths.map((path) => getPath(value, path)).flatMap((entry) => entry === null || typeof entry === "string" ? [entry] : []);
}

function matchesAny(candidates: readonly string[], expected: string): boolean {
  return candidates.includes(expected);
}

function matchesNullable(candidates: readonly (string | null)[], expected: string | null): boolean {
  return candidates.includes(expected);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function uniqueNullableStrings(values: readonly (string | null)[]): Array<string | null> {
  return Array.from(new Set(values));
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}
