export const INTEGRATION_RECORD_KINDS_V0 = [
  "work_source",
  "work_source_binding",
  "inbound_work_item",
  "outbound_target",
  "outbound_write",
  "webhook_subscription",
  "webhook_delivery_attempt",
] as const;

export type IntegrationRecordKindV0 = typeof INTEGRATION_RECORD_KINDS_V0[number];
export type IntegrationRecordKindLikeV0 = IntegrationRecordKindV0 | (string & {});

export interface IntegrationRecordValidationError {
  ok: false;
  errors: string[];
}

export interface IntegrationRecordValidationSuccess<T> {
  ok: true;
  value: T;
}

export type IntegrationRecordValidationResult<T> =
  | IntegrationRecordValidationSuccess<T>
  | IntegrationRecordValidationError;

export interface IntegrationRecordRefV0 {
  schema: "pluto.integration.ref";
  schemaVersion: 0;
  kind: IntegrationRecordKindV0;
  recordId: string;
  workspaceId: string;
  providerKind: string;
  summary: string;
}

export interface ProviderResourceRefV0 {
  providerKind: string;
  resourceType: string;
  externalId: string;
  summary: string;
}

export interface PayloadEnvelopeRefV0 {
  providerKind: string;
  refKind: string;
  ref: string;
  contentType: string;
  summary: string;
}

export interface OutboundDecisionRecordV0 {
  allowed: boolean;
  blockerReasons: string[];
  policyRef: string | null;
  budgetRef: string | null;
  permitId: string | null;
  approvalRefs: string[];
  connectorKind: string;
}

export interface LocalSignatureRecordV0 {
  algorithm: string;
  digest: string;
  keyRef: string;
  keyFingerprint: string;
  signedAt: string;
}

export interface OutboundExecutionRecordV0 {
  completedAt: string;
  metadata: Record<string, unknown>;
}

export interface WebhookRetryStateV0 {
  maxAttempts: number;
  pauseAfterFailures: number;
  retryBackoffSeconds: number;
  attemptNumber: number;
  paused: boolean;
  exhausted: boolean;
}

interface IntegrationRecordBaseV0<K extends IntegrationRecordKindV0> {
  schemaVersion: 0;
  schema: string;
  kind: K;
  id: string;
  workspaceId: string;
  providerKind: string;
  status: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkSourceRecordV0 extends IntegrationRecordBaseV0<"work_source"> {
  schema: "pluto.integration.work-source";
  sourceRef: ProviderResourceRefV0;
  governanceRefs: string[];
  capabilityRefs: string[];
  lastObservedAt: string | null;
}

export interface WorkSourceBindingRecordV0 extends IntegrationRecordBaseV0<"work_source_binding"> {
  schema: "pluto.integration.work-source-binding";
  workSourceRef: IntegrationRecordRefV0;
  targetRef: string;
  filtersSummary: string;
  governanceRefs: string[];
  cursorRef: string | null;
  lastSynchronizedAt: string | null;
}

export interface InboundWorkItemRecordV0 extends IntegrationRecordBaseV0<"inbound_work_item"> {
  schema: "pluto.integration.inbound-work-item";
  workSourceRef: IntegrationRecordRefV0;
  bindingRef: IntegrationRecordRefV0;
  providerItemRef: ProviderResourceRefV0;
  payloadRef: PayloadEnvelopeRefV0;
  relatedRecordRefs: string[];
  dedupeKey: string;
  receivedAt: string;
  processedAt: string | null;
}

export interface OutboundTargetRecordV0 extends IntegrationRecordBaseV0<"outbound_target"> {
  schema: "pluto.integration.outbound-target";
  targetRef: ProviderResourceRefV0;
  governanceRefs: string[];
  deliveryMode: string;
  readinessRef: string | null;
}

export interface OutboundWriteRecordV0 extends IntegrationRecordBaseV0<"outbound_write"> {
  schema: "pluto.integration.outbound-write";
  outboundTargetRef: IntegrationRecordRefV0;
  sourceRecordRefs: string[];
  payloadRef: PayloadEnvelopeRefV0;
  operation: string;
  idempotencyKey: string;
  providerWriteRef: string | null;
  attemptedAt: string;
  completedAt: string | null;
  decision: OutboundDecisionRecordV0;
  signing: LocalSignatureRecordV0;
  replayProtectionKey: string;
  connectorKind: string;
  responseSummary: string | null;
  execution: OutboundExecutionRecordV0 | null;
}

export interface WebhookSubscriptionRecordV0 extends IntegrationRecordBaseV0<"webhook_subscription"> {
  schema: "pluto.integration.webhook-subscription";
  topic: string;
  endpointRef: string;
  deliveryPolicyRef: string | null;
  providerSubscriptionRef: string | null;
  verifiedAt: string | null;
}

export interface WebhookDeliveryAttemptV0 extends IntegrationRecordBaseV0<"webhook_delivery_attempt"> {
  schema: "pluto.integration.webhook-delivery-attempt";
  subscriptionRef: IntegrationRecordRefV0;
  eventRef: ProviderResourceRefV0;
  payloadRef: PayloadEnvelopeRefV0;
  deliveryRef: string | null;
  attemptedAt: string;
  responseSummary: string;
  nextAttemptAt: string | null;
  signing: LocalSignatureRecordV0;
  replayProtectionKey: string;
  retry: WebhookRetryStateV0;
  blockerReasons: string[];
}

export type IntegrationRecordV0 =
  | WorkSourceRecordV0
  | WorkSourceBindingRecordV0
  | InboundWorkItemRecordV0
  | OutboundTargetRecordV0
  | OutboundWriteRecordV0
  | WebhookSubscriptionRecordV0
  | WebhookDeliveryAttemptV0;

const INTEGRATION_KIND_SET = new Set<string>(INTEGRATION_RECORD_KINDS_V0);
const FORBIDDEN_KEY_RE = /^(?:payload|rawPayload|providerPayload|rawProviderPayload|oauth|oauthToken|accessToken|refreshToken|idToken|clientSecret|authorization|headers|body|secret|secretRef|apiKey|webhookSecret|signingKey|signingSecret|signingKeyMaterial)$/i;
const FORBIDDEN_VALUE_RE = /(?:bearer\s+\S+|api[_-]?key\s*[:=]\s*\S+|token\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|-----BEGIN(?:[A-Z ]+)?PRIVATE KEY-----)/i;

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
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

function validateBaseRecord(
  value: unknown,
  expectedSchema: string,
  expectedKind: IntegrationRecordKindV0,
  extraStringFields: readonly string[] = [],
  extraNullableStringFields: readonly string[] = [],
  extraStringArrayFields: readonly string[] = [],
  extraRefFields: readonly string[] = [],
  extraProviderRefFields: readonly string[] = [],
  extraPayloadRefFields: readonly string[] = [],
): IntegrationRecordValidationResult<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const record = value as Record<string, unknown>;
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
  validateStringField(record, "providerKind", errors);
  validateStringField(record, "status", errors);
  validateStringField(record, "summary", errors);
  validateStringField(record, "createdAt", errors);
  validateStringField(record, "updatedAt", errors);

