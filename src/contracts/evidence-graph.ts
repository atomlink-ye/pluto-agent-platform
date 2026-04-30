import type { EvidencePacketV0 } from "./types.js";
import type { EvidenceValidationOutcomeV0, RunRefV0 } from "./governance.js";
import { toRunRefV0 } from "./governance.js";

export const EVIDENCE_GRAPH_RECORD_KINDS_V0 = [
  "sealed_evidence",
  "citation",
  "provenance_edge",
] as const;

export type EvidenceGraphRecordKindV0 = typeof EVIDENCE_GRAPH_RECORD_KINDS_V0[number];
export type EvidenceGraphRecordKindLikeV0 = EvidenceGraphRecordKindV0 | (string & {});

export const CITATION_KINDS_V0 = [
  "generated_artifact",
  "validation",
  "blocker",
  "retry",
  "worker_contribution",
  "input",
  "risk",
  "open_question",
] as const;

export type CitationKindV0 = typeof CITATION_KINDS_V0[number];
export type CitationKindLikeV0 = CitationKindV0 | (string & {});

export const PROVENANCE_EDGE_KINDS_V0 = [
  "generated_artifact",
  "citation",
  "validation",
  "blocker",
  "retry",
  "worker_contribution",
] as const;

export type ProvenanceEdgeKindV0 = typeof PROVENANCE_EDGE_KINDS_V0[number];
export type ProvenanceEdgeKindLikeV0 = ProvenanceEdgeKindV0 | (string & {});

export interface EvidenceGraphValidationError {
  ok: false;
  errors: string[];
}

export interface EvidenceGraphValidationSuccess<T> {
  ok: true;
  value: T;
}

export type EvidenceGraphValidationResult<T> =
  | EvidenceGraphValidationSuccess<T>
  | EvidenceGraphValidationError;

export interface EvidenceGraphObjectRefV0 {
  kind: string;
  id: string;
}

export interface EvidenceValidationSummaryV0 {
  outcome: EvidenceValidationOutcomeV0;
  reason: string | null;
}

export interface EvidenceRedactionSummaryV0 {
  redactedAt: string | null;
  fieldsRedacted: number;
  summary: string;
}

export interface ImmutableEvidencePacketMetadataV0 {
  schemaVersion: 0;
  status: EvidencePacketV0["status"];
  blockerReason: EvidencePacketV0["blockerReason"];
  startedAt: string;
  finishedAt: string;
  generatedAt: string;
  classifierVersion: 0;
  workerCount: number;
  validation: EvidenceValidationSummaryV0;
}

export interface SealedEvidenceRefV0 {
  schemaVersion: 0;
  kind: "sealed_evidence";
  id: string;
  packetId: string;
  runId: string;
  evidencePath: string;
  sealChecksum: string;
  sealedAt: string;
  sourceRun: RunRefV0;
  validationSummary: EvidenceValidationSummaryV0;
  redactionSummary: EvidenceRedactionSummaryV0;
  immutablePacket: ImmutableEvidencePacketMetadataV0;
}

export interface CitationRefV0 {
  schemaVersion: 0;
  kind: "citation";
  id: string;
  citationKind: CitationKindLikeV0;
  sealedEvidenceId: string;
  locator: string;
  summary: string;
}

export interface ProvenanceEdgeV0 {
  schemaVersion: 0;
  kind: "provenance_edge";
  id: string;
  edgeKind: ProvenanceEdgeKindLikeV0;
  from: EvidenceGraphObjectRefV0;
  to: EvidenceGraphObjectRefV0;
  summary: string;
  createdAt: string;
}

export function toImmutableEvidencePacketMetadataV0(
  packet: Pick<
    EvidencePacketV0,
    | "schemaVersion"
    | "status"
    | "blockerReason"
    | "startedAt"
    | "finishedAt"
    | "generatedAt"
    | "classifierVersion"
    | "workers"
    | "validation"
  >,
): ImmutableEvidencePacketMetadataV0 {
  return {
    schemaVersion: 0,
    status: packet.status,
    blockerReason: packet.blockerReason,
    startedAt: packet.startedAt,
    finishedAt: packet.finishedAt,
    generatedAt: packet.generatedAt,
    classifierVersion: 0,
    workerCount: packet.workers.length,
    validation: {
      outcome: packet.validation.outcome,
      reason: packet.validation.reason,
    },
  };
}

