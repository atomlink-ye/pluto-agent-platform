import { describe, expect, it } from "vitest";
import type { RuntimeCapabilityDescriptorV0 } from "@/contracts/index.js";
import {
  assertNoSilentDowngrade,
  evaluateCompatibility,
  type CompatibilityContextV0,
  type CompatibilityReportV0,
} from "@/versioning/index.js";

function createContext(
  overrides: Partial<CompatibilityContextV0> = {},
): CompatibilityContextV0 {
  return {
    operation: "import",
    subject: {
      family: "durable-run",
      version: 0,
      writtenAt: "2026-04-30T00:00:00.000Z",
    },
    against: {
      family: "durable-run",
      version: 0,
      writtenAt: "2026-04-30T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("evaluateCompatibility", () => {
  it("returns a migration report for import contexts that need a newer schema", () => {
    const report = evaluateCompatibility(
      createContext({
        operation: "import",
        subject: {
          family: "durable-run",
          version: 0,
          writtenAt: "2026-04-30T00:00:00.000Z",
        },
        against: {
          family: "durable-run",
          version: 2,
          writtenAt: "2026-05-01T00:00:00.000Z",
        },
      }),
    );

    expect(report.status).toBe("requires_migration");
    expect(report.blockers).toEqual([]);
    expect(report.requiredMigrations).toHaveLength(1);
    expect(report.requiredMigrations[0]?.dryRunOnly).toBe(true);
    expect(report.requiredMigrations[0]?.warnings[0]).toContain("Dry-run migration required");
  });

  it("fails closed for run contexts when required capability coverage is unavailable", () => {
    const capability: RuntimeCapabilityDescriptorV0 = {
      schemaVersion: 0,
      runtimeId: "local-runner",
      adapterId: "fake",
      provider: "opencode",
      locality: "local",
      posture: "sandboxed",
      tools: {
        shell: false,
      },
    };

    const report = evaluateCompatibility(
      createContext({
        operation: "run",
        capabilities: {
          required: {
            tools: {
              shell: true,
            },
          },
          available: [capability],
        },
      }),
    );

    expect(report.status).toBe("incompatible");
    expect(report.blockers).toContain(
      "capability_unavailable: Required runtime capabilities are unavailable in the target environment.",
    );
    expect(report.blockers).toContain(
      "Silent downgrade blocked: required runtime capabilities are not available.",
    );
  });

  it("fails closed for export contexts when evidence and approval would be weakened", () => {
    const report = evaluateCompatibility(
      createContext({
        operation: "export",
        evidence: {
          required: true,
          present: false,
        },
        approval: {
          required: true,
          granted: false,
        },
      }),
    );

    expect(report.status).toBe("incompatible");
    expect(report.blockers).toContain(
      "Silent downgrade blocked: required evidence would be missing.",
    );
    expect(report.blockers).toContain(
      "Silent downgrade blocked: required approval would be missing.",
    );
  });
});

describe("assertNoSilentDowngrade", () => {
  it("throws when a downgrade guard is required but not surfaced as a blocker", () => {
    const context = createContext({
      operation: "run",
      policy: {
        allowed: false,
        reason: "org policy denies remote export without review",
      },
    });

    const report: CompatibilityReportV0 = {
      status: "incompatible",
      warnings: [],
      blockers: [
        "policy_denied: Policy denies this compatibility operation. org policy denies remote export without review",
      ],
      requiredMigrations: [],
      checkedAgainst: context,
    };

    expect(() => assertNoSilentDowngrade(report, context)).toThrow(
      /silent_downgrade_not_blocked/,
    );
  });
});
