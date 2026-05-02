import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Playbook, RunProfile } from "@/contracts/four-layer.js";
import {
  loadFourLayerWorkspace,
  renderRolePrompt,
  resolveFourLayerSelection,
  runAuditMiddleware,
} from "@/index.js";

describe("team-lead-owned orchestration (v1.5 contract)", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluto-v15-"));
    await Promise.all([
      mkdir(join(rootDir, "agents")),
      mkdir(join(rootDir, "playbooks")),
      mkdir(join(rootDir, "scenarios")),
      mkdir(join(rootDir, "run-profiles")),
    ]);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  describe("lead prompt contains role roster and workflow", () => {
    it("renders Available Roles section listing all team members for the team lead", async () => {
      await seedWorkspace(rootDir);
      const workspace = await loadFourLayerWorkspace(rootDir);
      const resolved = await resolveFourLayerSelection(workspace, {
        scenario: "hello-team",
        runProfile: "fake-smoke",
      });

      const leadPrompt = renderRolePrompt(resolved, "teamlead");

      expect(leadPrompt).toContain("## Available Roles");
      expect(leadPrompt).toContain("- teamlead:");
      expect(leadPrompt).toContain("- planner:");
      expect(leadPrompt).toContain("- generator:");
      expect(leadPrompt).toContain("- evaluator:");
    });

    it("renders Workflow section for the team lead only", async () => {
      await seedWorkspace(rootDir);
      const workspace = await loadFourLayerWorkspace(rootDir);
      const resolved = await resolveFourLayerSelection(workspace, {
        scenario: "hello-team",
        runProfile: "fake-smoke",
      });

      const leadPrompt = renderRolePrompt(resolved, "teamlead");
      const workerPrompt = renderRolePrompt(resolved, "planner");

      expect(leadPrompt).toContain("## Workflow");
      expect(workerPrompt).not.toContain("## Available Roles");
      expect(workerPrompt).not.toContain("## Workflow");
    });

    it("renders Task section last in canonical stack order for the team lead", async () => {
      await seedWorkspace(rootDir);
      const workspace = await loadFourLayerWorkspace(rootDir);
      const resolved = await resolveFourLayerSelection(workspace, {
        scenario: "hello-team",
        runProfile: "fake-smoke",
      });

      const leadPrompt = renderRolePrompt(resolved, "teamlead");
      const taskIndex = leadPrompt.lastIndexOf("## Task");
      expect(taskIndex).toBeGreaterThan(0);
      expect(leadPrompt.indexOf("## Available Roles")).toBeLessThan(taskIndex);
      expect(leadPrompt.indexOf("## Workflow")).toBeLessThan(taskIndex);
    });
  });

  describe("audit enforces observed STAGE transitions for required roles", () => {
    const basePlaybook: Playbook = {
      schemaVersion: 0,
      kind: "playbook",
      name: "research-review",
      teamLead: "teamlead",
      members: ["planner", "generator", "evaluator"],
      workflow: "As team lead: planner -> generator -> evaluator.",
      audit: {
        requiredRoles: ["planner", "generator", "evaluator"],
        maxRevisionCycles: 1,
      },
    };

    const baseRunProfile: RunProfile = {
      schemaVersion: 0,
      kind: "run_profile",
      name: "fake-smoke",
      workspace: { cwd: "/tmp/pluto" },
    };

    let artifactRootDir: string;

    beforeEach(async () => {
      artifactRootDir = await mkdtemp(join(tmpdir(), "pluto-v15-audit-"));
      await mkdir(artifactRootDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(artifactRootDir, { recursive: true, force: true });
    });

    it("passes audit when all required roles appear in observed STAGE transitions", async () => {
      const result = await runAuditMiddleware({
        artifactRootDir,
        stdout: "STAGE: init -> planner\nSTAGE: planner -> generator\nSTAGE: generator -> evaluator\n",
        playbook: basePlaybook,
        runProfile: baseRunProfile,
        stageTransitions: [
          { from: "init", to: "planner" },
          { from: "planner", to: "generator" },
          { from: "generator", to: "evaluator" },
        ],
        stageTransitionSource: "observed_event_stream",
        revisionCount: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("succeeded");
    });

    it("fails audit when a required role is missing from observed STAGE transitions", async () => {
      const result = await runAuditMiddleware({
        artifactRootDir,
        stdout: "STAGE: init -> planner\n",
        playbook: basePlaybook,
        runProfile: baseRunProfile,
        stageTransitions: [
          { from: "init", to: "planner" },
        ],
        stageTransitionSource: "observed_event_stream",
        revisionCount: 0,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("failed_audit");
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "missing_required_role", role: "generator" }),
          expect.objectContaining({ code: "missing_required_role", role: "evaluator" }),
        ]),
      );
    });

    it("fails audit when no STAGE transitions are observed", async () => {
      const result = await runAuditMiddleware({
        artifactRootDir,
        stdout: "done\n",
        playbook: basePlaybook,
        runProfile: baseRunProfile,
        stageTransitions: [],
        stageTransitionSource: "observed_event_stream",
        revisionCount: 0,
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("failed_audit");
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "missing_stage_transitions" }),
        ]),
      );
    });

    it("passes audit when STAGE transitions cover required roles even with DEVIATION present", async () => {
      const result = await runAuditMiddleware({
        artifactRootDir,
        stdout: "STAGE: init -> planner\nDEVIATION: evaluator used cached output\nSTAGE: planner -> generator\nSTAGE: generator -> evaluator\n",
        playbook: basePlaybook,
        runProfile: baseRunProfile,
        stageTransitions: [
          { from: "init", to: "planner" },
          { from: "planner", to: "generator" },
          { from: "generator", to: "evaluator" },
        ],
        stageTransitionSource: "observed_event_stream",
        revisionCount: 0,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("succeeded");
    });
  });
});

