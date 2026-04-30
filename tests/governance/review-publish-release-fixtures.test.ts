import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REVIEW_PUBLISH_RELEASE_FIXTURE_IDS } from "@/governance/seed.js";

import { seedReviewPublishReleaseScenario } from "../fixtures/review-publish-release.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-review-publish-release-fixtures-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("seedReviewPublishReleaseFixtures", () => {
  it("produces deterministic seeded records for the same successful scenario", async () => {
    const left = await seedReviewPublishReleaseScenario(join(workDir, "left"), "successful");
    const right = await seedReviewPublishReleaseScenario(join(workDir, "right"), "successful");

    expect(left.seeded).toEqual(right.seeded);
    expect(left.seeded.publishPackage.id).toBe(REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.publishPackageId);
    expect(left.seeded.readinessReport.id).toBe(REVIEW_PUBLISH_RELEASE_FIXTURE_IDS.readinessReportId);
    expect(left.seeded.governanceEvents.map((event) => event.eventType)).toEqual([
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

  it("does not trigger runtime execution paths or connector writebacks while seeding fixtures", async () => {
    const context = await seedReviewPublishReleaseScenario(join(workDir, "isolated"), "successful");

    await expect(access(join(context.dataDir, "runs"), constants.F_OK)).rejects.toThrow();
    expect(context.seeded.sealedEvidence.every((record) => record.evidencePath.startsWith(".pluto/runs/"))).toBe(true);
    expect(context.seeded.publishAttempts).toEqual([
      expect.objectContaining({
        providerResultRefs: {
          externalRef: null,
          receiptPath: null,
          summary: "Local dry-run summary only",
        },
      }),
    ]);
    expect(context.seeded.governanceEvents.every((event) => event.source.command !== "submit")).toBe(true);
  });
});
