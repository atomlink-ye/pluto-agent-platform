import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REVIEW_PUBLISH_RELEASE_FIXTURE_IDS } from "@/governance/seed.js";

import {
  buildReviewPublishReleaseScenarioGraph,
  seedReviewPublishReleaseScenario,
} from "../fixtures/review-publish-release.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-review-publish-release-blocked-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("review publish release blocked states", () => {
  it("treats a later approval revocation as missing approval for publish readiness", async () => {
    const context = await seedReviewPublishReleaseScenario(dataDir, "successful");
    await context.stores.review.putDecision({
      schema: "pluto.review.decision",
      schemaVersion: 0,
      id: "decision-approval-review-publish-release-revoked",
      requestId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.approvalRequestId,
      requestKind: "approval",
      target: context.seeded.approvalRequest.target,
      event: "revoked",
      actorId: "approver-default-governance",
      comment: "Revoked to validate blocked publish readiness.",
      delegatedToId: null,
      recordedAt: "2026-04-30T00:30:00.000Z",
    });

    const graph = await buildReviewPublishReleaseScenarioGraph(context);

    expect(graph.approvedApprovalRefs).toEqual([]);
    expect(graph.publishProjection?.readiness.status).toBe("blocked");
    expect(graph.publishProjection?.readiness.blockedReasons).toContain("missing_approval");
    expect(graph.governanceEvents.some((event) => event.eventType === "approval_revoked")).toBe(true);
  });

  it("fails closed when required evidence is not sealed for governance use", async () => {
    const context = await seedReviewPublishReleaseScenario(dataDir, "unsealed-evidence");
    const graph = await buildReviewPublishReleaseScenarioGraph(context);

    expect(graph.versionProjection.sealedEvidence[0]).toMatchObject({
      id: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId,
      usableForGovernance: false,
    });
    expect(graph.versionProjection.blockedReasons).toContain("missing_sealed_evidence");
    expect(graph.publishProjection?.readiness.status).toBe("blocked");
    expect(graph.publishProjection?.readiness.blockedReasons).toContain("missing_sealed_evidence");
  });

  it("keeps publish readiness blocked when a mandatory release gate fails", async () => {
    const context = await seedReviewPublishReleaseScenario(dataDir, "blocked");
    const graph = await buildReviewPublishReleaseScenarioGraph(context);

    expect(graph.readinessReport?.status).toBe("blocked");
    expect(graph.readinessReport?.blockedReasons).toContain(
      `gate:${REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.testGateId}:failed`,
    );
    expect(graph.publishProjection?.readiness.status).toBe("blocked");
    expect(graph.publishProjection?.readiness.blockedReasons).toContain("failed_readiness_gate");
    expect(graph.blockedReasons).toContain("failed_readiness_gate");
  });
});
