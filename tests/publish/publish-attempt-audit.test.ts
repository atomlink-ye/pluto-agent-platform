import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PublishStore } from "@/publish/publish-store.js";

function makeChannelTarget() {
  return {
    schemaVersion: 0 as const,
    channelId: "web-primary",
    targetId: "site-homepage",
    targetKind: "cms_entry",
    destinationSummary: "Contentful homepage entry [REDACTED:destination]",
    readinessRef: "rr-1",
    approvalRef: "approval-1",
    blockedNotes: [],
    degradedNotes: [],
    status: "ready",
  };
}

describe("publish attempt audit", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("emits auditable publish, rollback, retract, and supersede events while keeping immutable history", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-publish-audit-"));
    const store = new PublishStore({ dataDir });

    await store.recordPublishAttempt({
      schema: "pluto.publish.attempt",
      schemaVersion: 0,
      id: "attempt-1",
      publishPackageId: "pkg-1",
      exportAssetId: "asset-1",
      channelTarget: makeChannelTarget(),
      idempotencyKey: "idem-1",
      publisher: {
        principalId: "publisher-1",
        roleLabels: ["release-manager"],
      },
      providerResultRefs: {
        externalRef: "job-1",
        receiptPath: ".pluto/publish/receipts/job-1.json",
        summary: "Summary only",
      },
      payloadSummary: {
        summary: "Redacted connector request.",
        redactedFields: ["authorization"],
        detailKeys: ["channelId"],
      },
      status: "succeeded",
      blockedReasons: [],
      createdAt: "2026-04-30T00:03:00.000Z",
    });

    await store.recordRollbackRetract({
      schema: "pluto.publish.rollback",
      schemaVersion: 0,
      id: "rollback-1",
      publishPackageId: "pkg-1",
      publishAttemptId: "attempt-1",
      action: "rollback",
      actorId: "publisher-1",
      reason: "Rollback after QA regression.",
      replacementPackageId: null,
      createdAt: "2026-04-30T00:04:00.000Z",
    });
    await store.recordRollbackRetract({
      schema: "pluto.publish.rollback",
      schemaVersion: 0,
      id: "retract-1",
      publishPackageId: "pkg-1",
      publishAttemptId: "attempt-1",
      action: "retract",
      actorId: "publisher-2",
      reason: "Retracted to remove stale announcement.",
      replacementPackageId: null,
      createdAt: "2026-04-30T00:05:00.000Z",
    });
    await store.recordRollbackRetract({
      schema: "pluto.publish.rollback",
      schemaVersion: 0,
      id: "supersede-1",
      publishPackageId: "pkg-1",
      publishAttemptId: "attempt-1",
      action: "supersede",
      actorId: "publisher-3",
      reason: "Superseded by package pkg-2.",
      replacementPackageId: "pkg-2",
      createdAt: "2026-04-30T00:06:00.000Z",
    });

    const attempts = await store.listPublishAttempts();
    const rollbacks = await store.listRollbackRetractRecords();
    const auditEvents = await store.listAuditEvents();

    expect(attempts).toHaveLength(1);
    expect(rollbacks.map((record) => record.action)).toEqual(["rollback", "retract", "supersede"]);
    expect(auditEvents.map((event) => event.eventType)).toEqual([
      "publish",
      "rollback",
      "retract",
      "supersede",
    ]);
    expect(auditEvents.map((event) => event.recordId)).toEqual([
      "attempt-1",
      "rollback-1",
      "retract-1",
      "supersede-1",
    ]);
    expect(await store.getPublishAttempt("attempt-1")).toMatchObject({
      id: "attempt-1",
      status: "succeeded",
      idempotencyKey: "idem-1",
    });
  });

  it("rejects duplicate idempotency keys without mutating prior attempt history", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-publish-idempotency-"));
    const store = new PublishStore({ dataDir });

    await store.recordPublishAttempt({
      schema: "pluto.publish.attempt",
      schemaVersion: 0,
      id: "attempt-1",
      publishPackageId: "pkg-1",
      exportAssetId: null,
      channelTarget: makeChannelTarget(),
      idempotencyKey: "idem-dup",
      publisher: {
        principalId: "publisher-1",
        roleLabels: ["release-manager"],
      },
      providerResultRefs: {
        externalRef: null,
        receiptPath: null,
        summary: "Summary only",
      },
      payloadSummary: {
        summary: "Redacted connector request.",
        redactedFields: ["authorization"],
        detailKeys: ["channelId"],
      },
      status: "queued",
      blockedReasons: [],
      createdAt: "2026-04-30T00:03:00.000Z",
    });

    await expect(store.recordPublishAttempt({
      schema: "pluto.publish.attempt",
      schemaVersion: 0,
      id: "attempt-2",
      publishPackageId: "pkg-1",
      exportAssetId: null,
      channelTarget: makeChannelTarget(),
      idempotencyKey: "idem-dup",
      publisher: {
        principalId: "publisher-2",
        roleLabels: ["release-manager"],
      },
      providerResultRefs: {
        externalRef: null,
        receiptPath: null,
        summary: "Summary only",
      },
      payloadSummary: {
        summary: "Redacted connector request.",
        redactedFields: ["authorization"],
        detailKeys: ["channelId"],
      },
      status: "queued",
      blockedReasons: [],
      createdAt: "2026-04-30T00:04:00.000Z",
    })).rejects.toThrow("duplicate publish idempotency key: idem-dup");

    expect((await store.listPublishAttempts()).map((record) => record.id)).toEqual(["attempt-1"]);
    expect((await store.listAuditEvents()).map((event) => event.recordId)).toEqual(["attempt-1"]);
  });
});