export function toSealedEvidenceRefV0(value: {
  id: string;
  packetId?: string;
  runId: string;
  evidencePath: string;
  sealChecksum: string;
  sealedAt: string;
  sourceRun: {
    runId: string;
    status: string;
    blockerReason: string | null;
    finishedAt: string | null;
  } & Record<string, unknown>;
  validationSummary?: {
    outcome?: EvidenceValidationOutcomeV0;
    reason?: string | null;
  } & Record<string, unknown>;
  redactionSummary?: {
    redactedAt?: string | null;
    fieldsRedacted?: number;
    summary?: string;
  } & Record<string, unknown>;
  immutablePacket: ImmutableEvidencePacketMetadataV0 & Record<string, unknown>;
}): SealedEvidenceRefV0 {
  return {
    schemaVersion: 0,
    kind: "sealed_evidence",
    id: value.id,
    packetId: value.packetId ?? value.id,
    runId: value.runId,
    evidencePath: value.evidencePath,
    sealChecksum: value.sealChecksum,
    sealedAt: value.sealedAt,
    sourceRun: toRunRefV0(value.sourceRun),
    validationSummary: {
      outcome: value.validationSummary?.outcome ?? value.immutablePacket.validation.outcome,
      reason: value.validationSummary?.reason ?? value.immutablePacket.validation.reason ?? null,
    },
    redactionSummary: {
      redactedAt: value.redactionSummary?.redactedAt ?? null,
      fieldsRedacted: value.redactionSummary?.fieldsRedacted ?? 0,
      summary: value.redactionSummary?.summary ?? "",
    },
    immutablePacket: {
      schemaVersion: 0,
      status: value.immutablePacket.status,
      blockerReason: value.immutablePacket.blockerReason,
      startedAt: value.immutablePacket.startedAt,
      finishedAt: value.immutablePacket.finishedAt,
      generatedAt: value.immutablePacket.generatedAt,
      classifierVersion: 0,
      workerCount: value.immutablePacket.workerCount,
      validation: {
        outcome: value.immutablePacket.validation.outcome,
        reason: value.immutablePacket.validation.reason ?? null,
      },
    },
  };
}

export function toCitationRefV0(value: {
  id: string;
  citationKind: CitationKindLikeV0;
  sealedEvidenceId: string;
  locator: string;
  summary: string;
}): CitationRefV0 {
  return {
    schemaVersion: 0,
    kind: "citation",
    id: value.id,
    citationKind: value.citationKind,
    sealedEvidenceId: value.sealedEvidenceId,
    locator: value.locator,
    summary: value.summary,
  };
}

export function toProvenanceEdgeV0(value: {
  id: string;
  edgeKind: ProvenanceEdgeKindLikeV0;
  from: EvidenceGraphObjectRefV0 & Record<string, unknown>;
  to: EvidenceGraphObjectRefV0 & Record<string, unknown>;
  summary: string;
  createdAt: string;
}): ProvenanceEdgeV0 {
  return {
    schemaVersion: 0,
    kind: "provenance_edge",
    id: value.id,
    edgeKind: value.edgeKind,
    from: toEvidenceGraphObjectRefV0(value.from),
    to: toEvidenceGraphObjectRefV0(value.to),
    summary: value.summary,
    createdAt: value.createdAt,
  };
}

