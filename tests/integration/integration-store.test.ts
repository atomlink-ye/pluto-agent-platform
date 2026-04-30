import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkSourceRecordV0 } from "@/contracts/integration.js";
import { IntegrationStore, integrationDir } from "@/integration/integration-store.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-integration-store-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeWorkSourceRecord(): WorkSourceRecordV0 {
  return {
    schemaVersion: 0,
    schema: "pluto.integration.work-source",
    kind: "work_source",
    id: "source-1",
    workspaceId: "workspace-1",
    providerKind: "linear",
    status: "active",
    summary: "Primary work source",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    sourceRef: {
      providerKind: "linear",
      resourceType: "project",
      externalId: "project-123",
      summary: "Linear project 123",
    },
    governanceRefs: ["schedule-1"],
    capabilityRefs: ["issues.read"],
    lastObservedAt: null,
  };
}

describe("IntegrationStore", () => {
  it("round-trips governed integration records while keeping file paths private", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new IntegrationStore({ dataDir });
    const record = makeWorkSourceRecord();

    const persistedRecord = await store.put("work_source", record);

    expect(persistedRecord).toEqual(record);
    expect(await store.get("work_source", record.id)).toEqual(record);
    expect(await store.list("work_source")).toEqual([record]);
    expect(await store.exists("work_source", record.id)).toBe(true);

    const persisted = await readFile(join(integrationDir(dataDir, "work_source"), "source-1.json"), "utf8");
    expect(JSON.parse(persisted)).toEqual(record);
    expect(persisted).not.toContain("rawPayload");
  });

  it("keeps .pluto integration paths as implementation details", async () => {
    const dataDir = join(workDir, ".pluto");
    const store = new IntegrationStore({ dataDir });

    await store.put("work_source", makeWorkSourceRecord());

    const kindEntries = await readdir(integrationDir(dataDir, "work_source"));
    expect(kindEntries).toEqual(["source-1.json"]);

    const record = await store.get("work_source", "source-1");
    expect(record).not.toBeNull();
    expect(JSON.stringify(record)).not.toContain(dataDir);
    expect(JSON.stringify(record)).not.toContain("source-1.json");
  });

  it("tolerates missing records and reports supported kinds", async () => {
    const store = new IntegrationStore({ dataDir: join(workDir, ".pluto") });

    await expect(store.get("work_source", "missing")).resolves.toBeNull();
    await expect(store.list("work_source")).resolves.toEqual([]);
    await expect(store.listKinds()).resolves.toEqual([
      "work_source",
      "work_source_binding",
      "inbound_work_item",
      "outbound_target",
      "outbound_write",
      "webhook_subscription",
      "webhook_delivery_attempt",
    ]);
  });
});
