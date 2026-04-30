import { GovernanceEventStore } from "@/audit/governance-event-store.js";
import { EvidenceGraphStore } from "@/evidence/evidence-graph.js";
import {
  REVIEW_PUBLISH_RELEASE_FIXTURE_IDS,
  seedReviewPublishReleaseFixtures,
  type ReviewPublishReleaseFixtureScenarioV0,
  type ReviewPublishReleaseSeedStores,
  type SeededReviewPublishReleaseFixturesV0,
} from "@/governance/seed.js";
import {
  buildReviewPublishReleaseGraph,
  type BuildReviewPublishReleaseGraphInput,
  type ReviewPublishReleaseGraphV0,
} from "@/governance/release-projections.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import { PublishStore } from "@/publish/publish-store.js";
import { ReleaseStore } from "@/release/release-store.js";
import { ReviewStore } from "@/review/review-store.js";

export interface ReviewPublishReleaseFixtureContext {
  dataDir: string;
  stores: ReviewPublishReleaseSeedStores;
  seeded: SeededReviewPublishReleaseFixturesV0;
}

export function createReviewPublishReleaseStores(dataDir: string): ReviewPublishReleaseSeedStores {
  return {
    governance: new GovernanceStore({ dataDir }),
    review: new ReviewStore({ dataDir }),
    evidenceGraph: new EvidenceGraphStore({ dataDir }),
    publish: new PublishStore({ dataDir }),
    release: new ReleaseStore({ dataDir }),
    audit: new GovernanceEventStore({ dataDir }),
  };
}

export async function seedReviewPublishReleaseScenario(
  dataDir: string,
  scenario: ReviewPublishReleaseFixtureScenarioV0 = "successful",
): Promise<ReviewPublishReleaseFixtureContext> {
  const stores = createReviewPublishReleaseStores(dataDir);
  const seeded = await seedReviewPublishReleaseFixtures(stores, { scenario });
  return { dataDir, stores, seeded };
}

export async function buildReviewPublishReleaseScenarioGraph(
  context: ReviewPublishReleaseFixtureContext,
  overrides: Partial<Omit<BuildReviewPublishReleaseGraphInput, "governanceStore" | "reviewStore" | "evidenceGraphStore" | "publishStore" | "releaseStore" | "auditStore" | "versionId">> = {},
): Promise<ReviewPublishReleaseGraphV0> {
  return buildReviewPublishReleaseGraph({
    governanceStore: context.stores.governance,
    reviewStore: context.stores.review,
    evidenceGraphStore: context.stores.evidenceGraph,
    publishStore: context.stores.publish,
    releaseStore: context.stores.release,
    auditStore: context.stores.audit,
    versionId: REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.versionId,
    ...overrides,
  });
}
