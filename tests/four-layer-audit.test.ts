import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Playbook, RunProfile } from "@/contracts/four-layer.js";
import { runAuditMiddleware } from "@/four-layer/audit-middleware.js";

let artifactRootDir: string;

const basePlaybook: Playbook = {
  schemaVersion: 0,
  kind: "playbook",
  name: "research-review",
  teamLead: "team_lead",
  members: ["planner", "generator", "evaluator"],
  workflow: "As team lead, run planner then generator then evaluator.",
  audit: {
    requiredRoles: ["planner", "generator", "evaluator"],
    maxRevisionCycles: 1,
    finalReportSections: ["workflow_steps_executed", "deviations"],
  },
};

const baseRunProfile: RunProfile = {
  schemaVersion: 0,
  kind: "run_profile",
  name: "local-dev",
  workspace: { cwd: "/tmp/pluto" },
  artifactContract: {
    requiredFiles: [
      "artifact.md",
      { path: "final-report.md", requiredSections: ["implementation_summary"] },
    ],
  },
  stdoutContract: {
    requiredLines: [
      "SUMMARY:",
      { pattern: "STAGE:\\s+planner\\s+->\\s+generator" },
    ],
  },
};

beforeEach(async () => {
  artifactRootDir = await mkdtemp(join(tmpdir(), "pluto-four-layer-audit-"));
  await mkdir(artifactRootDir, { recursive: true });
});

afterEach(async () => {
  await rm(artifactRootDir, { recursive: true, force: true });
});

describe("four-layer audit middleware", () => {
  it("fails closed on a missing required artifact file", async () => {
    await writeValidArtifacts({ skipArtifact: true });

    const result = await runAuditMiddleware(makeInput());

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed_audit");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_required_file", path: join(artifactRootDir, "artifact.md") }),
      ]),
    );
  });

  it("fails closed on a missing required section", async () => {
    await writeFile(join(artifactRootDir, "artifact.md"), "artifact body\n", "utf8");
    await writeFile(join(artifactRootDir, "final-report.md"), "# Final Report\n\n## Deviations\n- none\n", "utf8");

    const result = await runAuditMiddleware(makeInput());

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_required_section", section: "implementation_summary" }),
      ]),
    );
  });

  it("fails closed on a missing required stdout line", async () => {
    await writeValidArtifacts();

    const result = await runAuditMiddleware(makeInput({ stdout: "STAGE: planner -> generator\n" }));

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_stdout_line", requirement: "SUMMARY:" }),
      ]),
    );
  });

  it("fails closed on missing required role stage coverage", async () => {
    await writeValidArtifacts();

    const result = await runAuditMiddleware(makeInput({
      stageTransitions: [
        { from: "planner", to: "generator" },
        { from: "generator", to: "team_lead" },
      ],
    }));

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_required_role", role: "evaluator" }),
      ]),
    );
  });

  it("describes missing synthesized transitions honestly in bridge mode", async () => {
    await writeValidArtifacts();

    const result = await runAuditMiddleware(makeInput({
      stageTransitions: [],
      stageTransitionSource: "synthesized_routing",
    }));

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_stage_transitions",
          message: "stage coverage cannot be verified without synthesized routing transitions",
        }),
      ]),
    );
  });

  it("fails closed when the revision cap is breached", async () => {
    await writeValidArtifacts();

    const result = await runAuditMiddleware(makeInput({ revisionCount: 2 }));

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "revision_cap_breached" }),
      ]),
    );
  });

  it("fails closed when final-report role citations omit a required role", async () => {
    await writeValidArtifacts({ citedRoles: ["planner", "generator"] });

    const result = await runAuditMiddleware(makeInput());

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_required_role", role: "evaluator", section: "required_role_citations" }),
      ]),
    );
  });
});

function makeInput(overrides: Partial<Parameters<typeof runAuditMiddleware>[0]> = {}): Parameters<typeof runAuditMiddleware>[0] {
  return {
    artifactRootDir,
    stdout: "SUMMARY: finished\nSTAGE: planner -> generator\n",
    playbook: basePlaybook,
    runProfile: baseRunProfile,
    stageTransitions: [
      { from: "planner", to: "generator" },
      { from: "generator", to: "evaluator" },
    ],
    revisionCount: 1,
    finalReportPath: "final-report.md",
    ...overrides,
  };
}

async function writeValidArtifacts(options: { skipArtifact?: boolean; citedRoles?: string[] } = {}) {
  if (!options.skipArtifact) {
    await writeFile(join(artifactRootDir, "artifact.md"), "artifact body\n", "utf8");
  }
  await writeFile(
    join(artifactRootDir, "final-report.md"),
    [
      "# Final Report",
      "",
      "## Implementation Summary",
      "Done.",
      "",
      "## Workflow Steps Executed",
      "planner -> generator -> evaluator",
      "",
      "## Required Role Citations",
      ...(options.citedRoles ?? ["planner", "generator", "evaluator"]).map((role) => `- ${role}: cited`),
      "",
      "## Deviations",
      "none",
    ].join("\n"),
    "utf8",
  );
}
