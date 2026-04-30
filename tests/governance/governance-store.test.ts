import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  ApprovalRecordV0,
  DocumentRecordV0,
  GovernanceObjectKindV0,
  PlaybookRecordV0,
  PublishPackageRecordV0,
  ReviewRecordV0,
  ScheduleRecordV0,
  ScenarioRecordV0,
  VersionRecordV0,
} from "@/contracts/governance.js";
import { GovernanceStore, governanceDir } from "@/governance/governance-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-governance-store-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const baseRecord = {
  schemaVersion: 0 as const,
  workspaceId: "workspace-1",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "draft",
};

function fixtures() {
  const document: DocumentRecordV0 = {
    ...baseRecord,
    kind: "document",
    id: "doc-1",
    title: "Docs IA",
    ownerId: "owner-1",
    currentVersionId: "ver-1",
  };
  const version: VersionRecordV0 = {
    ...baseRecord,
    kind: "version",
    id: "ver-1",
    documentId: document.id,
    createdById: "creator-1",
    label: "v1",
  };
  const review: ReviewRecordV0 = {
    ...baseRecord,
    kind: "review",
    id: "review-1",
    documentId: document.id,
    versionId: version.id,
    requestedById: "requester-1",
    reviewerId: "reviewer-1",
  };
  const approval: ApprovalRecordV0 = {
    ...baseRecord,
    kind: "approval",
    id: "approval-1",
    documentId: document.id,
    versionId: version.id,
    requestedById: "requester-1",
    approverId: "approver-1",
  };
  const publishPackage: PublishPackageRecordV0 = {
    ...baseRecord,
    kind: "publish_package",
    id: "package-1",
    documentId: document.id,
    versionId: version.id,
    ownerId: "owner-1",
    targetId: "target-1",
  };
  const playbook: PlaybookRecordV0 = {
    ...baseRecord,
    kind: "playbook",
    id: "playbook-1",
    title: "Editorial rollout",
    ownerId: "owner-1",
  };
  const scenario: ScenarioRecordV0 = {
    ...baseRecord,
    kind: "scenario",
    id: "scenario-1",
    playbookId: playbook.id,
    title: "Weekly digest",
    ownerId: "owner-1",
  };
  const schedule: ScheduleRecordV0 = {
    ...baseRecord,
    kind: "schedule",
    id: "schedule-1",
    playbookId: playbook.id,
    scenarioId: scenario.id,
    ownerId: "owner-1",
    cadence: "0 9 * * 1",
  };

  return {
    document,
    version,
    review,
    approval,
    publish_package: publishPackage,
    playbook,
    scenario,
    schedule,
  } satisfies Record<GovernanceObjectKindV0, unknown>;
}

describe("GovernanceStore", () => {
  it("round-trips each governance kind under .pluto/governance-like backing paths", async () => {
    const store = new GovernanceStore({ dataDir });
    const records = fixtures();

    for (const [kind, record] of Object.entries(records) as Array<
      [GovernanceObjectKindV0, (typeof records)[GovernanceObjectKindV0]]
    >) {
      const persistedPath = await store.put(kind, record);

      expect(persistedPath).toBe(join(governanceDir(dataDir, kind), `${record.id}.json`));
      expect(await store.exists(kind, record.id)).toBe(true);
      expect(await store.get(kind, record.id)).toEqual(record);

      const raw = JSON.parse(await readFile(persistedPath, "utf8"));
      expect(raw).toEqual(record);
    }
  });

  it("lists stored records and returns null or false for missing ids", async () => {
    const store = new GovernanceStore({ dataDir });

    const docA: DocumentRecordV0 = {
      ...baseRecord,
      kind: "document",
      id: "doc-a",
      title: "A",
      ownerId: "owner-1",
      currentVersionId: null,
    };
    const docB: DocumentRecordV0 = {
      ...baseRecord,
      kind: "document",
      id: "doc-b",
      title: "B",
      ownerId: "owner-2",
      currentVersionId: null,
    };

    await store.put("document", docB);
    await store.put("document", docA);

    const listed = await store.list("document");
    expect(listed.map((record) => record.id)).toEqual(["doc-a", "doc-b"]);
    expect(await store.get("document", "missing")).toBeNull();
    expect(await store.exists("document", "missing")).toBe(false);
    expect(await store.list("schedule")).toEqual([]);
  });
});
