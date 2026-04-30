import { describe, expect, it } from "vitest";
import type { CompatibilityReportV0 } from "@/versioning/index.js";

describe("CompatibilityReportV0", () => {
  it("requires explicit fail-closed fields with no silent downgrade shape", () => {
    const report: CompatibilityReportV0 = {
      status: "incompatible",
      warnings: [],
      blockers: ["Missing compatible reader for durable object schema."],
      requiredMigrations: [],
      checkedAgainst: {
        operation: "import",
        subject: {
          family: "durable-artifact",
          version: 2,
          writtenAt: "2026-04-30T00:00:00.000Z",
        },
        against: {
          family: "durable-artifact",
          version: 0,
          writtenAt: "2026-04-29T00:00:00.000Z",
        },
      },
    };

    expect(Object.keys(report).sort()).toEqual([
      "blockers",
      "checkedAgainst",
      "requiredMigrations",
      "status",
      "warnings",
    ]);
    expect(report.status).toBe("incompatible");
    expect(report.blockers).toHaveLength(1);
    expect("downgradedTo" in report).toBe(false);
    expect("silentDowngrade" in report).toBe(false);
  });
});
