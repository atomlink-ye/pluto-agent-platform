import { createHash } from "node:crypto";

import type {
  PayloadEnvelopeRefV0,
  ProviderResourceRefV0,
  WorkSourceBindingRecordV0,
  WorkSourceRecordV0,
} from "../contracts/integration.js";
import { assertNoSensitiveIntegrationMaterial } from "../contracts/integration.js";
import type { SecurityStore } from "../security/security-store.js";
import type { IntegrationStore } from "./integration-store.js";
import { emitInboundRejectAuditV0 } from "./inbound-audit.js";

const REDACTED_VALUE = "[REDACTED]";
const FORBIDDEN_KEY_RE = /^(?:authorization|token|secret|password|apiKey|clientSecret|cookie|set-cookie|signature)$/i;
const FORBIDDEN_VALUE_RE = /(?:bearer\s+\S+|token\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|-----BEGIN(?:[A-Z ]+)?PRIVATE KEY-----)/i;

export interface SyntheticInboundDocumentSeedV0 {
  documentId: string;
  versionId: string | null;
}

export interface SyntheticInboundEnvelopeV0 {
  schema: "pluto.integration.synthetic-inbound";
  schemaVersion: 0;
  workspaceId: string;
  providerKind: string;
  bindingId: string;
  receivedAt: string;
  headers: Record<string, string | undefined>;
  security: {
    credentialRef: string | null;
    signatureHeader: string;
    expectedSignature: string;
  };
  item: {
    externalId: string;
    resourceType: string;
    title: string;
    sourceUrl: string;
    workspaceId: string;
    documentSeed: SyntheticInboundDocumentSeedV0 | null;
  };
  payload: unknown;
}

export interface AdaptedSyntheticInboundV0 {
  envelope: SyntheticInboundEnvelopeV0;
  workSource: WorkSourceRecordV0;
  binding: WorkSourceBindingRecordV0;
  providerItemRef: ProviderResourceRefV0;
  payloadRef: PayloadEnvelopeRefV0;
  dedupeKey: string;
  provenanceRefs: string[];
  payloadSummary: string;
}

export async function adaptSyntheticInboundWorkItem(input: {
  store: IntegrationStore;
  envelope: SyntheticInboundEnvelopeV0;
  securityStore?: SecurityStore;
}): Promise<AdaptedSyntheticInboundV0> {
  await assertValidEnvelope(input.envelope, input.securityStore);

  const binding = await input.store.get("work_source_binding", input.envelope.bindingId);
  if (binding === null) {
    throw new Error(`work source binding not found: ${input.envelope.bindingId}`);
  }

  if (binding.workspaceId !== input.envelope.workspaceId) {
    await emitRejectAudit(input, "workspace_mismatch", "workspace mismatch");
    throw new Error("workspace mismatch");
  }

  const workSource = await input.store.get("work_source", binding.workSourceRef.recordId);
  if (workSource === null) {
    throw new Error(`work source not found: ${binding.workSourceRef.recordId}`);
  }

  if (workSource.workspaceId !== input.envelope.workspaceId || input.envelope.item.workspaceId !== input.envelope.workspaceId) {
    await emitRejectAudit(input, "workspace_mismatch", "workspace mismatch");
    throw new Error("workspace mismatch");
  }

  if (workSource.providerKind !== input.envelope.providerKind || binding.providerKind !== input.envelope.providerKind) {
    await emitRejectAudit(input, "schema_mismatch", "schema mismatch");
    throw new Error("schema mismatch");
  }

  const signatureHeaderValue = input.envelope.headers[input.envelope.security.signatureHeader];
  if (typeof signatureHeaderValue !== "string" || signatureHeaderValue.length === 0) {
    await emitRejectAudit(input, "invalid_signature_header", "invalid signature/header");
    throw new Error("invalid signature/header");
  }

  if (signatureHeaderValue !== input.envelope.security.expectedSignature) {
    await emitRejectAudit(input, "invalid_signature_header", "invalid signature/header");
    throw new Error("invalid signature/header");
  }

  if (typeof input.envelope.security.credentialRef !== "string" || input.envelope.security.credentialRef.length === 0) {
    await emitRejectAudit(input, "missing_credential_ref", "missing credential ref");
    throw new Error("missing credential ref");
  }

  const payloadSummary = buildRedactedPayloadSummary(input.envelope.payload);
  const providerItemRef: ProviderResourceRefV0 = {
    providerKind: input.envelope.providerKind,
    resourceType: input.envelope.item.resourceType,
    externalId: input.envelope.item.externalId,
    summary: input.envelope.item.title,
  };
  const payloadRef: PayloadEnvelopeRefV0 = {
    providerKind: input.envelope.providerKind,
    refKind: "source_url",
    ref: input.envelope.item.sourceUrl,
    contentType: "application/json",
    summary: payloadSummary,
  };

  return {
    envelope: input.envelope,
    workSource,
    binding,
    providerItemRef,
    payloadRef,
    payloadSummary,
    dedupeKey: buildDedupeKey(input.envelope),
    provenanceRefs: buildProvenanceRefs(input.envelope),
  };
}

