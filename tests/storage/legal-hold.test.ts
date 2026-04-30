import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LegalHoldOverlayV0, MetadataRecordV0 } from "@/contracts/storage.js";
import { toStorageRefV0 } from "@/contracts/storage.js";
import { requestDeletionV0 } from "@/storage/deletion.js";
import { StorageStore } from "@/storage/storage-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-legal-hold-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeRecord(): MetadataRecordV0 {
  return {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "metadata",
    id: "meta-1",
    workspaceId: "workspace-1",
    objectType: "document-version",
    status: "active",
    actorRefs: [{ actorId: "user-1", actorType: "user" }],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    retentionClass: "audit_record",
    sensitivityClass: "internal",
    summary: "Held metadata",
    metadata: { title: "Launch plan" },
    checksum: { algorithm: "sha256", digest: "meta-checksum" },
  };
}

function makeHold(record: MetadataRecordV0): LegalHoldOverlayV0 {
  return {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "legal_hold_overlay",
    id: "hold-1",
    workspaceId: record.workspaceId,
    objectType: record.objectType,
    status: "held",
    actorRefs: [{ actorId: "legal-1", actorType: "service" }],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    retentionClass: "audit_record",
    sensitivityClass: "internal",
    summary: "Active investigation hold",
    holdId: "hold-1",
    targetRefs: [toStorageRefV0(record)],
    activatedAt: "2026-04-30T00:00:00.000Z",
    releasedAt: null,
    note: "Preserve history during active case",
  };
}

describe("legal hold deletion safety", () => {
  it("blocks destructive deletion and records the blocking event reason", async () => {
    const store = new StorageStore({ dataDir: join(workDir, ".pluto") });
    const record = makeRecord();
    const hold = makeHold(record);
    await store.put("metadata", record);
    await store.put("legal_hold_overlay", hold);

    const result = await requestDeletionV0({
      store,
      target: record,
      requestedBy: { actorId: "user-2", actorType: "user" },
      requestedAt: "2026-05-01T00:00:00.000Z",
      reason: "Cleanup request",
      deletionRequestId: "delete-1",
    });

    expect(result).toMatchObject({ status: "blocked", reason: "legal_hold_active" });
    expect(await store.get("metadata", record.id)).toEqual(record);
    expect(await store.list("deletion_request")).toEqual([]);
    expect(await store.list("event_ledger")).toHaveLength(1);
    expect((await store.list("event_ledger"))[0]?.detail).toMatchObject({ reason: "legal_hold_active" });
  });

  it("also blocks retention shortening while a legal hold remains active", async () => {
    const store = new StorageStore({ dataDir: join(workDir, ".pluto") });
    const record = makeRecord();
    await store.put("metadata", record);
    await store.put("legal_hold_overlay", makeHold(record));

    const result = await requestDeletionV0({
      store,
      target: record,
      requestedBy: { actorId: "user-2", actorType: "user" },
      requestedAt: "2026-05-01T00:00:00.000Z",
      reason: "Shorten retention",
      deletionRequestId: "delete-2",
      nextRetentionClass: "short_lived",
    });

    expect(result).toMatchObject({ status: "blocked", reason: "legal_hold_active" });
    expect(await store.list("tombstone")).toEqual([]);
  });
});
