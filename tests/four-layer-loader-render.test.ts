import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES,
  FourLayerLoaderError,
  loadFourLayerWorkspace,
  renderRolePrompt,
  resolveFourLayerSelection,
  validateScenario,
} from "@/index.js";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "pluto-four-layer-"));
  await Promise.all([
    mkdir(join(rootDir, "agents")),
    mkdir(join(rootDir, "playbooks")),
    mkdir(join(rootDir, "scenarios")),
    mkdir(join(rootDir, "run-profiles")),
    mkdir(join(rootDir, "knowledge")),
  ]);
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("four-layer loader and render", () => {
  it("loads authored YAML, validates it, and resolves cross references", async () => {
    await seedValidWorkspace(rootDir);
    const workspace = await loadFourLayerWorkspace(rootDir);
    const resolved = await resolveFourLayerSelection(workspace, {
      scenario: "financial-review",
      runProfile: "local-dev",
    });

    expect(resolved.teamLead.value.name).toBe("team_lead");
    expect(resolved.members.map((member) => member.value.name)).toEqual(["planner", "evaluator"]);
    expect(resolved.playbook.value.teamLead).toBe("team_lead");
    expect(resolved.scenario.value.playbook).toBe("research-review");
    expect(resolved.overlays.planner!.knowledge?.map((entry) => entry.ref)).toEqual([
      "knowledge/planner.md",
    ]);
    expect(resolved.overlays.evaluator!.rubric?.content).toContain("Checklist");
    expect(resolved.runProfile?.value.workspace.cwd).toBe("/tmp/pluto");
  });

  it("fails validation for invalid scenario shapes", () => {
    const result = validateScenario({
      schemaVersion: 0,
      kind: "scenario",
      name: "bad",
      playbook: "demo",
      taskMode: "fixed",
      overlays: {
        planner: {
          knowledgeRefs: "knowledge/not-an-array.md",
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("fixed scenarios require task");
    expect(result.ok ? [] : result.errors).toContain("overlays.planner.knowledgeRefs must be an array of non-empty strings");
  });

  it("fails closed on missing references", async () => {
    await seedValidWorkspace(rootDir);
    await writeFile(
      join(rootDir, "scenarios", "financial-review.yaml"),
      [
        "name: financial-review",
        "playbook: research-review",
        "task: |-",
        "  Review the budget.",
        "overlays:",
        "  planner:",
        "    knowledge_refs:",
        "      - knowledge/missing.md",
      ].join("\n"),
    );

    const workspace = await loadFourLayerWorkspace(rootDir);
    await expect(resolveFourLayerSelection(workspace, { scenario: "financial-review" })).rejects.toMatchObject({
      name: "FourLayerLoaderError",
      issues: ["scenario financial-review overlay planner knowledge ref not found: knowledge/missing.md"],
    } satisfies Partial<FourLayerLoaderError>);
  });

  it("fails closed when an authored file declares the wrong kind", async () => {
    await seedValidWorkspace(rootDir);
    await writeFile(join(rootDir, "playbooks", "research-review.yaml"), [
      "schemaVersion: 0",
      "kind: scenario",
      "name: research-review",
      "team_lead: team_lead",
      "members: [planner, evaluator]",
      "workflow: |-",
      "  As team lead:",
      "  1. Ask planner for a plan.",
      "  2. Ask evaluator for a review.",
    ].join("\n"));

    await expect(loadFourLayerWorkspace(rootDir)).rejects.toMatchObject({
      name: "FourLayerLoaderError",
      issues: ["kind must be playbook"],
    } satisfies Partial<FourLayerLoaderError>);
  });

  it("fails closed when an authored file declares the wrong schemaVersion", async () => {
    await seedValidWorkspace(rootDir);
    await writeFile(join(rootDir, "agents", "planner.yaml"), [
      "schemaVersion: 999",
      "name: planner",
      "description: Writes the execution plan.",
      "model: test-model",
      "system: |-",
      "  You are the planner.",
    ].join("\n"));

    await expect(loadFourLayerWorkspace(rootDir)).rejects.toMatchObject({
      name: "FourLayerLoaderError",
      issues: ["schemaVersion must be 0"],
    } satisfies Partial<FourLayerLoaderError>);
  });

  it("renders canonical prompt order and only injects roster/workflow for team_lead", async () => {
    await seedValidWorkspace(rootDir);
    const workspace = await loadFourLayerWorkspace(rootDir);
    const resolved = await resolveFourLayerSelection(workspace, { scenario: "financial-review" });

    const leadPrompt = renderRolePrompt(resolved, "team_lead");
    const plannerPrompt = renderRolePrompt(resolved, "planner");
    const evaluatorPrompt = renderRolePrompt(resolved, "evaluator");

    expect(leadPrompt.indexOf("You are the team lead.")).toBeLessThan(leadPrompt.indexOf("## Available Roles"));
    expect(leadPrompt.indexOf("## Available Roles")).toBeLessThan(leadPrompt.indexOf("## Workflow"));
    expect(leadPrompt.indexOf("## Workflow")).toBeLessThan(leadPrompt.indexOf("## Task"));
    expect(leadPrompt).toContain("- planner: Writes the execution plan.");
    expect(leadPrompt).toContain("## Coordination via SendMessage and TaskTools");
    expect(leadPrompt).toContain("task.create");
    expect(leadPrompt).toContain("SendMessage");
    expect(leadPrompt).not.toContain("paseo run");
    expect(leadPrompt).not.toContain("DELEGATE: <available-role-name>");
    expect(leadPrompt).toContain("As team lead:");

    expect(plannerPrompt).not.toContain("## Available Roles");
    expect(plannerPrompt).not.toContain("## Workflow");
    expect(plannerPrompt.indexOf("## Specialization")).toBeLessThan(plannerPrompt.indexOf("## Knowledge"));
    expect(plannerPrompt.indexOf("## Knowledge")).toBeLessThan(plannerPrompt.indexOf("## Task"));

    expect(evaluatorPrompt).toContain("## Rubric");
    expect(evaluatorPrompt.indexOf("## Rubric")).toBeLessThan(evaluatorPrompt.indexOf("## Task"));
  });

  it("fails closed when a knowledge ref exceeds the cap", async () => {
    await seedValidWorkspace(rootDir);
    await writeFile(
      join(rootDir, "knowledge", "planner.md"),
      "x".repeat(FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES + 1),
    );

    const workspace = await loadFourLayerWorkspace(rootDir);
    await expect(resolveFourLayerSelection(workspace, { scenario: "financial-review" })).rejects.toMatchObject({
      name: "FourLayerLoaderError",
      issues: [`knowledge/planner.md exceeds per-ref cap ${FOUR_LAYER_KNOWLEDGE_MAX_REF_BYTES}`],
    } satisfies Partial<FourLayerLoaderError>);
  });
});

async function seedValidWorkspace(rootDir: string) {
  await Promise.all([
    writeFile(join(rootDir, "agents", "team-lead.yaml"), [
      "name: team_lead",
      "description: Leads the run.",
      "model: test-model",
      "system: |-",
      "  You are the team lead.",
    ].join("\n")),
    writeFile(join(rootDir, "agents", "planner.yaml"), [
      "name: planner",
      "description: Writes the execution plan.",
      "model: test-model",
      "system: |-",
      "  You are the planner.",
    ].join("\n")),
    writeFile(join(rootDir, "agents", "evaluator.yaml"), [
      "name: evaluator",
      "description: Reviews the result.",
      "model: test-model",
      "system: |-",
      "  You are the evaluator.",
    ].join("\n")),
    writeFile(join(rootDir, "playbooks", "research-review.yaml"), [
      "name: research-review",
      "team_lead: team_lead",
      "members: [planner, evaluator]",
      "workflow: |-",
      "  As team lead:",
      "  1. Ask planner for a plan.",
      "  2. Ask evaluator for a review.",
      "audit:",
      "  required_roles: [planner, evaluator]",
      "  max_revision_cycles: 1",
      "  final_report_sections: [workflow_steps_executed, deviations]",
    ].join("\n")),
    writeFile(join(rootDir, "scenarios", "financial-review.yaml"), [
      "name: financial-review",
      "playbook: research-review",
      "task: |-",
      "  Review the operating budget.",
      "overlays:",
      "  planner:",
      "    prompt: |-",
      "      Start with assumptions.",
      "    knowledge_refs:",
      "      - knowledge/planner.md",
      "  evaluator:",
      "    rubric_ref: knowledge/rubric.md",
    ].join("\n")),
    writeFile(join(rootDir, "run-profiles", "local-dev.yaml"), [
      "name: local-dev",
      "workspace:",
      "  cwd: /tmp/pluto",
      "required_reads:",
      "  - { kind: repo, path: AGENTS.md }",
      "acceptance_commands:",
      "  - pnpm typecheck",
      "  - { cmd: pnpm test, blocker_ok: true }",
      "artifact_contract:",
      "  required_files:",
      "    - artifact.md",
      "stdout_contract:",
      "  required_lines:",
      "    - SUMMARY:",
    ].join("\n")),
    writeFile(join(rootDir, "knowledge", "planner.md"), "Planning notes"),
    writeFile(join(rootDir, "knowledge", "rubric.md"), "Checklist\n- correctness"),
  ]);
}