  for (const field of extraStringFields) {
    validateStringField(record, field, errors);
  }

  for (const field of extraNullableStringFields) {
    validateNullableStringField(record, field, errors);
  }

  for (const field of extraStringArrayFields) {
    validateStringArrayField(record, field, errors);
  }

  for (const field of extraRefFields) {
    validateIntegrationRecordRef(record[field], field, errors);
  }

  for (const field of extraProviderRefFields) {
    validateProviderResourceRef(record[field], field, errors);
  }

  for (const field of extraPayloadRefFields) {
    validatePayloadEnvelopeRef(record[field], field, errors);
  }

  try {
    assertNoSensitiveIntegrationMaterial(record, "record");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return errors.length === 0 ? { ok: true, value: record } : { ok: false, errors };
}

export function parseIntegrationRecordKindV0(value: unknown): IntegrationRecordKindLikeV0 | null {
  if (typeof value !== "string") return null;
  if (INTEGRATION_KIND_SET.has(value)) {
    return value as IntegrationRecordKindV0;
  }

  return value;
}

export function toIntegrationRecordRefV0(record: IntegrationRecordV0): IntegrationRecordRefV0 {
  return {
    schema: "pluto.integration.ref",
    schemaVersion: 0,
    kind: record.kind,
    recordId: record.id,
    workspaceId: record.workspaceId,
    providerKind: record.providerKind,
    summary: record.summary,
  };
}

export function validateIntegrationRecordRefV0(
  value: unknown,
): IntegrationRecordValidationResult<IntegrationRecordRefV0> {
  const errors: string[] = [];
  validateIntegrationRecordRef(value, "value", errors);
  return errors.length === 0
    ? { ok: true, value: value as IntegrationRecordRefV0 }
    : { ok: false, errors };
}

export function validateProviderResourceRefV0(
  value: unknown,
): IntegrationRecordValidationResult<ProviderResourceRefV0> {
  const errors: string[] = [];
  validateProviderResourceRef(value, "value", errors);
  return errors.length === 0
    ? { ok: true, value: value as ProviderResourceRefV0 }
    : { ok: false, errors };
}

export function validatePayloadEnvelopeRefV0(
  value: unknown,
): IntegrationRecordValidationResult<PayloadEnvelopeRefV0> {
  const errors: string[] = [];
  validatePayloadEnvelopeRef(value, "value", errors);
  return errors.length === 0
    ? { ok: true, value: value as PayloadEnvelopeRefV0 }
    : { ok: false, errors };
}

export function validateWorkSourceRecordV0(
  value: unknown,
): IntegrationRecordValidationResult<WorkSourceRecordV0> {
  const result = validateBaseRecord(
    value,
    "pluto.integration.work-source",
    "work_source",
    [],
    ["lastObservedAt"],
    ["governanceRefs", "capabilityRefs"],
    [],
    ["sourceRef"],
  );

  return result.ok ? { ok: true, value: result.value as unknown as WorkSourceRecordV0 } : result;
}

export function validateWorkSourceBindingRecordV0(
  value: unknown,
): IntegrationRecordValidationResult<WorkSourceBindingRecordV0> {
  const result = validateBaseRecord(
    value,
    "pluto.integration.work-source-binding",
    "work_source_binding",
    ["targetRef", "filtersSummary"],
    ["cursorRef", "lastSynchronizedAt"],
    ["governanceRefs"],
    ["workSourceRef"],
  );

  return result.ok ? { ok: true, value: result.value as unknown as WorkSourceBindingRecordV0 } : result;
}

export function validateInboundWorkItemRecordV0(
  value: unknown,
): IntegrationRecordValidationResult<InboundWorkItemRecordV0> {
  const result = validateBaseRecord(
    value,
    "pluto.integration.inbound-work-item",
    "inbound_work_item",
    ["dedupeKey", "receivedAt"],
    ["processedAt"],
    ["relatedRecordRefs"],
    ["workSourceRef", "bindingRef"],
    ["providerItemRef"],
    ["payloadRef"],
  );

  return result.ok ? { ok: true, value: result.value as unknown as InboundWorkItemRecordV0 } : result;
}

export function validateOutboundTargetRecordV0(
  value: unknown,
): IntegrationRecordValidationResult<OutboundTargetRecordV0> {
  const result = validateBaseRecord(
    value,
    "pluto.integration.outbound-target",
    "outbound_target",
    ["deliveryMode"],
    ["readinessRef"],
    ["governanceRefs"],
    [],
    ["targetRef"],
  );

  return result.ok ? { ok: true, value: result.value as unknown as OutboundTargetRecordV0 } : result;
}

export function validateOutboundWriteRecordV0(
  value: unknown,
): IntegrationRecordValidationResult<OutboundWriteRecordV0> {
  const result = validateBaseRecord(
    value,
    "pluto.integration.outbound-write",
    "outbound_write",
    ["operation", "idempotencyKey", "attemptedAt"],
    ["providerWriteRef", "completedAt"],
    ["sourceRecordRefs"],
    ["outboundTargetRef"],
    [],
    ["payloadRef"],
  );

  if (!result.ok) {
    return result;
  }

  const errors: string[] = [];
  validateOutboundDecisionRecord(result.value["decision"], "decision", errors);
  validateLocalSignatureRecord(result.value["signing"], "signing", errors);
  validateStringField(result.value, "replayProtectionKey", errors);
  validateStringField(result.value, "connectorKind", errors);
  validateNullableStringField(result.value, "responseSummary", errors);
  validateNullableExecutionRecord(result.value["execution"], "execution", errors);

  return errors.length === 0
    ? { ok: true, value: result.value as unknown as OutboundWriteRecordV0 }
    : { ok: false, errors };
}

export function validateWebhookSubscriptionRecordV0(
  value: unknown,
): IntegrationRecordValidationResult<WebhookSubscriptionRecordV0> {
  const result = validateBaseRecord(
    value,
    "pluto.integration.webhook-subscription",
    "webhook_subscription",
    ["topic", "endpointRef"],
    ["deliveryPolicyRef", "providerSubscriptionRef", "verifiedAt"],
  );

  return result.ok ? { ok: true, value: result.value as unknown as WebhookSubscriptionRecordV0 } : result;
}

export function validateWebhookDeliveryAttemptV0(
  value: unknown,
): IntegrationRecordValidationResult<WebhookDeliveryAttemptV0> {
  const result = validateBaseRecord(
    value,
    "pluto.integration.webhook-delivery-attempt",
    "webhook_delivery_attempt",
    ["attemptedAt", "responseSummary"],
    ["deliveryRef", "nextAttemptAt"],
    [],
    ["subscriptionRef"],
    ["eventRef"],
    ["payloadRef"],
  );

  if (!result.ok) {
    return result;
  }

  const errors: string[] = [];
  validateLocalSignatureRecord(result.value["signing"], "signing", errors);
  validateStringField(result.value, "replayProtectionKey", errors);
  validateWebhookRetryState(result.value["retry"], "retry", errors);
  validateStringArrayField(result.value, "blockerReasons", errors);

  return errors.length === 0
    ? { ok: true, value: result.value as unknown as WebhookDeliveryAttemptV0 }
    : { ok: false, errors };
}

export function assertNoSensitiveIntegrationMaterial(value: unknown, path = "value"): void {
  const leaks = collectSensitiveIntegrationMaterial(value, path);
  if (leaks.length > 0) {
    throw new Error(`sensitive integration material detected in ${leaks[0]}`);
  }
}

function validateIntegrationRecordRef(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an integration record ref object`);
    return;
  }

  if (record["schemaVersion"] !== 0) {
    errors.push(`${field}.schemaVersion must be 0`);
  }
  if (record["schema"] !== "pluto.integration.ref") {
    errors.push(`${field}.schema must be pluto.integration.ref`);
  }
  if (parseIntegrationRecordKindV0(record["kind"]) === null) {
    errors.push(`${field}.kind must be a string`);
  }
  for (const key of ["recordId", "workspaceId", "providerKind", "summary"] as const) {
    if (typeof record[key] !== "string") {
      errors.push(`${field}.${key} must be a string`);
    }
  }
}

function validateProviderResourceRef(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be a provider resource ref object`);
    return;
  }

  for (const key of ["providerKind", "resourceType", "externalId", "summary"] as const) {
    if (typeof record[key] !== "string") {
      errors.push(`${field}.${key} must be a string`);
    }
  }
}

