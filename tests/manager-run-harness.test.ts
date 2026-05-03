import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { PaseoTeamAdapter } from "@/contracts/adapter.js";
import type { CoordinationTranscriptRefV0, TeamPlaybookV0 } from "@/contracts/types.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

import { createHarnessRun } from "./helpers/harness-run-fixtures.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("manager run harness", () => {
  it("runs the checked-in four-layer scenario end-to-end with the fake adapter", async () => {
    const run = await createHarnessRun({
      name: "four-layer-run",
      tempDirs,
      workspacePrefix: "pluto-four-layer-run-",
    });
    const result = await run.resultPromise;

    expect(result.run.status).toBe("succeeded");
    await expect(access(join(result.runDir, "mailbox.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(result.runDir, "tasks.json"))).resolves.toBeUndefined();
    const mailboxLog = await readFile(join(result.runDir, "mailbox.jsonl"), "utf8");
    const tasks = await readFile(join(result.runDir, "tasks.json"), "utf8");
    const artifact = await readFile(join(run.workspace, "artifact.md"), "utf8");
    expect(mailboxLog).toContain('"summary":"FINAL"');
    expect(mailboxLog).toContain('"summary":"RUN_START"');
    expect(mailboxLog).not.toContain("/mailbox.jsonl");
    expect(mailboxLog).not.toContain("/tasks.json");
    expect(tasks).toContain('"status": "completed"');
    expect(artifact.toLowerCase()).toContain("lead");
    expect(artifact.toLowerCase()).toContain("planner");
    expect(artifact.toLowerCase()).toContain("generator");
    expect(artifact.toLowerCase()).toContain("evaluator");
  });

  it("passes mailbox metadata into adapter startRun and createLeadSession", async () => {
    let capturedStartRun: { playbook?: TeamPlaybookV0; transcript?: CoordinationTranscriptRefV0 } | undefined;
    let capturedCreateLeadSession: { playbook?: TeamPlaybookV0; transcript?: CoordinationTranscriptRefV0 } | undefined;

    class CapturingFakeAdapter extends FakeAdapter {
      override async startRun(input: Parameters<PaseoTeamAdapter["startRun"]>[0]): Promise<void> {
        capturedStartRun = { playbook: input.playbook, transcript: input.transcript };
        await super.startRun(input);
      }

      override async createLeadSession(input: Parameters<PaseoTeamAdapter["createLeadSession"]>[0]) {
        capturedCreateLeadSession = { playbook: input.playbook, transcript: input.transcript };
        return super.createLeadSession(input);
      }
    }

    const run = await createHarnessRun({
      name: "four-layer-metadata",
      tempDirs,
      workspacePrefix: "pluto-four-layer-metadata-",
      createAdapter: ({ team }) => new CapturingFakeAdapter({ team }),
    });
    const result = await run.resultPromise;

    expect(result.run.status).toBe("succeeded");
    expect(capturedStartRun?.playbook?.id).toBe("research-review");
    expect(capturedStartRun?.transcript?.path).toContain(`${result.run.runId}/mailbox.jsonl`);
    expect(capturedStartRun?.transcript?.roomRef).toBe(result.run.coordinationChannel?.locator);
    expect(capturedStartRun?.transcript?.roomRef.startsWith("fake-room:")).toBe(true);
    expect(capturedCreateLeadSession?.transcript).toEqual(capturedStartRun?.transcript);
  });

  it("writes final report from mailbox/task-list state", async () => {
    const run = await createHarnessRun({
      name: "four-layer-report",
      tempDirs,
      workspacePrefix: "pluto-four-layer-report-",
    });
    const result = await run.resultPromise;

    expect(result.run.status).toBe("succeeded");
    const finalReport = await readFile(result.finalReportPath, "utf8");
    expect(finalReport).toContain("## Required Role Citations");
    expect(finalReport).toContain("planner:");
    expect(finalReport).not.toContain("Synthesized from routing decisions");
  });

  it("can materialize a run-local workspace subdirectory under the provided workspace root", async () => {
    const run = await createHarnessRun({
      name: "four-layer-isolated-workspace",
      tempDirs,
      workspacePrefix: "pluto-four-layer-isolated-workspace-",
      workspaceSubdirPerRun: true,
    });
    const result = await run.resultPromise;

    const expectedWorkspaceDir = join(run.workspaceRoot, ".pluto-run-workspaces", result.run.runId);
    expect(result.workspaceDir).toBe(expectedWorkspaceDir);
    expect((await readFile(join(result.workspaceDir, "artifact.md"), "utf8")).toLowerCase()).toContain("lead");
  });

  it("preserves a substantive workspace artifact when the lead summary is much shorter", async () => {
    const run = await createHarnessRun({
      name: "four-layer-artifact-preserve",
      tempDirs,
      workspacePrefix: "pluto-four-layer-artifact-preserve-",
      prepareWorkspace: async (workspace) => {
        await writeFile(join(workspace, "artifact.md"), [
          "# Symphony Repo Report",
          "",
          "## Architecture",
          "- Runtime entry point: `src/index.ts`.",
          "- Orchestration harness: `src/orchestrator/manager-run-harness.ts`.",
          "",
          "## Extension Points",
          "- Adapter seam: `src/contracts/adapter.ts`.",
          "- Fake runtime: `src/adapters/fake/fake-adapter.ts`.",
          "",
          "## Pluto Guidance",
          "- Borrow the mailbox/task-list split; avoid replacing substantive artifacts with terse completion summaries.",
          "",
        ].join("\n"), "utf8");
      },
      createAdapter: ({ team }) => new FakeAdapter({
        team,
        summaryBuilder: () => [
          "Done. `artifact.md` contains the concise repo report.",
          "",
          "Verdict: pass.",
          "",
        ].join("\n"),
      }),
    });
    const result = await run.resultPromise;

    expect(result.run.status).toBe("succeeded");
    const artifact = await readFile(join(run.workspace, "artifact.md"), "utf8");
    expect(artifact).toContain("# Symphony Repo Report");
    expect(artifact).toContain("## Architecture");
    expect(artifact).toContain("Citations:");
    expect(artifact).toContain("Verdict: pass.");
    expect(artifact).toContain("- planner: `");
    expect(artifact).toContain("- generator: `");
    expect(artifact).toContain("- evaluator: `");
    expect(artifact).toContain("- Lead: coordinated the run and is represented in the final artifact.");

    const persistedArtifact = await readFile(result.artifactPath ?? "", "utf8");
    expect(persistedArtifact).toContain("# Symphony Repo Report");
  });

  it("backfills completion message citations when the lead summary omits them", async () => {
    const run = await createHarnessRun({
      name: "four-layer-citation-backfill",
      tempDirs,
      workspacePrefix: "pluto-four-layer-citation-backfill-",
      createAdapter: ({ team }) => new FakeAdapter({
        team,
        summaryBuilder: () => [
          "# Hello Team Summary",
          "",
          "- Lead: Hello from the lead!",
          "- Planner: Hello from the planner!",
          "- Generator: Hello from the generator!",
          "- Evaluator: Hello from the evaluator!",
          "",
        ].join("\n"),
      }),
    });
    const result = await run.resultPromise;

    expect(result.run.status).toBe("succeeded");
    const artifact = await readFile(join(run.workspace, "artifact.md"), "utf8");
    expect(artifact).toContain("Completion Citations:");
    expect(artifact).toContain("- planner: `");
    expect(artifact).toContain("- generator: `");
    expect(artifact).toContain("- evaluator: `");
  });

  it("fails closed for unsupported run-profile policy", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-four-layer-policy-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "bad-unsupported-worktree" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => new FakeAdapter({ team }),
    });

    expect(result.run.status).toBe("failed");
    expect(result.legacyResult.failure?.message).toContain("unsupported_worktree_materialization");
  });
});
