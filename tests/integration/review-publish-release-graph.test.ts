import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  REVIEW_PUBLISH_RELEASE_FIXTURE_IDS,
  REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS,
} from "@/governance/seed.js";

import {
  buildReviewPublishReleaseScenarioGraph,
  seedReviewPublishReleaseScenario,
} from "../fixtures/review-publish-release.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-review-publish-release-graph-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("review publish release graph", () => {
  it("builds the complete deterministic graph with ready publish readiness and audit refs", async () => {
    const context = await seedReviewPublishReleaseScenario(dataDir, "successful");
    const graph = await buildReviewPublishReleaseScenarioGraph(context, {
      now: REVIEW_PUBLISH_RELEASE_FIXTURE_TIMESTAMPS.readinessGeneratedAt,
    });

    expect(graph.document.id).toBe(REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.documentId);
    expect(graph.version.id).toBe(REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.versionId);
    expect(graph.reviewRequest?.id).toBe(REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.reviewRequestId);
    expect(graph.approvalRequest?.id).toBe(REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.approvalRequestId);
    expect(graph.versionProjection.blockedReasons).toEqual([]);
    expect(graph.approvedApprovalRefs).toEqual([REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.approvalRequestId]);
    expect(graph.publishProjection?.readiness.status).toBe("ready");
    expect(graph.publishProjection?.blockedReasons).toEqual([]);
    expect(graph.publishProjection?.publishPackage.releaseReadinessRefs[0]?.status).toBe("ready");
    expect(graph.readinessReport?.status).toBe("ready");
    expect(graph.qaGates.map((gate) => gate.id)).toEqual([
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.artifactGateId,
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.evalGateId,
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.testGateId,
    ]);
    expect(graph.sealedEvidence.map((record) => record.id)).toEqual([
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainSealedEvidenceId,
    ]);
    expect(graph.citations.map((record) => record.id)).toEqual([
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.mainCitationId,
    ]);
    expect(graph.provenanceEdges.map((record) => record.id)).toEqual([
      REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishEdgeId,
    ]);
    expect(graph.governanceEvents.map((event) => event.eventType)).toEqual([
      "review_requested",
      "decision_recorded",
      "decision_recorded",
      "approval_granted",
      "package_assembled",
      "export_sealed",
      "readiness_evaluated",
      "publish_attempted",
    ]);
  });

  it("keeps a waived mandatory gate visible while allowing ready release readiness", async () => {
    const context = await seedReviewPublishReleaseScenario(dataDir, "waived");
    const graph = await buildReviewPublishReleaseScenarioGraph(context);

    expect(graph.readinessReport?.status).toBe("ready");
    expect(graph.readinessReport?.waiverIds).toEqual([REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.waiverId]);
    expect(graph.waivers.map((waiver) => waiver.id)).toEqual([REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.waiverId]);
    expect(graph.readinessReport?.gateResults.find((gate) => gate.gateId === REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.testGateId)?.effectiveOutcome)
      .toBe("waived");
    expect(graph.governanceEvents.some((event) => event.eventType === "waiver_approved")).toBe(true);
    expect(graph.publishProjection?.readiness.status).toBe("ready");
  });

  it("surfaces degraded dependency blocking through the review and approval queues", async () => {
    const context = await seedReviewPublishReleaseScenario(dataDir, "degraded-dependency");
    const graph = await buildReviewPublishReleaseScenarioGraph(context);

    expect(graph.reviewQueue[0]?.blockedReasons).toContain("degraded_dependency");
    expect(graph.approvalQueue[0]?.blockedReasons).toContain("degraded_dependency");
    expect(graph.blockedReasons).toContain("degraded_dependency");
    expect(graph.publishProjection?.readiness.status).toBe("ready");
  });
});
