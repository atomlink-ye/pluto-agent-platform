import type {
  AdapterHealthSummaryV0,
  CanonicalAuditEnvelopeV0,
  ObservabilitySeverityV0,
  RecordRefV0,
  RunHealthSummaryStatusV0,
  RunHealthSummaryV0,
} from "../contracts/observability.js";
import type { EvidenceValidationOutcomeV0 } from "../contracts/governance.js";
import type { SealedEvidenceRefV0 } from "../contracts/evidence-graph.js";
import type { BlockerReasonV0, EvidencePacketV0, RunsListItemV0 } from "../contracts/types.js";
import { classifyBlocker, isRetryable } from "../orchestrator/blocker-classifier.js";

interface ObservabilityRecordContextV0 {
  id: string;
  workspaceId: string;
  audit: CanonicalAuditEnvelopeV0;
  createdAt?: string;
  updatedAt?: string;
}

export interface BuildRunHealthSummaryV0Input extends ObservabilityRecordContextV0 {
  run: Pick<
    RunsListItemV0,
    "runId" | "status" | "blockerReason" | "startedAt" | "finishedAt" | "parseWarnings"
  >;
  retryCount?: number;
  traceRef?: RecordRefV0 | null;
  evidenceRefs?: string[];
  observedAt?: string;
}

export interface EvidenceReadinessSummaryV0 {
  schemaVersion: 0;
  runId: string;
  packetStatus: EvidencePacketV0["status"];
  blockerReason: BlockerReasonV0 | null;
  validationOutcome: EvidenceValidationOutcomeV0;
  sealed: boolean;
  redacted: boolean;
  governanceReady: boolean;
  readiness: "ready" | "degraded" | "blocked";
  severity: ObservabilitySeverityV0;
  workerCount: number;
  summary: string;
  observedAt: string;
}

export interface BuildEvidenceReadinessSummaryV0Input {
  packet: Pick<
    EvidencePacketV0,
    "runId" | "status" | "blockerReason" | "workers" | "validation" | "generatedAt"
  >;
  sealedEvidence: Pick<SealedEvidenceRefV0, "sealedAt" | "validationSummary" | "redactionSummary" | "immutablePacket"> | null;
  readiness?: {
    governanceReady?: boolean;
    ingestionOk?: boolean;
  };
  observedAt?: string;
}

export type AdapterHealthReasonClassV0 =
  | "provider_unavailable"
  | "credential_missing"
  | "quota_exceeded"
  | "capability_unavailable"
  | "adapter_protocol_error"
  | "runtime_permission_denied"
  | "runtime_timeout"
  | "runtime_error"
  | "unknown"
  | "none";

export interface BuildAdapterHealthSummaryV0Input extends ObservabilityRecordContextV0 {
  adapterId: string;
  adapterKind: string;
  status: string;
  unreachableSince?: string | null;
  consecutiveFailures?: number;
  lastError?: {
    message?: string;
    code?: string | number;
  } | null;
  alertThresholdMs?: number;
  observedAt?: string;
}

export interface AdapterHealthSummarySnapshotV0 extends AdapterHealthSummaryV0 {
  reasonClass: AdapterHealthReasonClassV0;
  alertable: boolean;
  unreachableWindow: "none" | "short" | "medium" | "prolonged";
  failureBucket: "0" | "1" | "2_3" | "4_plus";
}

const DEFAULT_ADAPTER_ALERT_THRESHOLD_MS = 15 * 60 * 1000;

