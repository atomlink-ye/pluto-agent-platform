import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
    expect(result.artifactPath).toBeTruthy();
    const canonicalEvidence = await import("node:fs/promises").then(({ readFile }) => readFile(result.canonicalEvidencePath, "utf8"));
    expect(canonicalEvidence).toContain('"status": "succeeded"');
    expect(canonicalEvidence).toContain('"runId"');
    const legacyEvidence = await import("node:fs/promises").then(({ readFile }) => readFile(result.legacyEvidencePath, "utf8"));
    expect(legacyEvidence).toContain('"status": "done"');
    const stdout = await import("node:fs/promises").then(({ readFile }) => readFile(result.stdoutPath, "utf8"));
    expect(stdout).toContain("SUMMARY:");
    expect(stdout).toContain("WROTE: artifact.md");
  });

  it("observes worker completions from the fake adapter", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-four-layer-intent-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "fake-smoke" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => new FakeAdapter({ team }),
    });

    for (const role of ["planner", "generator", "evaluator"]) {
      const completed = result.legacyResult.events.findIndex((event) => event.type === "worker_completed" && event.roleId === role);
      expect(completed).toBeGreaterThanOrEqual(0);
    }
  });

  it("passes canonical playbook and transcript into adapter startRun and createLeadSession", async () => {
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
    expect(capturedStartRun?.playbook).toMatchObject({
      id: "research-review",
      title: "Planner to generator to evaluator, finalized by the lead.",
      schemaVersion: 0,
      orchestrationSource: "teamlead_direct",
    });
    expect(capturedStartRun?.playbook?.stages.map((stage) => stage.roleId)).toEqual(["planner", "generator", "evaluator"]);
    expect(capturedCreateLeadSession?.playbook).toEqual(capturedStartRun?.playbook);
    expect(capturedStartRun?.transcript).toEqual(capturedCreateLeadSession?.transcript);
    expect(capturedStartRun?.transcript?.path).toContain(`${result.run.runId}/coordination-transcript.jsonl`);
    expect(capturedStartRun?.transcript?.roomRef).toBe(`file-transcript:${result.run.runId}`);

    const leadStarted = result.legacyResult.events.find((event) => event.type === "lead_started");
    expect(leadStarted?.payload.playbookId).toBe("research-review");
    expect(leadStarted?.payload.orchestrationSource).toBe("teamlead_direct");
    expect(leadStarted?.payload.transcript).toMatchObject({
      kind: "file",
      roomRef: capturedStartRun?.transcript?.roomRef,
    });
    expect(leadStarted?.payload.playbookId).not.toBeNull();
    expect(leadStarted?.payload.transcript).not.toBeNull();
    expect(leadStarted?.payload.orchestrationSource).not.toBe("legacy_marker_fallback");
  });

  it("runs acceptance commands in the configured workspace", async () => {
    const root = await seedMinimalHarnessWorkspace("workspace-check", [
      "acceptance_commands:",
      "  - node -e \"require('fs').writeFileSync('cwd.txt', process.cwd())\"",
    ]);
    const workspace = join(root, "work");

    const result = await runManagerHarness({
      rootDir: root,
      selection: { scenario: "demo", runProfile: "workspace-check" },
      dataDir: join(root, ".pluto"),
      createAdapter: ({ team }) => new FakeAdapter({ team }),
    });

    expect(result.run.status).toBe("succeeded");
    await expect(readFile(join(workspace, "cwd.txt"), "utf8")).resolves.toBe(await realpath(workspace));
    await expect(readFile(join(result.runDir, "cwd.txt"), "utf8")).rejects.toBeTruthy();
  });

  it("writes final report from observed transitions without synthesis note", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-four-layer-deviations-"));
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
    expect(finalReport).not.toContain("Synthesized from routing decisions");
    expect(finalReport).toContain("## Workflow Steps Executed");
    expect(finalReport).toContain("## Deviations");
    expect(finalReport).toContain("none observed");
  });

  it.each([
    ["approval-gate", ["approval_gates:", "  pre_launch:", "    enabled: true"], "unsupported_approval_gate:preLaunch.enabled"],
    ["required-read", ["required_reads:", "  - { kind: external_document, path: doc-1 }"], "unsupported_required_read:external_document:doc-1"],
    ["concurrency", ["concurrency:", "  max_active_children: 2"], "unsupported_concurrency:maxActiveChildren:2"],
    ["worktree", ["workspace:", "  cwd: ${repo_root}/work", "  worktree:", "    branch: test", "    path: ${repo_root}/wt"], "unsupported_worktree_materialization:workspace.worktree"],
  ])("fails closed for unsupported run-profile policy: %s", async (profileName, profileExtra, expected) => {
    const root = await seedMinimalHarnessWorkspace(profileName, profileExtra);
    const workspace = join(root, "work");

    const result = await runManagerHarness({
      rootDir: root,
      selection: { scenario: "demo", runProfile: profileName },
      dataDir: join(root, ".pluto"),
      createAdapter: ({ team }) => new FakeAdapter({ team }),
    });

    expect(result.run.status).toBe("failed");
    expect(result.legacyResult.failure?.message).toContain(expected);
    expect(result.run.startedAt).toBeUndefined();
    expect(result.legacyResult.events).toEqual([]);
    await expect(access(workspace)).rejects.toBeTruthy();
    await expect(access(result.runDir)).rejects.toBeTruthy();
  });

  it("fails closed when a repo required_read escapes the repo root", async () => {
    const root = await seedMinimalHarnessWorkspace("escaped-required-read", [
      "required_reads:",
      "  - { kind: repo, path: ../outside.md }",
    ]);
    const workspace = join(root, "work");

    const result = await runManagerHarness({
      rootDir: root,
      selection: { scenario: "demo", runProfile: "escaped-required-read" },
      dataDir: join(root, ".pluto"),
      createAdapter: ({ team }) => new FakeAdapter({ team }),
    });

    expect(result.run.status).toBe("failed");
    expect(result.legacyResult.failure?.message).toContain("invalid_required_read_path:repo:../outside.md");
    expect(result.legacyResult.events).toEqual([]);
    await expect(access(workspace)).rejects.toBeTruthy();
    await expect(access(result.runDir)).rejects.toBeTruthy();
  });
});