async function assertValidEnvelope(
  envelope: SyntheticInboundEnvelopeV0,
  securityStore?: SecurityStore,
): Promise<void> {
  if (envelope.schema !== "pluto.integration.synthetic-inbound" || envelope.schemaVersion !== 0) {
    await emitEnvelopeRejectAudit(envelope, securityStore, "schema_mismatch", "schema mismatch");
    throw new Error("schema mismatch");
  }

  if (!envelope.workspaceId || !envelope.providerKind || !envelope.bindingId || !envelope.receivedAt) {
    await emitEnvelopeRejectAudit(envelope, securityStore, "schema_mismatch", "schema mismatch");
    throw new Error("schema mismatch");
  }

  if (!envelope.item.externalId || !envelope.item.resourceType || !envelope.item.title || !envelope.item.sourceUrl) {
    await emitEnvelopeRejectAudit(envelope, securityStore, "schema_mismatch", "schema mismatch");
    throw new Error("schema mismatch");
  }
}

async function emitRejectAudit(
  input: { envelope: SyntheticInboundEnvelopeV0; securityStore?: SecurityStore },
  reasonCode: string,
  message: string,
): Promise<void> {
  await emitEnvelopeRejectAudit(input.envelope, input.securityStore, reasonCode, message);
}

async function emitEnvelopeRejectAudit(
  envelope: SyntheticInboundEnvelopeV0,
  securityStore: SecurityStore | undefined,
  reasonCode: string,
  message: string,
): Promise<void> {
  await emitInboundRejectAuditV0({
    securityStore,
    workspaceId: envelope.workspaceId,
    occurredAt: envelope.receivedAt,
    action: "adapt_synthetic_inbound",
    target: `${envelope.providerKind}:${envelope.bindingId}`,
    reasonCode,
    correlationId: buildInboundRejectCorrelationId(envelope),
    details: {
      providerKind: envelope.providerKind,
      bindingId: envelope.bindingId,
      externalId: envelope.item.externalId,
      message,
    },
  });
}

function buildInboundRejectCorrelationId(envelope: SyntheticInboundEnvelopeV0): string {
  return `${envelope.bindingId}:${envelope.item.externalId}:${envelope.receivedAt}`;
}

function buildDedupeKey(envelope: SyntheticInboundEnvelopeV0): string {
  return createHash("sha1").update(JSON.stringify([
    envelope.workspaceId,
    envelope.providerKind,
    envelope.bindingId,
    envelope.item.resourceType,
    envelope.item.externalId,
    envelope.item.sourceUrl,
  ])).digest("hex");
}

function buildProvenanceRefs(envelope: SyntheticInboundEnvelopeV0): string[] {
  const refs = [
    `source_url:${envelope.item.sourceUrl}`,
    `credential_ref:${envelope.security.credentialRef}`,
    `signature_header:${envelope.security.signatureHeader}`,
    `binding:${envelope.bindingId}`,
  ];

  if (envelope.item.documentSeed === null) {
    refs.push("document_seed_deferred");
  } else {
    refs.push(`document:${envelope.item.documentSeed.documentId}`);
    if (envelope.item.documentSeed.versionId !== null) {
      refs.push(`version:${envelope.item.documentSeed.versionId}`);
    }
  }

  return refs;
}

function buildRedactedPayloadSummary(payload: unknown): string {
  const sanitized = sanitizePayload(payload);
  assertNoSensitiveIntegrationMaterial(sanitized, "payloadSummary");
  const summary = JSON.stringify(sanitized);
  return summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return FORBIDDEN_VALUE_RE.test(value) ? REDACTED_VALUE : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    sanitized[FORBIDDEN_KEY_RE.test(key) ? "redacted_field" : key] = FORBIDDEN_KEY_RE.test(key)
      ? REDACTED_VALUE
      : sanitizePayload(entry);
  }
  return sanitized;
}
