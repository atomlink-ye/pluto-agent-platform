import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import {
  buildReadinessEvaluatedAuditEvent,
  buildReviewRequestedAuditEvent,
  validateGovernanceEventRecordV0,
} from "@/audit/governance-events.js";
import type { ReleaseCandidateRecordV0, ReleaseReadinessReportV0 } from "@/contracts/release.js";

describe("governance events", () => {
  let dataDir = "";

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("appends immutable events and supports query filters with stable target and evidence refs", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-governance-audit-"));
    const store = new GovernanceEventStore({ dataDir });

    const reviewRequested = buildReviewRequestedAuditEvent({
      id: "review-1",
      workspaceId: "workspace-1",
      target: {
        kind: "version",
        documentId: "doc-1",
        versionId: "ver-1",
      },
      requestedById: "requester-1",
      status: "requested",
      evidenceRequirements: [{ ref: "sealed:evidence-1" }],
      createdAt: "2026-04-30T00:01:00.000Z",
    });

    const candidate: ReleaseCandidateRecordV0 = {
      schema: "pluto.release.candidate",
      schemaVersion: 0,
      id: "candidate-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
      targetScope: {
        targetKind: "channel",
        targetId: "docs-site",
        summary: "Docs site rollout",
      },
      candidateEvidenceRefs: ["sealed:candidate-1"],
      createdById: "publisher-1",
      status: "candidate",
      createdAt: "2026-04-30T00:02:00.000Z",
      updatedAt: "2026-04-30T00:02:00.000Z",
    };

    const report: ReleaseReadinessReportV0 = {
      schema: "pluto.release.readiness-report",
      schemaVersion: 0,
      id: "report-1",
      candidateId: "candidate-1",
      workspaceId: "workspace-1",
      documentId: "doc-1",
      versionId: "ver-1",
      packageId: "pkg-1",
      status: "blocked",
      blockedReasons: ["gate:qa:failed"],
      generatedAt: "2026-04-30T00:03:00.000Z",
      gateResults: [],
      waiverIds: [],
      testEvidenceRefs: ["sealed:test-1"],
      evalEvidenceRefs: ["sealed:eval-1"],
      manualCheckEvidenceRefs: [],
      artifactCheckEvidenceRefs: ["sealed:artifact-1"],
      evalRubricRefs: [],
      evalRubricSummaries: [],
    };

    const readinessEvent = buildReadinessEvaluatedAuditEvent(report, candidate, null);

    expect(validateGovernanceEventRecordV0(reviewRequested)).toMatchObject({ ok: true });
    expect(validateGovernanceEventRecordV0(readinessEvent)).toMatchObject({ ok: true });

    await store.append(reviewRequested);
    await store.append(readinessEvent);

    const all = await store.list();
    expect(all.map((event) => event.eventType)).toEqual(["review_requested", "readiness_evaluated"]);
    expect(all[0]?.target).toMatchObject({
      kind: "version",
      recordId: "ver-1",
      documentId: "doc-1",
      versionId: "ver-1",
      requestId: "review-1",
    });
    expect(all[0]?.evidenceRefs).toEqual(["sealed:evidence-1"]);
    expect(all[1]?.evidenceRefs).toEqual([
      "sealed:candidate-1",
      "sealed:test-1",
      "sealed:eval-1",
      "sealed:artifact-1",
    ]);
    expect(await store.list({ eventType: "readiness_evaluated" })).toHaveLength(1);
    expect(await store.list({ targetKind: "version", targetRecordId: "ver-1" })).toHaveLength(1);
    expect(await store.list({ actorId: "publisher-1" })).toHaveLength(1);
  });
});
