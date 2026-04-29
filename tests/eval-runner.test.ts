import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scoreRun } from "../evals/runner.js";
import { FakeAdapter } from "@/adapters/fake/index.js";
import type { AgentEvent, FinalArtifact } from "@/contracts/types.js";
import { DEFAULT_TEAM, RunStore, TeamRunService } from "@/orchestrator/index.js";

const event = (type: AgentEvent["type"], index: number, overrides: Partial<AgentEvent> = {}): AgentEvent => ({
  id: `ev-${index}`,
  runId: "eval-test-run",
  ts: `2026-04-29T00:00:0${index}.000Z`,
  type,
  payload: {},
  ...overrides,
});

const passingEvents: AgentEvent[] = [
  event("run_started", 0),
  event("lead_started", 1, { roleId: "lead", sessionId: "lead-session" }),
  event("worker_requested", 2, {
    roleId: "planner",
    sessionId: "lead-session",
    payload: { targetRole: "planner", instructions: "Plan the artifact." },
  }),
  event("worker_started", 3, { roleId: "planner", sessionId: "planner-session" }),
  event("worker_completed", 4, {
    roleId: "planner",
    sessionId: "planner-session",
    payload: { output: "planner contribution" },
  }),
  event("worker_requested", 5, {
    roleId: "generator",
    sessionId: "lead-session",
    payload: { targetRole: "generator", instructions: "Generate the artifact." },
  }),
  event("worker_started", 6, { roleId: "generator", sessionId: "generator-session" }),
  event("worker_completed", 7, {
    roleId: "generator",
    sessionId: "generator-session",
    payload: { output: "generator contribution" },
  }),
  event("worker_requested", 8, {
    roleId: "evaluator",
    sessionId: "lead-session",
    payload: { targetRole: "evaluator", instructions: "Evaluate the artifact." },
  }),
  event("worker_started", 9, { roleId: "evaluator", sessionId: "evaluator-session" }),
  event("worker_completed", 10, {
    roleId: "evaluator",
    sessionId: "evaluator-session",
    payload: { output: "evaluator contribution" },
  }),
  event("lead_message", 11, {
    roleId: "lead",
    sessionId: "lead-session",
    payload: { kind: "summary", markdown: "# Passing Artifact" },
  }),
  event("artifact_created", 12),
  event("run_completed", 13),
];

const passingArtifact: FinalArtifact = {
  runId: "eval-test-run",
  markdown: [
    "# Pluto MVP-alpha hello team",
    "",
    "## Worker contributions",
    "### planner",
    "planner contribution",
    "### generator",
    "generator contribution",
    "### evaluator",
    "evaluator contribution",
    "## Lead summary",
    "Lead aggregated planner, generator, and evaluator work.",
  ].join("\n"),
  leadSummary: "Pluto MVP-alpha hello team",
  contributions: [
    { roleId: "planner", sessionId: "planner-session", output: "planner contribution" },
    { roleId: "generator", sessionId: "generator-session", output: "generator contribution" },
    { roleId: "evaluator", sessionId: "evaluator-session", output: "evaluator contribution" },
  ],
};

async function loadFakeRunFixture(): Promise<{ eventTypesInOrder: AgentEvent["type"][] }> {
  const raw = await readFile(join(process.cwd(), "evals", "datasets", "fake-run-fixture.json"), "utf8");
  return JSON.parse(raw) as { eventTypesInOrder: AgentEvent["type"][] };
}

async function runDeterministicFakeWorkflow() {
  const workspace = await mkdtemp(join(tmpdir(), "pluto-eval-runner-test-"));
  try {
    let idSeq = 0;
    const nextId = () => `eval-test-id-${String(idSeq++).padStart(4, "0")}`;
    const fixedClock = () => new Date("2026-04-29T00:00:00.000Z");
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM, idGen: nextId, clock: fixedClock });
    const store = new RunStore({ dataDir: join(workspace, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      idGen: nextId,
      clock: fixedClock,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    return await service.run({
      id: "workflow-quality-v1-fake-task",
      title: "Pluto MVP-alpha workflow quality reference run",
      prompt:
        "Produce a markdown artifact that demonstrates team convergence. The artifact must clearly include the team lead synthesis plus planner, generator, and evaluator contributions, and it must not expose internal adapter prompt protocol text.",
      workspacePath: workspace,
      artifactPath: join(workspace, "workflow-quality-v1.md"),
      minWorkers: 2,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

describe("workflow quality eval scoring", () => {
  it("passes all rubric dimensions for a clean completed workflow", () => {
    const report = scoreRun({ runId: "eval-test-run", status: "completed", events: passingEvents, artifact: passingArtifact });

    expect(report.passed).toBe(true);
    expect(report.totalScore).toBe(1);
    expect(report.dimensions.map((dimension) => dimension.id)).toEqual([
      "event_sequence",
      "role_coverage",
      "artifact_cleanliness",
      "worker_contributions",
    ]);
    expect(report.dimensions.every((dimension) => dimension.passed)).toBe(true);
  });

  it("fails artifact_cleanliness when protocol fragments leak", () => {
    const report = scoreRun({
      runId: "eval-test-run",
      status: "completed",
      events: passingEvents,
      artifact: {
        ...passingArtifact,
        markdown: `${passingArtifact.markdown}\nInstructions from the Team Lead: leak`,
        contributions: [
          ...passingArtifact.contributions,
          { roleId: "planner", sessionId: "leaky-session", output: "Reply with your contribution only" },
        ],
      },
    });

    expect(report.passed).toBe(false);
    expect(report.dimensions.find((dimension) => dimension.id === "artifact_cleanliness")?.passed).toBe(false);
  });

  it("fails event_sequence when terminal completion is missing", () => {
    const report = scoreRun({
      runId: "eval-test-run",
      status: "completed",
      events: passingEvents.filter((ev) => ev.type !== "run_completed"),
      artifact: passingArtifact,
    });

    expect(report.passed).toBe(false);
    expect(report.dimensions.find((dimension) => dimension.id === "event_sequence")?.passed).toBe(false);
  });

  it("keeps the fake run fixture event order aligned with scored workflow reports", async () => {
    const fixture = await loadFakeRunFixture();
    const report = scoreRun(await runDeterministicFakeWorkflow());

    expect(report.summary.eventTypes).toEqual(fixture.eventTypesInOrder);
  });
});
