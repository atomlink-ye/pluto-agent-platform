import { describe, expect, it } from "vitest";

import {
  validateApprovalRecordV0,
  validateDocumentRecordV0,
  validatePlaybookRecordV0,
  validatePublishPackageRecordV0,
  validateReviewRecordV0,
  validateScheduleRecordV0,
  validateScenarioRecordV0,
  validateVersionRecordV0,
} from "@/contracts/governance.js";

const baseRecord = {
  schemaVersion: 0 as const,
  workspaceId: "workspace-1",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
  status: "draft",
};

describe("governance contracts", () => {
  it("requires stable ids and schema markers across all v0 records", () => {
    expect(validateDocumentRecordV0({
      ...baseRecord,
      kind: "document",
      id: "doc-1",
      title: "Docs IA",
      ownerId: "owner-1",
      currentVersionId: "ver-1",
    }).ok).toBe(true);

    expect(validateVersionRecordV0({
      ...baseRecord,
      kind: "version",
      id: "ver-1",
      documentId: "doc-1",
      createdById: "creator-1",
      label: "v1",
    }).ok).toBe(true);

    expect(validateReviewRecordV0({
      ...baseRecord,
      kind: "review",
      id: "review-1",
      documentId: "doc-1",
      versionId: "ver-1",
      requestedById: "requester-1",
      reviewerId: "reviewer-1",
    }).ok).toBe(true);

    expect(validateApprovalRecordV0({
      ...baseRecord,
      kind: "approval",
      id: "approval-1",
      documentId: "doc-1",
      versionId: "ver-1",
      requestedById: "requester-1",
      approverId: "approver-1",
    }).ok).toBe(true);

    expect(validatePublishPackageRecordV0({
      ...baseRecord,
      kind: "publish_package",
      id: "package-1",
      documentId: "doc-1",
      versionId: "ver-1",
      ownerId: "owner-1",
      targetId: "target-1",
    }).ok).toBe(true);

    expect(validatePlaybookRecordV0({
      ...baseRecord,
      kind: "playbook",
      id: "playbook-1",
      title: "Editorial rollout",
      ownerId: "owner-1",
    }).ok).toBe(true);

    expect(validateScenarioRecordV0({
      ...baseRecord,
      kind: "scenario",
      id: "scenario-1",
      playbookId: "playbook-1",
      title: "Weekly digest",
      ownerId: "owner-1",
    }).ok).toBe(true);

    expect(validateScheduleRecordV0({
      ...baseRecord,
      kind: "schedule",
      id: "schedule-1",
      playbookId: "playbook-1",
      scenarioId: "scenario-1",
      ownerId: "owner-1",
      cadence: "0 9 * * 1",
    }).ok).toBe(true);

    const missingId = validateDocumentRecordV0({
      ...baseRecord,
      kind: "document",
      title: "Docs IA",
      ownerId: "owner-1",
      currentVersionId: null,
    });

    expect(missingId.ok).toBe(false);
    expect(missingId.ok ? [] : missingId.errors).toContain("missing required field: id");

    const wrongSchemaVersion = validateVersionRecordV0({
      ...baseRecord,
      schemaVersion: 1,
      kind: "version",
      id: "ver-1",
      documentId: "doc-1",
      createdById: "creator-1",
      label: "v1",
    });

    expect(wrongSchemaVersion.ok).toBe(false);
    expect(wrongSchemaVersion.ok ? [] : wrongSchemaVersion.errors).toContain("schemaVersion must be 0");
  });

  it("tolerates additive future fields", () => {
    const result = validateDocumentRecordV0({
      ...baseRecord,
      kind: "document",
      id: "doc-1",
      title: "Docs IA",
      ownerId: "owner-1",
      currentVersionId: "ver-1",
      futureField: { note: true },
    });

    expect(result.ok).toBe(true);
  });
});
