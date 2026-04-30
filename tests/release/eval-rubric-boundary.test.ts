import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { releaseDir, ReleaseStore } from "@/release/release-store.js";

describe("eval rubric metadata boundary", () => {
  let dataDir: string;

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("persists metadata-only eval rubric refs and summaries without evaluator transcripts or engineering test payloads", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "pluto-release-boundary-"));
    const store = new ReleaseStore({ dataDir });

    await store.putEvalRubricRef({
      schema: "pluto.release.eval-rubric-ref",
      schemaVersion: 0,
      id: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-eval",
      rubricId: "release-quality",
      rubricVersion: "2026-04-30",
      expectedPassCondition: "score >= 0.9",
      summaryRef: "citation:eval-summary",
      transcript: "raw evaluator transcript",
      providerPayload: { score: 0.91 },
    } as Parameters<typeof store.putEvalRubricRef>[0]);

    await store.putEvalRubricSummary({
      schema: "pluto.release.eval-rubric-summary",
      schemaVersion: 0,
      id: "rubric-summary-1",
      rubricRefId: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-eval",
      outcome: "pass",
      summaryRef: "citation:eval-summary",
      evidenceRefs: ["sealed:eval-summary"],
      evaluatedAt: "2026-04-30T00:04:00.000Z",
      rawChat: ["assistant", "judge"],
      engineeringTestPayload: { junitXml: "<testsuite />" },
    } as Parameters<typeof store.putEvalRubricSummary>[0]);

    const refRaw = await readFile(join(releaseDir(dataDir, "eval_rubric_ref"), "rubric-ref-1.json"), "utf8");
    const summaryRaw = await readFile(join(releaseDir(dataDir, "eval_rubric_summary"), "rubric-summary-1.json"), "utf8");
    const combined = `${refRaw}\n${summaryRaw}`;

    expect(combined).not.toContain("raw evaluator transcript");
    expect(combined).not.toContain("providerPayload");
    expect(combined).not.toContain("engineeringTestPayload");
    expect(combined).not.toContain("<testsuite />");
    expect(combined).not.toContain("rawChat");

    expect(JSON.parse(refRaw)).toEqual({
      schema: "pluto.release.eval-rubric-ref",
      schemaVersion: 0,
      id: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-eval",
      rubricId: "release-quality",
      rubricVersion: "2026-04-30",
      expectedPassCondition: "score >= 0.9",
      summaryRef: "citation:eval-summary",
    });

    expect(JSON.parse(summaryRaw)).toEqual({
      schema: "pluto.release.eval-rubric-summary",
      schemaVersion: 0,
      id: "rubric-summary-1",
      rubricRefId: "rubric-ref-1",
      candidateId: "candidate-1",
      gateId: "gate-eval",
      outcome: "pass",
      summaryRef: "citation:eval-summary",
      evidenceRefs: ["sealed:eval-summary"],
      evaluatedAt: "2026-04-30T00:04:00.000Z",
    });
  });
});
