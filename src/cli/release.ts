#!/usr/bin/env node
import process from "node:process";

import { ReleaseStore } from "../release/release-store.js";

function usage(): never {
  console.error(`Usage:\n  pnpm release readiness <candidateId> [--json]`);
  process.exit(1);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const subcommand = argv[0] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positional.push(arg);
  }

  return { subcommand, positional, flags };
}

function formatReasons(reasons: readonly string[]): string {
  return reasons.length === 0 ? "none" : reasons.join(", ");
}

export async function handleReleaseReadiness(
  releaseStore: ReleaseStore,
  candidateId: string | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!candidateId) {
    fail("Missing <candidateId> argument for 'readiness'");
  }

  const [candidate, reports, waivers] = await Promise.all([
    releaseStore.getReleaseCandidate(candidateId),
    releaseStore.listReadinessReports(),
    releaseStore.listWaivers(),
  ]);
  if (!candidate) {
    fail(`release candidate not found: ${candidateId}`);
  }

  const report = reports
    .filter((entry) => entry.candidateId === candidateId)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt) || right.id.localeCompare(left.id))[0] ?? null;
  if (!report) {
    fail(`release readiness report not found for candidate: ${candidateId}`);
  }

  const linkedWaivers = waivers.filter((waiver) => waiver.candidateId === candidateId);
  const output = {
    schemaVersion: 0,
    candidate,
    report,
    waivers: linkedWaivers,
    testsVsEvals: {
      tests: report.testEvidenceRefs,
      evals: report.evalEvidenceRefs,
      manualChecks: report.manualCheckEvidenceRefs,
      artifactChecks: report.artifactCheckEvidenceRefs,
    },
  };

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Candidate: ${candidate.id}`);
  console.log(`Status: ${report.status}`);
  console.log(`Blocked reasons: ${formatReasons(report.blockedReasons)}`);
  console.log(`Waivers: ${linkedWaivers.map((waiver) => `${waiver.id}:${waiver.status}`).join(", ") || "none"}`);
  console.log(`Tests: ${report.testEvidenceRefs.join(", ") || "none"}`);
  console.log(`Evals: ${report.evalEvidenceRefs.join(", ") || "none"}`);
  console.log(`Manual checks: ${report.manualCheckEvidenceRefs.join(", ") || "none"}`);
  console.log(`Artifact checks: ${report.artifactCheckEvidenceRefs.join(", ") || "none"}`);
}

async function main(): Promise<void> {
  const releaseStore = new ReleaseStore({ dataDir: process.env["PLUTO_DATA_DIR"] ?? ".pluto" });
  const { subcommand, positional, flags } = parseArgs(process.argv.slice(2));
  const jsonMode = flags["json"] === true;

  if (!subcommand) usage();

  switch (subcommand) {
    case "readiness":
      return handleReleaseReadiness(releaseStore, positional[0], jsonMode);
    default:
      fail(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