function validatePayloadEnvelopeRef(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be a payload ref object`);
    return;
  }

  for (const key of ["providerKind", "refKind", "ref", "contentType", "summary"] as const) {
    if (typeof record[key] !== "string") {
      errors.push(`${field}.${key} must be a string`);
    }
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

  if (typeof record[field] !== "number") {
    errors.push(`${field} must be a number`);
  }
}

function validateOutboundDecisionRecord(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  validateBooleanField(record, "allowed", errorsFor(field, errors));
  validateStringArrayField(record, "blockerReasons", errorsFor(field, errors));
  validateNullableStringField(record, "policyRef", errorsFor(field, errors));
  validateNullableStringField(record, "budgetRef", errorsFor(field, errors));
  validateNullableStringField(record, "permitId", errorsFor(field, errors));
  validateStringArrayField(record, "approvalRefs", errorsFor(field, errors));
  validateStringField(record, "connectorKind", errorsFor(field, errors));
}

function validateLocalSignatureRecord(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  for (const key of ["algorithm", "digest", "keyRef", "keyFingerprint", "signedAt"] as const) {
    validateStringField(record, key, errorsFor(field, errors));
  }
}

function validateNullableExecutionRecord(value: unknown, field: string, errors: string[]): void {
  if (value === null) {
    return;
  }

  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object or null`);
    return;
  }

  validateStringField(record, "completedAt", errorsFor(field, errors));
  if (!hasOwnProperty(record, "metadata") || asRecord(record["metadata"]) === null) {
    errors.push(`${field}.metadata must be an object`);
  }
}

