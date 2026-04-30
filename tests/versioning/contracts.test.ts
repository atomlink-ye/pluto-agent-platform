import { describe, expect, it } from "vitest";
import {
  type CompatibilityContextV0,
  type CompatibilityReportV0,
  type ImportConflictV0,
  type MigrationPlanV0,
  type MigrationRecordV0,
  type PackageVersionV0,
  type SchemaVersionRefV0,
} from "@/versioning/index.js";
import {
  type CompatibilityStatusV0 as RootCompatibilityStatusV0,
  type SchemaVersionRefV0 as RootSchemaVersionRefV0,
} from "@/index.js";
import { type CompatibilityReportV0 as OrchestratorCompatibilityReportV0 } from "@/orchestrator/index.js";

describe("versioning contracts", () => {
  it("exports additive contracts from versioning, root, and orchestrator surfaces", () => {
    const packageVersion: PackageVersionV0 = {
      name: "pluto-agent-platform",
      version: "0.1.0-alpha.0",
    };

    const subject: SchemaVersionRefV0 = {
      family: "durable-run",
      version: 0,
      writtenAt: "2026-04-30T00:00:00.000Z",
    };

    const against: RootSchemaVersionRefV0 = {
      family: "durable-run",
      version: 1,
      writtenAt: "2026-05-01T00:00:00.000Z",
    };

    const context: CompatibilityContextV0 = {
      operation: "read",
      subject,
      against,
      packageVersion,
    };

    const importConflict: ImportConflictV0 = {
      code: "schema_family_mismatch",
      message: "Incoming durable object family does not match stored family.",
      incoming: subject,
      existing: against,
    };

    const migration: MigrationPlanV0 = {
      id: "durable-run-v0-to-v1",
      from: subject,
      to: against,
      dryRunOnly: true,
      warnings: ["Dry-run only in R1."],
      blockers: [],
      importConflicts: [importConflict],
    };

    const report: CompatibilityReportV0 = {
      status: "requires_migration",
      warnings: ["Reader must inspect migration output before proceeding."],
      blockers: [],
      requiredMigrations: [migration],
      checkedAgainst: context,
    };

    const record: MigrationRecordV0 = {
      migrationId: migration.id,
      status: "dry_run_succeeded",
      startedAt: "2026-04-30T00:01:00.000Z",
      finishedAt: "2026-04-30T00:01:01.000Z",
      plan: migration,
      warnings: migration.warnings,
      blockers: migration.blockers,
    };

    const rootStatus: RootCompatibilityStatusV0 = report.status;
    const orchestratorReport: OrchestratorCompatibilityReportV0 = report;

    expect(rootStatus).toBe("requires_migration");
    expect(orchestratorReport.checkedAgainst.packageVersion).toEqual(packageVersion);
    expect(record.plan.importConflicts[0]).toEqual(importConflict);
  });
});