export function buildRunHealthSummaryV0(input: BuildRunHealthSummaryV0Input): RunHealthSummaryV0 {
  const observedAt = input.observedAt ?? input.run.finishedAt ?? input.run.startedAt;
  const status = toRunHealthStatus(input.run.status);
  const severity = getRunSeverity(status, input.run.blockerReason, input.run.parseWarnings);
  const retryBucket = toRetryBucket(input.retryCount ?? 0);
  const windowBucket = toRunWindowBucket(input.run.startedAt, input.run.finishedAt ?? observedAt);

  return {
    schemaVersion: 0,
    schema: "pluto.observability.run-health-summary",
    kind: "run_health_summary",
    id: input.id,
    workspaceId: input.workspaceId,
    createdAt: input.createdAt ?? observedAt,
    updatedAt: input.updatedAt ?? observedAt,
    audit: input.audit,
    runId: input.run.runId,
    status,
    severity,
    blockerReason: input.run.blockerReason,
    summary: `status=${status}; blocker=${input.run.blockerReason ?? "none"}; retries=${retryBucket}; window=${windowBucket}`,
    traceRef: input.traceRef ?? null,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    observedAt,
  };
}

export function buildEvidenceReadinessSummaryV0(
  input: BuildEvidenceReadinessSummaryV0Input,
): EvidenceReadinessSummaryV0 {
  const sealed = input.sealedEvidence !== null;
  const redacted = input.sealedEvidence?.redactionSummary.redactedAt !== null && input.sealedEvidence !== null;
  const validationOutcome = input.sealedEvidence?.validationSummary.outcome ?? input.packet.validation.outcome;
  const governanceReady = input.readiness?.governanceReady
    ?? (sealed && redacted && validationOutcome !== "fail");
  const ingestionOk = input.readiness?.ingestionOk ?? true;
  const readiness = getEvidenceReadiness(input.packet.status, validationOutcome, sealed, redacted, governanceReady, ingestionOk);
  const severity = getEvidenceSeverity(readiness);
  const observedAt = input.observedAt ?? input.sealedEvidence?.sealedAt ?? input.packet.generatedAt;

  return {
    schemaVersion: 0,
    runId: input.packet.runId,
    packetStatus: input.packet.status,
    blockerReason: input.packet.blockerReason,
    validationOutcome,
    sealed,
    redacted,
    governanceReady,
    readiness,
    severity,
    workerCount: input.packet.workers.length,
    summary: `readiness=${readiness}; sealed=${sealed ? "yes" : "no"}; redacted=${redacted ? "yes" : "no"}; validation=${validationOutcome}`,
    observedAt,
  };
}

export function buildAdapterHealthSummaryV0(
  input: BuildAdapterHealthSummaryV0Input,
): AdapterHealthSummarySnapshotV0 {
  const observedAt = input.observedAt ?? input.updatedAt ?? input.createdAt ?? input.audit.recordedAt;
  const reasonClass = toAdapterReasonClass(input.lastError);
  const unreachableWindow = toAdapterWindowBucket(input.unreachableSince ?? null, observedAt);
  const failureBucket = toFailureBucket(input.consecutiveFailures ?? 0);
  const alertThresholdMs = input.alertThresholdMs ?? DEFAULT_ADAPTER_ALERT_THRESHOLD_MS;
  const alertable = isAdapterAlertable(input.status, input.unreachableSince ?? null, observedAt, alertThresholdMs);
  const severity = getAdapterSeverity(input.status, reasonClass, alertable);

  return {
    schemaVersion: 0,
    schema: "pluto.observability.adapter-health-summary",
    kind: "adapter_health_summary",
    id: input.id,
    workspaceId: input.workspaceId,
    createdAt: input.createdAt ?? observedAt,
    updatedAt: input.updatedAt ?? observedAt,
    audit: input.audit,
    adapterId: input.adapterId,
    adapterKind: input.adapterKind,
    status: input.status,
    severity,
    summary: `status=${input.status}; reason_class=${reasonClass}; failures=${failureBucket}; window=${unreachableWindow}`,
    observedAt,
    reasonClass,
    alertable,
    unreachableWindow,
    failureBucket,
  };
}

function toRunHealthStatus(status: RunsListItemV0["status"]): RunHealthSummaryStatusV0 {
  switch (status) {
    case "done":
      return "succeeded";
    default:
      return status;
  }
}

