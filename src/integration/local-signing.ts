import { createHash, createHmac } from "node:crypto";

import type { SecretRefV0 } from "../contracts/security.js";

export interface LocalSigningPayloadV0 {
  workspaceId: string;
  providerKind: string;
  purpose: string;
  contentType: string;
  body: string;
}

export interface LocalSigningSecretV0 {
  ref: Pick<SecretRefV0, "workspaceId" | "name" | "ref" | "displayLabel">;
  keyMaterial: string;
}

export interface LocalSignatureEnvelopeV0 {
  algorithm: "hmac-sha256";
  digest: string;
  digestRef: string;
  signature: string;
  keyRef: string;
  keyFingerprint: string;
  signedAt: string;
}

export function createLocalSignatureEnvelopeV0(input: {
  payload: LocalSigningPayloadV0;
  secret: LocalSigningSecretV0;
  signedAt: string;
}): LocalSignatureEnvelopeV0 {
  if (input.secret.keyMaterial.length === 0) {
    throw new Error("local_signing_key_material_required");
  }

  const digest = buildLocalPayloadDigestV0(input.payload);
  const signature = createHmac("sha256", input.secret.keyMaterial).update(digest).digest("hex");
  const keyFingerprint = createHash("sha256")
    .update(`${input.secret.ref.workspaceId}:${input.secret.ref.ref}:${input.secret.ref.name}`)
    .digest("hex");

  return {
    algorithm: "hmac-sha256",
    digest,
    digestRef: `sha256:${digest}`,
    signature,
    keyRef: `local-signing:${input.secret.ref.name}`,
    keyFingerprint,
    signedAt: input.signedAt,
  };
}

export function canonicalizeLocalSigningPayloadV0(payload: LocalSigningPayloadV0): string {
  return JSON.stringify({
    workspaceId: payload.workspaceId,
    providerKind: payload.providerKind,
    purpose: payload.purpose,
    contentType: payload.contentType,
    body: payload.body,
  });
}

export function buildLocalPayloadDigestV0(payload: LocalSigningPayloadV0): string {
  return createHash("sha256").update(canonicalizeLocalSigningPayloadV0(payload)).digest("hex");
}

export function buildReplayProtectionKeyV0(parts: readonly string[]): string {
  const canonical = parts.map((part) => part.trim()).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
