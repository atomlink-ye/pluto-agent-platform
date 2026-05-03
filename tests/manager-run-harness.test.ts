import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { PaseoTeamAdapter } from "@/contracts/adapter.js";
import type { CoordinationTranscriptRefV0, TeamPlaybookV0 } from "@/contracts/types.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("manager run harness", () => {
  it("runs the checked-in four-layer scenario end-to-end with the fake adapter", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-four-layer-run-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "fake-smoke" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => new FakeAdapter({ team }),
    });

    expect(result.run.status).toBe("succeeded");
    await expect(access(join(result.runDir, "mailbox.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(result.runDir, "tasks.json"))).resolves.toBeUndefined();
    const mailboxLog = await readFile(join(result.runDir, "mailbox.jsonl"), "utf8");
    const tasks = await readFile(join(result.runDir, "tasks.json"), "utf8");
    const artifact = await readFile(join(workspace, "artifact.md"), "utf8");
    expect(mailboxLog).toContain('"summary":"FINAL"');
    expect(mailboxLog).toContain("Coordination handle");
    expect(mailboxLog).not.toContain("/mailbox.jsonl");
    expect(mailboxLog).not.toContain("/tasks.json");
    expect(tasks).toContain('"status": "completed"');
    expect(artifact.toLowerCase()).toContain("lead");
    expect(artifact.toLowerCase()).toContain("planner");
    expect(artifact.toLowerCase()).toContain("generator");
    expect(artifact.toLowerCase()).toContain("evaluator");
  });

  it("passes mailbox metadata into adapter startRun and createLeadSession", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-four-layer-metadata-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

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

    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "fake-smoke" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => new CapturingFakeAdapter({ team }),
    });

    expect(result.run.status).toBe("succeeded");
    expect(capturedStartRun?.playbook?.id).toBe("research-review");
    expect(capturedStartRun?.transcript?.path).toContain(`${result.run.runId}/mailbox.jsonl`);
    expect(capturedStartRun?.transcript?.roomRef).toBe(result.run.coordinationChannel?.locator);
    expect(capturedStartRun?.transcript?.roomRef.startsWith("fake-room:")).toBe(true);
    expect(capturedCreateLeadSession?.transcript).toEqual(capturedStartRun?.transcript);
  });

  it("writes final report from mailbox/task-list state", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-four-layer-report-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "fake-smoke" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => new FakeAdapter({ team }),
    });

    expect(result.run.status).toBe("succeeded");
    const finalReport = await readFile(result.finalReportPath, "utf8");
    expect(finalReport).toContain("## Required Role Citations");
    expect(finalReport).toContain("planner:");
    expect(finalReport).not.toContain("Synthesized from routing decisions");
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