function getRunSeverity(
  status: RunHealthSummaryStatusV0,
  blockerReason: BlockerReasonV0 | null,
  parseWarnings: number,
): ObservabilitySeverityV0 {
  if (status === "failed") return "error";
  if (status === "blocked") {
    return blockerReason !== null && isRetryable(blockerReason) ? "warn" : "error";
  }
  if (parseWarnings > 0 || status === "running") return "warn";
  return "info";
}

function getEvidenceReadiness(
  packetStatus: EvidencePacketV0["status"],
  validationOutcome: EvidenceValidationOutcomeV0,
  sealed: boolean,
  redacted: boolean,
  governanceReady: boolean,
  ingestionOk: boolean,
): EvidenceReadinessSummaryV0["readiness"] {
  if (!ingestionOk || validationOutcome === "fail" || packetStatus === "failed") {
    return "blocked";
  }
  if (governanceReady && packetStatus === "done") {
    return "ready";
  }
  if (sealed && redacted) {
    return "degraded";
  }
  return "blocked";
}

function getEvidenceSeverity(readiness: EvidenceReadinessSummaryV0["readiness"]): ObservabilitySeverityV0 {
  switch (readiness) {
    case "ready":
      return "info";
    case "degraded":
      return "warn";
    case "blocked":
      return "error";
  }
}

function toAdapterReasonClass(
  lastError: BuildAdapterHealthSummaryV0Input["lastError"],
): AdapterHealthReasonClassV0 {
  if (!lastError?.message) {
    return "none";
  }

  const classified = classifyBlocker({
    errorMessage: lastError.message,
    errorCode: lastError.code,
    source: "adapter",
  }).reason;

  if (classified === "empty_artifact" || classified === "validation_failed") {
    return "runtime_error";
  }

  return classified;
}

function getAdapterSeverity(
  status: string,
  reasonClass: AdapterHealthReasonClassV0,
  alertable: boolean,
): ObservabilitySeverityV0 {
  if (alertable) return "error";
  if (status === "healthy" && reasonClass === "none") return "info";
  return status === "healthy" ? "warn" : "warn";
}

function isAdapterAlertable(
  status: string,
  unreachableSince: string | null,
  observedAt: string,
  alertThresholdMs: number,
): boolean {
  if (status !== "unreachable" && status !== "unhealthy") {
    return false;
  }
  if (unreachableSince === null) {
    return false;
  }
  const durationMs = diffMs(unreachableSince, observedAt);
  return durationMs !== null && durationMs >= alertThresholdMs;
}

function toRunWindowBucket(startedAt: string, finishedAt: string): "short" | "medium" | "long" {
  const durationMs = diffMs(startedAt, finishedAt);
  if (durationMs === null || durationMs < 60_000) return "short";
  if (durationMs < 15 * 60_000) return "medium";
  return "long";
}

function toAdapterWindowBucket(
  unreachableSince: string | null,
  observedAt: string,
): AdapterHealthSummarySnapshotV0["unreachableWindow"] {
  if (unreachableSince === null) return "none";
  const durationMs = diffMs(unreachableSince, observedAt);
  if (durationMs === null || durationMs < 5 * 60_000) return "short";
  if (durationMs < 15 * 60_000) return "medium";
  return "prolonged";
}

function toRetryBucket(retryCount: number): "0" | "1" | "2_3" | "4_plus" {
  if (retryCount <= 0) return "0";
  if (retryCount === 1) return "1";
  if (retryCount <= 3) return "2_3";
  return "4_plus";
}

function toFailureBucket(consecutiveFailures: number): AdapterHealthSummarySnapshotV0["failureBucket"] {
  return toRetryBucket(consecutiveFailures);
}

function diffMs(startedAt: string, finishedAt: string): number | null {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return null;
  }
  return end - start;
}