async function seedWorkspace(dir: string) {
  await writeFile(
    join(dir, "agents", "teamlead.yaml"),
    [
      "schemaVersion: 0",
      "kind: agent",
      "name: teamlead",
      "description: Coordinates the team and writes the final synthesis.",
      "model: test-model",
      "system: |-",
      "  You are the team lead. Coordinate the team and produce the final artifact.",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(dir, "agents", "planner.yaml"),
    [
      "schemaVersion: 0",
      "kind: agent",
      "name: planner",
      "description: Produces a concise implementation plan.",
      "model: test-model",
      "system: |-",
      "  You are the planner. Write a concise implementation plan.",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(dir, "agents", "generator.yaml"),
    [
      "schemaVersion: 0",
      "kind: agent",
      "name: generator",
      "description: Produces the requested artifact body.",
      "model: test-model",
      "system: |-",
      "  You are the generator. Produce the requested artifact.",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(dir, "agents", "evaluator.yaml"),
    [
      "schemaVersion: 0",
      "kind: agent",
      "name: evaluator",
      "description: Reviews whether the artifact satisfies the task.",
      "model: test-model",
      "system: |-",
      "  You are the evaluator. Review whether the artifact satisfies the task.",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(dir, "playbooks", "research-review.yaml"),
    [
      "schemaVersion: 0",
      "kind: playbook",
      "name: research-review",
      "description: Plan -> generate -> evaluate.",
      "teamLead: teamlead",
      "members: [planner, generator, evaluator]",
      "workflow: |-",
      "  As team lead:",
      "  1. Send task to planner.",
      "  2. Hand plan to generator.",
      "  3. Hand artifact to evaluator.",
      "  4. Write final summary citing all roles.",
      "audit:",
      "  requiredRoles: [planner, generator, evaluator]",
      "  maxRevisionCycles: 1",
      "  finalReportSections: [workflow_steps_executed, deviations, required_role_citations]",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(dir, "scenarios", "hello-team.yaml"),
    [
      "schemaVersion: 0",
      "kind: scenario",
      "name: hello-team",
      "description: Produce a markdown summary.",
      "playbook: research-review",
      "task: |-",
      "  Produce a markdown summary that says hello from the lead, planner, generator, and evaluator.",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(dir, "run-profiles", "fake-smoke.yaml"),
    [
      "schemaVersion: 0",
      "kind: run_profile",
      "name: fake-smoke",
      "description: Fake adapter smoke profile.",
      "workspace:",
      "  cwd: /tmp/pluto",
    ].join("\n"),
    "utf8",
  );
}