function validateWebhookRetryState(value: unknown, field: string, errors: string[]): void {
  const record = asRecord(value);
  if (!record) {
    errors.push(`${field} must be an object`);
    return;
  }

  validateNumberField(record, "maxAttempts", errorsFor(field, errors));
  validateNumberField(record, "pauseAfterFailures", errorsFor(field, errors));
  validateNumberField(record, "retryBackoffSeconds", errorsFor(field, errors));
  validateNumberField(record, "attemptNumber", errorsFor(field, errors));
  validateBooleanField(record, "paused", errorsFor(field, errors));
  validateBooleanField(record, "exhausted", errorsFor(field, errors));
}

function errorsFor(field: string, errors: string[]): string[] {
  return new Proxy(errors, {
    get(target, property, receiver) {
      if (property === "push") {
        return (...items: string[]) => target.push(...items.map((item) => `${field}.${item}`));
      }

      return Reflect.get(target, property, receiver);
    },
  }) as string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function collectSensitiveIntegrationMaterial(value: unknown, path: string): string[] {
  if (typeof value === "string") {
    return FORBIDDEN_VALUE_RE.test(value) ? [path] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectSensitiveIntegrationMaterial(entry, `${path}[${index}]`));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const leaks: string[] = [];
  for (const [key, entry] of Object.entries(record)) {
    const nextPath = `${path}.${key}`;
    if (FORBIDDEN_KEY_RE.test(key)) {
      leaks.push(nextPath);
      continue;
    }
    leaks.push(...collectSensitiveIntegrationMaterial(entry, nextPath));
  }

  return leaks;
}