export function validateSealedEvidenceRefV0(value: unknown): EvidenceGraphValidationResult<SealedEvidenceRefV0> {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["sealed evidence ref must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  validateStringField(record, "id", errors);
  validateStringField(record, "packetId", errors);
  validateStringField(record, "runId", errors);
  validateStringField(record, "evidencePath", errors);
  validateStringField(record, "sealChecksum", errors);
  validateStringField(record, "sealedAt", errors);
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  if (record["kind"] !== "sealed_evidence") errors.push("kind must be sealed_evidence");
  validateRunRef(record["sourceRun"], "sourceRun", errors);
  validateValidationSummary(record["validationSummary"], "validationSummary", errors);
  validateRedactionSummary(record["redactionSummary"], "redactionSummary", errors);
  validateImmutablePacket(record["immutablePacket"], "immutablePacket", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as SealedEvidenceRefV0 }
    : { ok: false, errors };
}

export function validateCitationRefV0(value: unknown): EvidenceGraphValidationResult<CitationRefV0> {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["citation ref must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  if (record["kind"] !== "citation") errors.push("kind must be citation");
  validateStringField(record, "id", errors);
  validateStringField(record, "citationKind", errors);
  validateStringField(record, "sealedEvidenceId", errors);
  validateStringField(record, "locator", errors);
  validateStringField(record, "summary", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as CitationRefV0 }
    : { ok: false, errors };
}

export function validateProvenanceEdgeV0(value: unknown): EvidenceGraphValidationResult<ProvenanceEdgeV0> {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["provenance edge must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  if (record["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  if (record["kind"] !== "provenance_edge") errors.push("kind must be provenance_edge");
  validateStringField(record, "id", errors);
  validateStringField(record, "edgeKind", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "createdAt", errors);
  validateObjectRef(record["from"], "from", errors);
  validateObjectRef(record["to"], "to", errors);

  return errors.length === 0
    ? { ok: true, value: record as unknown as ProvenanceEdgeV0 }
    : { ok: false, errors };
}

function toEvidenceGraphObjectRefV0(value: EvidenceGraphObjectRefV0): EvidenceGraphObjectRefV0 {
  return {
    kind: value.kind,
    id: value.id,
  };
}

function validateRunRef(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }

  const ref = value as Record<string, unknown>;
  validateStringField(ref, "runId", errors, path);
  validateStringField(ref, "status", errors, path);
  validateNullableStringField(ref, "blockerReason", errors, path);
  validateNullableStringField(ref, "finishedAt", errors, path);
}

function validateValidationSummary(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }

  const summary = value as Record<string, unknown>;
  validateStringField(summary, "outcome", errors, path);
  validateNullableStringField(summary, "reason", errors, path);
}

function validateRedactionSummary(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }

  const summary = value as Record<string, unknown>;
  validateNullableStringField(summary, "redactedAt", errors, path);
  if (typeof summary["fieldsRedacted"] !== "number") {
    errors.push(`${path}.fieldsRedacted must be a number`);
  }
  validateStringField(summary, "summary", errors, path);
}

function validateImmutablePacket(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }

  const metadata = value as Record<string, unknown>;
  if (metadata["schemaVersion"] !== 0) errors.push(`${path}.schemaVersion must be 0`);
  if (metadata["classifierVersion"] !== 0) errors.push(`${path}.classifierVersion must be 0`);
  validateStringField(metadata, "status", errors, path);
  validateNullableStringField(metadata, "blockerReason", errors, path);
  validateStringField(metadata, "startedAt", errors, path);
  validateStringField(metadata, "finishedAt", errors, path);
  validateStringField(metadata, "generatedAt", errors, path);
  if (typeof metadata["workerCount"] !== "number") {
    errors.push(`${path}.workerCount must be a number`);
  }
  validateValidationSummary(metadata["validation"], `${path}.validation`, errors);
}

function validateObjectRef(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }

  const ref = value as Record<string, unknown>;
  validateStringField(ref, "kind", errors, path);
  validateStringField(ref, "id", errors, path);
}

function validateStringField(
  value: Record<string, unknown>,
  field: string,
  errors: string[],
  parentPath?: string,
): void {
  const path = parentPath ? `${parentPath}.${field}` : field;
  if (typeof value[field] !== "string") {
    errors.push(`${path} must be a string`);
  }
}

function validateNullableStringField(
  value: Record<string, unknown>,
  field: string,
  errors: string[],
  parentPath?: string,
): void {
  const path = parentPath ? `${parentPath}.${field}` : field;
  const fieldValue = value[field];
  if (fieldValue !== null && typeof fieldValue !== "string") {
    errors.push(`${path} must be a string or null`);
  }
}
