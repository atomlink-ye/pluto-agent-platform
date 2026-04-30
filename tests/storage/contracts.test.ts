import { describe, expect, it } from "vitest";

import {
  toStorageRefV0,
  toStorageStatusV0,
  validateContentBlobRecordV0,
  validateDeletionRequestV0,
  validateEventLedgerEntryV0,
  validateExternalRefRecordV0,
  validateLegalHoldOverlayV0,
  validateMetadataRecordV0,
  validateRetentionPolicyV0,
  validateTombstoneRecordV0,
} from "@/contracts/storage.js";

const baseRecord = {
  schemaVersion: 0 as const,
  storageVersion: "local-v0" as const,
  workspaceId: "workspace-1",
  objectType: "document-version",
  status: "active",
  actorRefs: [{ actorId: "user-1", actorType: "user" as const }],
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  retentionClass: "durable",
  sensitivityClass: "internal",
  summary: "Stored object summary",
};

const metadataRecord = {
  ...baseRecord,
  kind: "metadata" as const,
  id: "meta-1",
  metadata: { source: "governance" },
  checksum: { algorithm: "sha256" as const, digest: "meta-checksum" },
};

const metadataRef = toStorageRefV0(metadataRecord);

describe("storage contracts", () => {
  it("keeps all local-v0 storage contracts JSON-serializable and path-free", () => {
    const contentBlob = {
      ...baseRecord,
      kind: "content_blob" as const,
      id: "blob-1",
      content: {
        mediaType: "application/json",
        contentLengthBytes: 128,
        encoding: "utf8",
        checksum: { algorithm: "sha256" as const, digest: "blob-checksum" },
        contentRef: "content-blob-1",
      },
      derivedFromRefs: [metadataRef],
    };

    const externalRef = {
      ...baseRecord,
      kind: "external_ref" as const,
      id: "external-1",
      status: "external",
      external: {
        uri: "s3://partner-bucket/documents/doc-1",
        availability: "online" as const,
        trustNote: "Partner-owned object; treat metadata as advisory.",
        availabilityNote: "Availability depends on the external provider.",
        retentionNote: "External retention may outlive Pluto policy windows.",
        deletionGuarantee: "none" as const,
        checksum: { algorithm: "sha256" as const, digest: "external-checksum" },
        externalVersion: "partner-v2",
      },
    };

    const eventLedger = {
      ...baseRecord,
      kind: "event_ledger" as const,
      id: "event-1",
      eventType: "storage.materialized",
      subjectRef: metadataRef,
      occurredAt: "2026-04-30T00:00:02.000Z",
      detail: { action: "materialized" },
      relatedRefs: [toStorageRefV0(contentBlob)],
      checksum: { algorithm: "sha256" as const, digest: "event-checksum" },
    };

    const retentionPolicy = {
      ...baseRecord,
      kind: "retention_policy" as const,
      id: "retention-1",
      appliesTo: [metadataRef],
      mode: "retain-until" as const,
      retainUntil: "2026-12-31T00:00:00.000Z",
      note: "Keep until audit window closes.",
    };

    const deletionRequest = {
      ...baseRecord,
      kind: "deletion_request" as const,
      id: "delete-1",
      targetRef: metadataRef,
      requestedBy: { actorId: "user-2", actorType: "user" as const },
      requestedAt: "2026-05-01T00:00:00.000Z",
      reason: "User requested local cleanup.",
      approvalRef: metadataRef,
      deletionGuarantee: "best-effort-local" as const,
    };

    const tombstone = {
      ...baseRecord,
      kind: "tombstone" as const,
      id: "tombstone-1",
      status: "deleted",
      targetRef: metadataRef,
      tombstonedAt: "2026-05-01T00:00:01.000Z",
      tombstoneReason: "Local object deleted after request.",
      deletionRequestRef: toStorageRefV0(deletionRequest),
      priorChecksum: { algorithm: "sha256" as const, digest: "meta-checksum" },
    };

    const legalHold = {
      ...baseRecord,
      kind: "legal_hold_overlay" as const,
      id: "hold-1",
      status: "held",
      holdId: "lh-1",
      targetRefs: [metadataRef, toStorageRefV0(contentBlob)],
      activatedAt: "2026-05-01T00:00:02.000Z",
      releasedAt: null,
      note: "Preserve records for active investigation.",
    };

    expect(validateMetadataRecordV0(metadataRecord).ok).toBe(true);
    expect(validateContentBlobRecordV0(contentBlob).ok).toBe(true);
    expect(validateExternalRefRecordV0(externalRef).ok).toBe(true);
    expect(validateEventLedgerEntryV0(eventLedger).ok).toBe(true);
    expect(validateRetentionPolicyV0(retentionPolicy).ok).toBe(true);
    expect(validateDeletionRequestV0(deletionRequest).ok).toBe(true);
    expect(validateTombstoneRecordV0(tombstone).ok).toBe(true);
    expect(validateLegalHoldOverlayV0(legalHold).ok).toBe(true);

    const serialized = JSON.stringify({
      metadataRecord,
      contentBlob,
      externalRef,
      eventLedger,
      retentionPolicy,
      deletionRequest,
      tombstone,
      legalHold,
      metadataStatus: toStorageStatusV0(metadataRecord),
    });

    expect(serialized).not.toContain(".pluto");
    expect(serialized).not.toContain("providerPath");
  });

  it("requires shared identity and version markers across v0 records", () => {
    const missingId = validateMetadataRecordV0({
      ...baseRecord,
      kind: "metadata",
      metadata: { source: "governance" },
      checksum: { algorithm: "sha256", digest: "meta-checksum" },
    });

    expect(missingId.ok).toBe(false);
    expect(missingId.ok ? [] : missingId.errors).toContain("missing required field: id");

    const wrongStorageVersion = validateExternalRefRecordV0({
      ...baseRecord,
      kind: "external_ref",
      id: "external-1",
      storageVersion: "remote-v9",
      external: {
        uri: "https://example.com/object/1",
        availability: "online",
        trustNote: "External object",
        availabilityNote: "Subject to external uptime",
        retentionNote: "Managed externally",
        deletionGuarantee: "none",
      },
    });

    expect(wrongStorageVersion.ok).toBe(false);
    expect(wrongStorageVersion.ok ? [] : wrongStorageVersion.errors).toContain(
      "storageVersion must be local-v0",
    );
  });

  it("builds product-facing refs and summaries without exposing implementation paths", () => {
    const ref = toStorageRefV0(metadataRecord);
    const status = toStorageStatusV0(metadataRecord);

    expect(ref).toEqual({
      schema: "pluto.storage.ref",
      schemaVersion: 0,
      storageVersion: "local-v0",
      kind: "metadata",
      recordId: "meta-1",
      workspaceId: "workspace-1",
      objectType: "document-version",
      status: "active",
      summary: "Stored object summary",
      checksum: { algorithm: "sha256", digest: "meta-checksum" },
    });
    expect(status.ref).toEqual(ref);
    expect(JSON.stringify(status)).not.toContain("/");
  });

  it("tolerates additive future fields", () => {
    const result = validateMetadataRecordV0({
      ...metadataRecord,
      futureField: { lane: "r5" },
    });

    expect(result.ok).toBe(true);
  });
});
