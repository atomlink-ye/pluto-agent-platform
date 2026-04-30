import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  toVersionProvenanceRefsV0,
  type ApprovalRecordV0,
  type DocumentRecordV0,
  type PublishPackageRecordV0,
  type ReviewRecordV0,
  type VersionRecordV0,
} from "@/contracts/governance.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import { buildDocumentDetailProjection } from "@/governance/projections.js";
import { seedDefaultGovernanceFixtures } from "@/governance/seed.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-document-detail-fixtures-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("document detail governance fixtures", () => {
  it("links seeded playbook, scenario, and schedule refs without invoking execution paths", async () => {
    const store = new GovernanceStore({ dataDir });
    const seeded = await seedDefaultGovernanceFixtures(store);
    const schedule = seeded.schedules[0];

    const document: DocumentRecordV0 = {
      schemaVersion: 0,
      kind: "document",
      id: `document-${seeded.playbook.id}`,
      workspaceId: seeded.playbook.workspaceId,
      title: "Governance detail fixture",
      ownerId: seeded.playbook.ownerId,
      currentVersionId: `version-${seeded.scenario.id}`,
      createdAt: seeded.playbook.createdAt,
      updatedAt: seeded.playbook.updatedAt,
      status: "active",
    };
    const version: VersionRecordV0 = {
      schemaVersion: 0,
      kind: "version",
      id: `version-${seeded.scenario.id}`,
      workspaceId: seeded.playbook.workspaceId,
      documentId: document.id,
      createdById: seeded.playbook.ownerId,
      label: "v1",
      createdAt: seeded.playbook.createdAt,
      updatedAt: seeded.playbook.updatedAt,
      status: "ready",
    };
    const review: ReviewRecordV0 = {
      schemaVersion: 0,
      kind: "review",
      id: `review-${seeded.playbook.id}`,
      workspaceId: seeded.playbook.workspaceId,
      documentId: document.id,
      versionId: version.id,
      requestedById: seeded.playbook.ownerId,
      reviewerId: seeded.scenario.ownerId,
      createdAt: seeded.playbook.createdAt,
      updatedAt: seeded.playbook.updatedAt,
      status: "ready",
    };
    const approval: ApprovalRecordV0 = {
      schemaVersion: 0,
      kind: "approval",
      id: `approval-${seeded.scenario.id}`,
      workspaceId: seeded.playbook.workspaceId,
      documentId: document.id,
      versionId: version.id,
      requestedById: seeded.playbook.ownerId,
      approverId: schedule.ownerId,
      createdAt: seeded.playbook.createdAt,
      updatedAt: seeded.playbook.updatedAt,
      status: "approved",
    };
    const publishPackage: PublishPackageRecordV0 = {
      schemaVersion: 0,
      kind: "publish_package",
      id: `package-${schedule.id}`,
      workspaceId: seeded.playbook.workspaceId,
      documentId: document.id,
      versionId: version.id,
      ownerId: seeded.playbook.ownerId,
      targetId: schedule.id,
      createdAt: seeded.playbook.createdAt,
      updatedAt: seeded.playbook.updatedAt,
      status: "ready",
    };
    const provenance = toVersionProvenanceRefsV0({
      latestRun: {
        runId: `run-ref:${seeded.playbook.id}:${seeded.scenario.id}`,
        status: "done",
        blockerReason: null,
        finishedAt: seeded.playbook.updatedAt,
      },
      latestEvidence: {
        runId: `run-ref:${seeded.playbook.id}:${seeded.scenario.id}`,
        evidencePath: `.pluto/runs/${schedule.id}/evidence.json`,
        validation: { outcome: "pass" },
      },
      supportingRuns: [
        {
          runId: `supporting:${schedule.id}`,
          status: "blocked",
          blockerReason: "not_executed",
          finishedAt: seeded.playbook.createdAt,
        },
      ],
    });

    const detail = buildDocumentDetailProjection({
      document,
      versions: [version],
      reviews: [review],
      approvals: [approval],
      publishPackages: [publishPackage],
      provenanceByVersionId: { [version.id]: provenance },
    });

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      schemaVersion: 0,
      pageState: "ready",
      governanceStatus: "active",
      document: {
        id: document.id,
        workspaceId: seeded.playbook.workspaceId,
        ownerId: seeded.playbook.ownerId,
        governanceStatus: "active",
      },
      currentVersion: {
        id: version.id,
        governanceStatus: "ready",
        latestRun: {
          runId: `run-ref:${seeded.playbook.id}:${seeded.scenario.id}`,
          status: "succeeded",
          blockerReason: null,
          finishedAt: seeded.playbook.updatedAt,
        },
        latestEvidence: {
          runId: `run-ref:${seeded.playbook.id}:${seeded.scenario.id}`,
          evidencePath: `.pluto/runs/${schedule.id}/evidence.json`,
          validationOutcome: "pass",
        },
        supportingRuns: [
          {
            runId: `supporting:${schedule.id}`,
            status: "blocked",
            blockerReason: "not_executed",
            finishedAt: seeded.playbook.createdAt,
          },
        ],
      },
      reviews: [{ id: review.id, governanceStatus: "ready" }],
      approvals: [{ id: approval.id, governanceStatus: "ready" }],
      publishPackages: [{ id: publishPackage.id, targetId: schedule.id, governanceStatus: "ready" }],
      evidence: [
        {
          runId: `run-ref:${seeded.playbook.id}:${seeded.scenario.id}`,
          evidencePath: `.pluto/runs/${schedule.id}/evidence.json`,
          validationOutcome: "pass",
        },
      ],
      recentRuns: [
        {
          runId: `run-ref:${seeded.playbook.id}:${seeded.scenario.id}`,
          status: "succeeded",
          blockerReason: null,
          finishedAt: seeded.playbook.updatedAt,
        },
        {
          runId: `supporting:${schedule.id}`,
          status: "blocked",
          blockerReason: "not_executed",
          finishedAt: seeded.playbook.createdAt,
        },
      ],
    });
    expect(detail?.currentVersion).not.toHaveProperty("providerSessionId");
    expect(detail?.currentVersion?.latestRun?.runId).toContain(seeded.playbook.id);
    expect(detail?.currentVersion?.latestRun?.runId).toContain(seeded.scenario.id);
    expect(detail?.publishPackages[0]?.targetId).toBe(schedule.id);
  });
});
