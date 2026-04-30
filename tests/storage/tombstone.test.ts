import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MetadataRecordV0 } from "@/contracts/storage.js";
import { requestDeletionV0 } from "@/storage/deletion.js";
import { StorageStore } from "@/storage/storage-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-tombstone-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeRecord(retentionClass: MetadataRecordV0["retentionClass"]): MetadataRecordV0 {
  return {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "metadata",
    id: `meta-${retentionClass}`,
    workspaceId: "workspace-1",
    objectType: "document-version",
    status: "active",
    actorRefs: [{ actorId: "user-1", actorType: "user" }],
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    retentionClass,
    sensitivityClass: "internal",
    summary: `Metadata ${retentionClass}`,
    metadata: { title: "Launch plan" },
    checksum: { algorithm: "sha256", digest: `checksum-${retentionClass}` },
  };
}

describe("requestDeletionV0 tombstone behavior", () => {
  it("creates a tombstone for governed records before removing the original record", async () => {
    const store = new StorageStore({ dataDir: join(workDir, ".pluto") });
    const record = makeRecord("governed_record");
    await store.put("metadata", record);

    const result = await requestDeletionV0({
      store,
      target: record,
      requestedBy: { actorId: "user-2", actorType: "user" },
      requestedAt: "2026-05-01T00:00:00.000Z",
      reason: "Governed cleanup",
      deletionRequestId: "delete-1",
    });

    expect(result.status).toBe("tombstoned");
    expect(result.tombstone?.targetRef.recordId).toBe(record.id);
    expect(result.tombstone?.deletionRequestRef?.recordId).toBe("delete-1");
    expect(await store.get("metadata", record.id)).toBeNull();
    expect(await store.get("tombstone", result.tombstone?.id ?? "missing")).not.toBeNull();
  });

  it("deletes short-lived records without creating a tombstone", async () => {
    const store = new StorageStore({ dataDir: join(workDir, ".pluto") });
    const record = makeRecord("short_lived");
    await store.put("metadata", record);

    const result = await requestDeletionV0({
      store,
      target: record,
      requestedBy: { actorId: "user-2", actorType: "user" },
      requestedAt: "2026-05-01T00:00:00.000Z",
      reason: "Ephemeral cleanup",
      deletionRequestId: "delete-2",
    });

    expect(result.status).toBe("deleted");
    expect(result.tombstone).toBeNull();
    expect(await store.get("metadata", record.id)).toBeNull();
    expect(await store.list("tombstone")).toEqual([]);
  });
});
