import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EventLedgerEntryV0, MetadataRecordV0 } from "@/contracts/storage.js";
import {
  appendLedgerEventV0,
  findDuplicateLedgerEventV0,
} from "@/storage/event-ledger.js";
import { StorageStore } from "@/storage/storage-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-event-ledger-test-"));
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
    retentionClass: "governed_record",
    sensitivityClass: "internal",
    summary: "Governed document metadata",
    metadata: { title: "Launch plan" },
    checksum: { algorithm: "sha256", digest: "meta-checksum" },
  };
}

function makeLedgerEvent(): EventLedgerEntryV0 {
  const subject = makeMetadataRecord();
  return {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "event_ledger",
    id: "event-1",
    workspaceId: subject.workspaceId,
    objectType: subject.objectType,
    status: "active",
    actorRefs: subject.actorRefs,
    createdAt: "2026-04-30T00:00:02.000Z",
    updatedAt: "2026-04-30T00:00:02.000Z",
    retentionClass: subject.retentionClass,
    sensitivityClass: subject.sensitivityClass,
    summary: "Storage materialized event",
    eventType: "storage.materialized",
    subjectRef: {
      schema: "pluto.storage.ref",
      schemaVersion: 0,
      storageVersion: "local-v0",
      kind: subject.kind,
      recordId: subject.id,
      workspaceId: subject.workspaceId,
      objectType: subject.objectType,
      status: subject.status,
      summary: subject.summary,
      checksum: subject.checksum,
    },
    occurredAt: "2026-04-30T00:00:02.000Z",
    detail: { action: "materialized" },
  };
}

describe("appendLedgerEventV0", () => {
  it("appends a durable event once and reuses the prior durable result for duplicate idempotency keys", async () => {
    const store = new StorageStore({ dataDir: join(workDir, ".pluto") });
    const event = makeLedgerEvent();

    const first = await appendLedgerEventV0({
      store,
      event,
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
    });
    const second = await appendLedgerEventV0({
      store,
      event: { ...event, id: "event-2" },
      idempotencyKey: "idem-1",
      correlationId: "corr-2",
    });

    expect(first.status).toBe("succeeded");
    expect(first.duplicate).toBe(false);
    expect(second.status).toBe("succeeded");
    expect(second.duplicate).toBe(true);
    expect(second.record?.id).toBe("event-1");
    expect(await store.list("event_ledger")).toHaveLength(1);
  });

  it("matches duplicates by correlation id and blocks completion when durable writes are unavailable", async () => {
    const store = new StorageStore({ dataDir: join(workDir, ".pluto") });
    const event = makeLedgerEvent();

    await appendLedgerEventV0({
      store,
      event,
      idempotencyKey: "idem-1",
      correlationId: "corr-1",
    });

    const duplicate = await findDuplicateLedgerEventV0({
      store,
      workspaceId: event.workspaceId,
      subjectRef: event.subjectRef,
      eventType: event.eventType,
      correlationId: "corr-1",
    });
    const blocked = await appendLedgerEventV0({
      store,
      event: { ...event, id: "event-3" },
      idempotencyKey: "idem-3",
      correlationId: "corr-3",
      durableWriteAvailable: false,
    });

    expect(duplicate?.id).toBe("event-1");
    expect(blocked).toMatchObject({
      status: "blocked",
      durable: false,
      duplicate: false,
      reason: "durable_write_unavailable",
    });
    expect(await store.list("event_ledger")).toHaveLength(1);
  });
});
