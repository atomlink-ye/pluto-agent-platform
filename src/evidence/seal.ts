import type { EvidencePacketV0 } from "../contracts/types.js";
import type { SealedEvidenceRefV0 } from "../contracts/evidence-graph.js";
import {
  toImmutableEvidencePacketMetadataV0,
  toSealedEvidenceRefV0,
  validateSealedEvidenceRefV0,
} from "../contracts/evidence-graph.js";
import { validateEvidencePacketV0 } from "../orchestrator/evidence.js";

export function assertEvidenceSealed(
  sealedEvidence: unknown,
  packet?: unknown,
): SealedEvidenceRefV0 {
  const sealed = requireSealedEvidenceRef(sealedEvidence);

  if (!sealed.sealChecksum.trim()) {
    throw new Error("sealed evidence must include a seal checksum");
  }

  if (sealed.redactionSummary.redactedAt === null) {
    throw new Error("sealed evidence must include redaction before seal");
  }

  if (sealed.redactionSummary.redactedAt > sealed.sealedAt) {
    throw new Error("sealed evidence redaction must occur before or at seal time");
  }

  if (sealed.runId !== sealed.sourceRun.runId) {
    throw new Error("sealed evidence runId must match source run");
  }

  if (packet === undefined) {
    return sealed;
  }

  const evidencePacket = requireEvidencePacket(packet);
  const immutablePacket = toImmutableEvidencePacketMetadataV0(evidencePacket);

  if (sealed.runId !== evidencePacket.runId) {
    throw new Error("sealed evidence runId must match packet runId");
  }

  if (sealed.immutablePacket.status !== immutablePacket.status) {
    throw new Error("sealed evidence immutable packet status must match packet status");
  }

  if (sealed.immutablePacket.blockerReason !== immutablePacket.blockerReason) {
    throw new Error("sealed evidence immutable packet blockerReason must match packet blockerReason");
  }

  if (sealed.immutablePacket.startedAt !== immutablePacket.startedAt) {
    throw new Error("sealed evidence immutable packet startedAt must match packet startedAt");
  }

  if (sealed.immutablePacket.finishedAt !== immutablePacket.finishedAt) {
    throw new Error("sealed evidence immutable packet finishedAt must match packet finishedAt");
  }

  if (sealed.immutablePacket.generatedAt !== immutablePacket.generatedAt) {
    throw new Error("sealed evidence immutable packet generatedAt must match packet generatedAt");
  }

  if (sealed.immutablePacket.workerCount !== immutablePacket.workerCount) {
    throw new Error("sealed evidence immutable packet workerCount must match packet worker count");
  }

  if (sealed.immutablePacket.validation.outcome !== immutablePacket.validation.outcome) {
    throw new Error("sealed evidence immutable packet validation outcome must match packet validation outcome");
  }

  if (sealed.immutablePacket.validation.reason !== immutablePacket.validation.reason) {
    throw new Error("sealed evidence immutable packet validation reason must match packet validation reason");
  }

  return sealed;
}

export function assertEvidenceUsableForGovernance(
  sealedEvidence: unknown,
  packet?: unknown,
): SealedEvidenceRefV0 {
  const sealed = assertEvidenceSealed(sealedEvidence, packet);

  if (sealed.validationSummary.outcome === "fail") {
    throw new Error("sealed evidence with failed validation is not usable for governance");
  }

  return sealed;
}

function requireSealedEvidenceRef(value: unknown): SealedEvidenceRefV0 {
  const validated = validateSealedEvidenceRefV0(value);
  if (!validated.ok) {
    throw new Error(`invalid sealed evidence ref: ${validated.errors.join(", ")}`);
  }

  return toSealedEvidenceRefV0({
    ...validated.value,
    sourceRun: { ...validated.value.sourceRun },
    validationSummary: { ...validated.value.validationSummary },
    redactionSummary: { ...validated.value.redactionSummary },
    immutablePacket: {
      ...validated.value.immutablePacket,
      validation: { ...validated.value.immutablePacket.validation },
    },
  });
}

function requireEvidencePacket(value: unknown): EvidencePacketV0 {
  const validated = validateEvidencePacketV0(value);
  if (!validated.ok) {
    throw new Error(`invalid evidence packet: ${validated.errors.join(", ")}`);
  }

  return value as EvidencePacketV0;
}
