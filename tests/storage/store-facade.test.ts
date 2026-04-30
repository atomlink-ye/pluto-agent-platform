import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MetadataRecordV0 } from "@/contracts/storage.js";
import { StorageStore } from "@/storage/storage-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-storage-store-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeMetadataRecord(): MetadataRecordV0 {
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
    retentionClass: "durable",
    sensitivityClass: "internal",
    summary: "Primary metadata record",
    metadata: { title: "Launch plan" },
    checksum: { algorithm: "sha256", digest: "meta-checksum" },
  };
}

describe("StorageStore", () => {
  it("round-trips records while returning public summaries instead of local paths", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new StorageStore({ dataDir });
    const record = makeMetadataRecord();

    const status = await store.put("metadata", record);

    expect(status.ref.recordId).toBe(record.id);
    expect(status.ref.summary).toBe(record.summary);
    expect(JSON.stringify(status)).not.toContain(dataDir);

    expect(await store.get("metadata", record.id)).toEqual(record);
    expect(await store.getStatus(status.ref)).toEqual(status);
    expect(await store.listStatuses("metadata")).toEqual([status]);

    const persisted = await readFile(join(dataDir, "storage", "metadata", `${record.id}.json`), "utf8");
    expect(JSON.parse(persisted)).toEqual(record);
  });

  it("keeps local pathing as a private implementation detail", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new StorageStore({ dataDir });
    const record = makeMetadataRecord();

    await store.put("metadata", record);

    const kindEntries = await readdir(join(dataDir, "storage", "metadata"));
    expect(kindEntries).toEqual(["meta-1.json"]);

    const status = await store.getStatus({
      schema: "pluto.storage.ref",
      schemaVersion: 0,
      storageVersion: "local-v0",
      kind: "metadata",
      recordId: "meta-1",
      workspaceId: "workspace-1",
      objectType: "document-version",
      status: "active",
      summary: "Primary metadata record",
      checksum: { algorithm: "sha256", digest: "meta-checksum" },
    });

    expect(status).not.toBeNull();
    expect(Object.keys(status ?? {})).not.toContain("path");
    expect(JSON.stringify(status)).not.toContain("meta-1.json");
  });

  it("tolerates missing records and reports supported kinds", async () => {
    const store = new StorageStore({ dataDir: join(workDir, ".pluto") });

    await expect(store.get("metadata", "missing")).resolves.toBeNull();
    await expect(store.listStatuses("metadata")).resolves.toEqual([]);
    await expect(store.listKinds()).resolves.toEqual([
      "metadata",
      "content_blob",
      "external_ref",
      "event_ledger",
      "retention_policy",
      "deletion_request",
      "tombstone",
      "legal_hold_overlay",
    ]);
  });
});