async function seedMinimalHarnessWorkspace(profileName: string, profileExtra: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pluto-four-layer-root-"));
  tempDirs.push(root);
  await Promise.all([
    mkdir(join(root, "agents")),
    mkdir(join(root, "playbooks")),
    mkdir(join(root, "scenarios")),
    mkdir(join(root, "run-profiles")),
  ]);
  await Promise.all([
    writeFile(join(root, "agents", "lead.yaml"), ["name: lead", "model: test", "system: lead"].join("\n")),
    writeFile(join(root, "agents", "planner.yaml"), ["name: planner", "model: test", "system: planner"].join("\n")),
    writeFile(join(root, "playbooks", "demo.yaml"), [
      "name: demo-playbook",
      "team_lead: lead",
      "members: [planner]",
      "workflow: delegate to planner",
      "audit:",
      "  required_roles: [planner]",
      "  max_revision_cycles: 0",
      "  final_report_sections: [implementation_summary, workflow_steps_executed, required_role_citations, deviations]",
    ].join("\n")),
    writeFile(join(root, "scenarios", "demo.yaml"), ["name: demo", "playbook: demo-playbook", "task: do it"].join("\n")),
    writeFile(join(root, "run-profiles", `${profileName}.yaml`), [
      `name: ${profileName}`,
      ...(profileExtra.some((line) => line === "workspace:") ? [] : ["workspace:", "  cwd: ${repo_root}/work"]),
      ...profileExtra,
      "artifact_contract:",
      "  required_files:",
      "    - artifact.md",
      "    - { path: final-report.md, required_sections: [implementation_summary, workflow_steps_executed, required_role_citations, deviations] }",
      "stdout_contract:",
      "  required_lines: [SUMMARY:]",
    ].join("\n")),
  ]);
  return root;
}
