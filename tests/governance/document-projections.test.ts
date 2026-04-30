import { describe, expect, it } from "vitest";

import { toVersionProvenanceRefsV0 } from "@/contracts/governance.js";
import {
  buildDocumentDetailProjection,
  buildDocumentSummary,
} from "@/governance/projections.js";

const baseRecord = {
  schemaVersion: 0 as const,
  workspaceId: "workspace-1",
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:01.000Z",
};

describe("document projections", () => {
  it("builds a document summary with current-version counts and governance status", () => {
    const document = {
      ...baseRecord,
      kind: "document" as const,
      id: "doc-1",
      title: "Governance Seed",
      ownerId: "owner-1",
      currentVersionId: "ver-2",
      status: "draft",
    };
    const currentVersion = {
      ...baseRecord,
      kind: "version" as const,
      id: "ver-2",
      documentId: document.id,
      createdById: "owner-1",
      label: "v2",
      status: "active",
    };
    const review = {
      ...baseRecord,
      kind: "review" as const,
      id: "review-1",
      documentId: document.id,
      versionId: currentVersion.id,
      requestedById: "owner-1",
      reviewerId: "reviewer-1",
      status: "in_review",
    };
    const approval = {
      ...baseRecord,
      kind: "approval" as const,
      id: "approval-1",
      documentId: document.id,
      versionId: currentVersion.id,
      requestedById: "owner-1",
      approverId: "approver-1",
      status: "approved",
    };
    const publishPackage = {
      ...baseRecord,
      kind: "publish_package" as const,
      id: "pkg-1",
      documentId: document.id,
      versionId: currentVersion.id,
      ownerId: "owner-1",
      targetId: "target-1",
      status: "ready",
    };

    expect(buildDocumentSummary({
      document,
      currentVersion,
      reviews: [review],
      approvals: [approval],
      publishPackages: [publishPackage],
    })).toEqual({
      schemaVersion: 0,
      documentId: "doc-1",
      title: "Governance Seed",
      ownerId: "owner-1",
      documentStatus: "draft",
      governanceStatus: "active",
      currentVersion: {
        id: "ver-2",
        label: "v2",
        status: "active",
        governanceStatus: "active",
      },
      counts: {
        reviews: 1,
        approvals: 1,
        publishPackages: 1,
      },
    });
  });

  it("builds detail projections with object-local statuses and ref-only run or evidence links", () => {
    const document = {
      ...baseRecord,
      kind: "document" as const,
      id: "doc-1",
      title: "Governance Seed",
      ownerId: "owner-1",
      currentVersionId: "ver-2",
      status: "draft",
    };
    const oldVersion = {
      ...baseRecord,
      kind: "version" as const,
      id: "ver-1",
      documentId: document.id,
      createdById: "owner-1",
      label: "v1",
      status: "archived",
    };
    const currentVersion = {
      ...baseRecord,
      kind: "version" as const,
      id: "ver-2",
      documentId: document.id,
      createdById: "owner-1",
      label: "v2",
      status: "active",
    };
    const review = {
      ...baseRecord,
      kind: "review" as const,
      id: "review-1",
      documentId: document.id,
      versionId: currentVersion.id,
      requestedById: "owner-1",
      reviewerId: "reviewer-1",
      status: "changes_requested",
    };
    const approval = {
      ...baseRecord,
      kind: "approval" as const,
      id: "approval-1",
      documentId: document.id,
      versionId: currentVersion.id,
      requestedById: "owner-1",
      approverId: "approver-1",
      status: "approved",
    };
    const publishPackage = {
      ...baseRecord,
      kind: "publish_package" as const,
      id: "pkg-1",
      documentId: document.id,
      versionId: currentVersion.id,
      ownerId: "owner-1",
      targetId: "target-1",
      status: "ready",
    };
    const provenance = toVersionProvenanceRefsV0({
      latestRun: {
        runId: "run-2",
        status: "done",
        blockerReason: null,
        finishedAt: "2026-04-30T00:10:00.000Z",
        providerSessionId: "hidden",
      } as {
        runId: string;
        status: string;
        blockerReason: null;
        finishedAt: string;
      } & Record<string, unknown>,
      latestEvidence: {
        runId: "run-2",
        evidencePath: ".pluto/runs/run-2/evidence.json",
        validation: { outcome: "pass" },
        workspace: "/tmp/workspace",
      } as {
        runId: string;
        evidencePath: string;
        validation: { outcome: string };
      } & Record<string, unknown>,
      supportingRuns: [
        {
          runId: "run-1",
          status: "blocked",
          blockerReason: "runtime_timeout",
          finishedAt: "2026-04-30T00:05:00.000Z",
          callback: { url: "https://internal.invalid" },
        } as {
          runId: string;
          status: string;
          blockerReason: string;
          finishedAt: string;
        } & Record<string, unknown>,
      ],
    });

    const detail = buildDocumentDetailProjection({
      document,
      versions: [oldVersion, currentVersion],
      reviews: [review],
      approvals: [approval],
      publishPackages: [publishPackage],
      provenanceByVersionId: { [currentVersion.id]: provenance },
    });

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      schemaVersion: 0,
      pageState: "blocked",
      governanceStatus: "blocked",
      document: {
        id: "doc-1",
        status: "draft",
        governanceStatus: "draft",
      },
      currentVersion: {
        id: "ver-2",
        status: "active",
        governanceStatus: "active",
        latestRun: {
          runId: "run-2",
          status: "succeeded",
          blockerReason: null,
          finishedAt: "2026-04-30T00:10:00.000Z",
        },
        latestEvidence: {
          runId: "run-2",
          evidencePath: ".pluto/runs/run-2/evidence.json",
          validationOutcome: "pass",
        },
      },
      reviews: [
        {
          id: "review-1",
          status: "changes_requested",
          governanceStatus: "blocked",
        },
      ],
      approvals: [
        {
          id: "approval-1",
          status: "approved",
          governanceStatus: "ready",
        },
      ],
      publishPackages: [
        {
          id: "pkg-1",
          status: "ready",
          governanceStatus: "ready",
        },
      ],
      evidence: [
        {
          runId: "run-2",
          evidencePath: ".pluto/runs/run-2/evidence.json",
          validationOutcome: "pass",
        },
      ],
      recentRuns: [
        {
          runId: "run-2",
          status: "succeeded",
          blockerReason: null,
          finishedAt: "2026-04-30T00:10:00.000Z",
        },
        {
          runId: "run-1",
          status: "blocked",
          blockerReason: "runtime_timeout",
          finishedAt: "2026-04-30T00:05:00.000Z",
        },
      ],
    });

    expect(detail?.currentVersion && Object.keys(detail.currentVersion.latestRun ?? {})).toEqual([
      "runId",
      "status",
      "blockerReason",
      "finishedAt",
    ]);
    expect(detail?.currentVersion && Object.keys(detail.currentVersion.latestEvidence ?? {})).toEqual([
      "runId",
      "evidencePath",
      "validationOutcome",
    ]);
    expect(detail?.currentVersion).not.toHaveProperty("providerSessionId");
  });
});
