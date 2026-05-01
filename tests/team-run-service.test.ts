import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { buildDefaultTeam, DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import { DEFAULT_TEAM_PLAYBOOK_V0, RESEARCH_REVIEW_PLAYBOOK_ID, validateTeamPlaybookV0 } from "@/orchestrator/team-playbook.js";
import type { AgentEvent, AgentRoleConfig, AgentSession, TeamConfig, TeamTask } from "@/contracts/types.js";
import type { PaseoTeamAdapter } from "@/contracts/adapter.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-mvp-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const buildTask = (id: string, overrides: Partial<TeamTask> = {}): TeamTask => ({
  id,
  title: `Hello team ${id}`,
  prompt: "Produce a hello-team markdown artifact.",
  workspacePath: workDir,
  minWorkers: 2,
  ...overrides,
});

class PlannerOnlyLeadAdapter implements PaseoTeamAdapter {
  private events: AgentEvent[] = [];
  private cursor = 0;
  private runId = "";
  private team!: TeamConfig;

  constructor(
    private readonly requestedRoles: Array<"planner" | "generator" | "evaluator"> = ["planner"],
  ) {}

  async startRun(input: { runId: string; task: TeamTask; team: TeamConfig }): Promise<void> {
    this.runId = input.runId;
    this.team = input.team;
  }

  async createLeadSession(input: {
    runId: string;
    task: TeamTask;
    role: AgentRoleConfig;
  }): Promise<AgentSession> {
    this.events.push(this.event("lead_started", input.role.id, "lead-session", { provider: "test" }));
    for (const roleId of this.requestedRoles) {
      this.events.push(
        this.event("worker_requested", roleId, "lead-session", {
          targetRole: roleId,
          instructions: `${roleId} request from a stochastic lead.`,
          orchestratorSource: "lead_marker",
        }),
      );
    }
    return { sessionId: "lead-session", role: input.role };
  }

  async createWorkerSession(input: {
    runId: string;
    role: AgentRoleConfig;
    instructions: string;
  }): Promise<AgentSession> {
    const sessionId = `${input.role.id}-session`;
    this.events.push(
      this.event("worker_started", input.role.id, sessionId, { instructions: input.instructions }),
      this.event("worker_completed", input.role.id, sessionId, {
        output: `hello from ${input.role.id}`,
      }),
    );
    return { sessionId, role: input.role };
  }

  async sendMessage(input: { runId: string; sessionId: string; message: string }): Promise<void> {
    void input;
    this.events.push(
      this.event("lead_message", this.team.leadRoleId, "lead-session", {
        kind: "summary",
        markdown: "hello from lead\nhello from planner\nhello from generator\nhello from evaluator",
      }),
    );
  }

  async readEvents(): Promise<AgentEvent[]> {
    const next = this.events.slice(this.cursor);
    this.cursor = this.events.length;
    return next;
  }

  async waitForCompletion(): Promise<AgentEvent[]> {
    return this.readEvents();
  }

  async endRun(): Promise<void> {}

  private event(
    type: AgentEvent["type"],
    roleId: AgentEvent["roleId"],
    sessionId: string,
    payload: Record<string, unknown>,
  ): AgentEvent {
    return {
      id: `${type}-${this.events.length}`,
      runId: this.runId,
      ts: new Date().toISOString(),
      type,
      roleId,
      sessionId,
      payload,
    };
  }
}

describe("TeamRunService with FakeAdapter (E2E)", () => {
  it("represents and validates the default playbook dependency chain", () => {
    const validation = validateTeamPlaybookV0(DEFAULT_TEAM_PLAYBOOK_V0, DEFAULT_TEAM);
    expect(validation.ok).toBe(true);
    expect(DEFAULT_TEAM_PLAYBOOK_V0.stages.map((stage) => [stage.id, stage.roleId, stage.dependsOn])).toEqual([
      ["planner-contract", "planner", []],
      ["generator-output", "generator", ["planner-contract"]],
      ["evaluator-verdict", "evaluator", ["generator-output"]],
    ]);
    expect(DEFAULT_TEAM_PLAYBOOK_V0.finalCitationMetadata.requiredStageIds).toEqual([
      "planner-contract",
      "generator-output",
      "evaluator-verdict",
    ]);
    expect(DEFAULT_TEAM_PLAYBOOK_V0.revisionRules[0]).toMatchObject({
      fromStageId: "evaluator-verdict",
      targetStageId: "generator-output",
      maxRevisionCycles: 1,
    });
  });

  it("dispatches at least 2 workers and writes a final artifact", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask("t-e2e-1", { orchestrationMode: "teamlead_direct" }));

    expect(result.status).toBe("completed");
    expect(result.artifact).toBeDefined();
    const contributions = result.artifact!.contributions;
    expect(contributions.length).toBeGreaterThanOrEqual(2);
    const roles = new Set(contributions.map((c) => c.roleId));
    expect(roles.has("planner")).toBe(true);
    expect(roles.has("generator")).toBe(true);

    // events.jsonl persisted with the canonical event shape.
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const eventTypes = eventsRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).type);
    expect(eventTypes).toContain("run_started");
    expect(eventTypes).toContain("coordination_transcript_created");
    expect(eventTypes).toContain("lead_started");
    expect(eventTypes.filter((t) => t === "worker_started").length).toBeGreaterThanOrEqual(2);
    expect(eventTypes.filter((t) => t === "worker_completed").length).toBeGreaterThanOrEqual(2);
    expect(eventTypes).toContain("lead_message");
    expect(eventTypes).toContain("artifact_created");
    expect(eventTypes[eventTypes.length - 1]).toBe("run_completed");

    const parsedEvents = eventsRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const runStarted = parsedEvents.find((event) => event.type === "run_started");
    const transcriptFile = join(workDir, ".pluto", "runs", result.runId, "coordination-transcript.jsonl");
    expect(runStarted?.payload).toMatchObject({
      playbookId: "teamlead-direct-default-v0",
      orchestrationMode: "teamlead_direct",
      orchestrationSource: "teamlead_direct",
      legacyMarkerDispatch: "fallback_only",
      transcript: {
        kind: "file",
        roomRef: `file-transcript:${result.runId}`,
      },
      playbook: {
        id: "teamlead-direct-default-v0",
        title: DEFAULT_TEAM_PLAYBOOK_V0.title,
        schemaVersion: 0,
        orchestrationSource: "teamlead_direct",
      },
    });
    expect(runStarted?.payload.transcript.kind).toBe("file");
    const generatorStarted = parsedEvents.find(
      (event) => event.type === "worker_started" && event.roleId === "generator",
    );
    expect(generatorStarted?.payload.catalogSelection).toMatchObject({
      entry: { id: "default-generator", version: "0.0.1" },
      workerRole: { id: "generator", version: "0.0.1" },
      skill: { id: "generate-artifact", version: "0.0.1" },
      template: { id: "generator-body", version: "0.0.1" },
      policyPack: { id: "default-guardrails", version: "0.0.1" },
    });

    // artifact.md exists and references each contributing role.
    const artifactMd = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "artifact.md"),
      "utf8",
    );
    expect(artifactMd).toContain("planner");
    expect(artifactMd).toContain("generator");
    expect(artifactMd).toContain("evaluator");

    const transcriptRaw = await readFile(transcriptFile, "utf8");
    expect(transcriptRaw).toContain("teamlead_started");
    expect(transcriptRaw).toContain("stage_output");
    expect(transcriptRaw).toContain("verdict");

    const evidenceRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "evidence.json"),
      "utf8",
    );
    const evidence = JSON.parse(evidenceRaw);
    expect(evidence.orchestration).toMatchObject({
      playbookId: "teamlead-direct-default-v0",
      orchestrationMode: "teamlead_direct",
      orchestrationSource: "teamlead_direct",
      transcript: {
        kind: "file",
        path: transcriptFile,
        roomRef: `file-transcript:${result.runId}`,
      },
    });
  });

  it("writes per-run coordination transcript", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask("t-transcript", { orchestrationMode: "teamlead_direct" }));

    expect(result.status).toBe("completed");
    const runDir = join(workDir, ".pluto", "runs", result.runId);
    const transcriptFile = join(runDir, "coordination-transcript.jsonl");
    const transcriptRaw = await readFile(transcriptFile, "utf8");
    const records = transcriptRaw.trim().split("\n").map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      type: "run_metadata",
      runId: result.runId,
      payload: {
        runId: result.runId,
        playbookId: DEFAULT_TEAM_PLAYBOOK_V0.id,
      },
    });
    const stageRequests = records.filter((record) => record.type === "stage_request");
    expect(stageRequests).toHaveLength(DEFAULT_TEAM_PLAYBOOK_V0.stages.length);
    expect(stageRequests.map((record) => record.payload.stageId)).toEqual(
      DEFAULT_TEAM_PLAYBOOK_V0.stages.map((stage) => stage.id),
    );
    const evidenceRaw = await readFile(join(runDir, "evidence.json"), "utf8");
    const evidence = JSON.parse(evidenceRaw);
    expect(evidence.orchestration?.transcript).toEqual({
      kind: "file",
      path: transcriptFile,
      roomRef: `file-transcript:${result.runId}`,
    });
  });

  it("selects a non-default playbook without TeamRunService per-playbook control-flow", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run({
      ...buildTask("t-research-review", { orchestrationMode: "teamlead_direct" }),
      playbookId: RESEARCH_REVIEW_PLAYBOOK_ID,
    });

    expect(result.status).toBe("completed");
    expect(result.artifact!.contributions.map((c) => c.roleId)).toEqual(["planner", "evaluator"]);
    const eventsRaw = await readFile(join(workDir, ".pluto", "runs", result.runId, "events.jsonl"), "utf8");
    const events = eventsRaw.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.find((event) => event.type === "run_started")?.payload.playbookId).toBe(RESEARCH_REVIEW_PLAYBOOK_ID);
    const workerRequests = events.filter((event) => event.type === "worker_requested");
    expect(workerRequests.map((event) => event.payload.playbookStageId)).toEqual(["research-brief", "research-review"]);
    expect(workerRequests[1]?.payload.dependsOn).toEqual(["research-brief"]);
    expect(workerRequests.map((event) => event.payload.orchestratorSource)).toEqual([
      "teamlead_direct",
      "teamlead_direct",
    ]);
    const evidenceRaw = await readFile(join(workDir, ".pluto", "runs", result.runId, "evidence.json"), "utf8");
    const evidence = JSON.parse(evidenceRaw);
    expect(evidence.orchestration?.playbookId).toBe(RESEARCH_REVIEW_PLAYBOOK_ID);
  });

  it("selects the research-review playbook from team config without TeamRunService control-flow edits", async () => {
    const team = {
      ...buildDefaultTeam(),
      defaultPlaybookId: RESEARCH_REVIEW_PLAYBOOK_ID,
    };
    const adapter = new FakeAdapter({ team });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask("t-research-review-defaulted", { orchestrationMode: "teamlead_direct" }));

    expect(result.status).toBe("completed");
    expect(result.artifact!.contributions.map((c) => c.roleId)).toEqual(["planner", "evaluator"]);
    const evidenceRaw = await readFile(join(workDir, ".pluto", "runs", result.runId, "evidence.json"), "utf8");
    const evidence = JSON.parse(evidenceRaw);
    expect(evidence.orchestration?.playbookId).toBe(RESEARCH_REVIEW_PLAYBOOK_ID);
    const eventsRaw = await readFile(join(workDir, ".pluto", "runs", result.runId, "events.jsonl"), "utf8");
    const events = eventsRaw.trim().split("\n").map((line) => JSON.parse(line));
    expect(events.find((event) => event.type === "run_started")?.payload.playbook).toMatchObject({
      id: RESEARCH_REVIEW_PLAYBOOK_ID,
      title: "Research with independent review",
      schemaVersion: 0,
      orchestrationSource: "teamlead_direct",
    });
  });

  it("enforces TeamLead-direct stage dependencies and records dependency trace", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(buildTask("t-teamlead-direct-gating", { orchestrationMode: "teamlead_direct" }));

    expect(result.status).toBe("completed");
    const eventsRaw = await readFile(join(workDir, ".pluto", "runs", result.runId, "events.jsonl"), "utf8");
    const events = eventsRaw.trim().split("\n").map((line) => JSON.parse(line));
    const workerRequests = events.filter((event) => event.type === "worker_requested");
    expect(workerRequests.map((event) => event.payload.orchestratorSource)).toEqual([
      "teamlead_direct",
      "teamlead_direct",
      "teamlead_direct",
    ]);

    const transcriptFile = join(workDir, ".pluto", "runs", result.runId, "coordination-transcript.jsonl");
    const transcriptRecords = (await readFile(transcriptFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const plannerOutputIndex = transcriptRecords.findIndex((record) => record.type === "stage_output" && record.payload.stageId === "planner-contract");
    const generatorRequestIndex = transcriptRecords.findIndex((record) => record.type === "stage_request" && record.payload.stageId === "generator-output");
    const generatorOutputIndex = transcriptRecords.findIndex((record) => record.type === "stage_output" && record.payload.stageId === "generator-output");
    const evaluatorRequestIndex = transcriptRecords.findIndex((record) => record.type === "stage_request" && record.payload.stageId === "evaluator-verdict");
    expect(plannerOutputIndex).toBeGreaterThanOrEqual(0);
    expect(generatorRequestIndex).toBeGreaterThan(plannerOutputIndex);
    expect(generatorOutputIndex).toBeGreaterThan(generatorRequestIndex);
    expect(evaluatorRequestIndex).toBeGreaterThan(generatorOutputIndex);

    const stageOutputs = new Map(
      transcriptRecords
        .filter((record) => record.type === "stage_output" || record.type === "verdict")
        .map((record) => [record.payload.stageId, record.payload.output] as const),
    );
    const finalSummary = String(result.artifact?.markdown ?? "");
    expect(finalSummary).toContain(String(stageOutputs.get("planner-contract") ?? ""));
    expect(finalSummary).toContain(String(stageOutputs.get("generator-output") ?? ""));
    expect(finalSummary).toContain(String(stageOutputs.get("evaluator-verdict") ?? ""));

    const evidence = JSON.parse(await readFile(join(workDir, ".pluto", "runs", result.runId, "evidence.json"), "utf8"));
    expect(evidence.orchestration?.dependencyTrace.map((entry: { stageId: string }) => entry.stageId)).toEqual([
      "planner-contract",
      "generator-output",
      "evaluator-verdict",
    ]);
  });

  it("keeps marker fallback behavior unchanged in lead_marker mode", async () => {
    const adapter = new PlannerOnlyLeadAdapter();
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 250,
      underdispatchFallbackMs: 1,
    });

    const result = await service.run(buildTask("t-marker-legacy", { orchestrationMode: "lead_marker" }));

    expect(result.status).toBe("completed");
    expect(result.artifact!.contributions.map((c) => c.roleId)).toEqual(["planner", "generator", "evaluator"]);
    const events = (await readFile(join(workDir, ".pluto", "runs", result.runId, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "orchestrator_underdispatch_fallback")).toBe(true);
    expect(events.find((event) => event.type === "run_completed")?.payload.orchestrationMode).toBe("lead_marker");
  });

  it("evaluator FAIL triggers TeamLead revision", async () => {
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      stageOutputResolver: ({ role, stageId, stageAttempt }) => {
        if (stageId === "generator-output") {
          return `generator-${stageAttempt}: revised artifact body`;
        }
        if (stageId === "evaluator-verdict") {
          return stageAttempt === 1
            ? "FAIL: generator output missed one acceptance criterion."
            : "PASS: revised generator output now satisfies the planner contract.";
        }
        if (role.id === "planner") {
          return "planner-contract: satisfy acceptance criteria and flag risks.";
        }
        return undefined;
      },
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({ adapter, team: DEFAULT_TEAM, store, pumpIntervalMs: 1, timeoutMs: 5_000 });

    const result = await service.run(buildTask("t-revision-success", { orchestrationMode: "teamlead_direct" }));

    expect(result.status).toBe("completed");
    const runDir = join(workDir, ".pluto", "runs", result.runId);
    const transcriptRecords = (await readFile(join(runDir, "coordination-transcript.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(transcriptRecords.some((record) => record.type === "revision_request" && record.payload.attempt === 1)).toBe(true);
    expect(transcriptRecords.some((record) => record.type === "stage_output" && record.payload.stageId === "generator-output" && record.payload.attempt === 2)).toBe(true);
    expect(transcriptRecords.some((record) => record.type === "verdict" && record.payload.stageId === "evaluator-verdict" && record.payload.attempt === 2 && String(record.payload.output).startsWith("PASS:"))).toBe(true);
    const evidence = JSON.parse(await readFile(join(runDir, "evidence.json"), "utf8"));
    expect(evidence.orchestration?.revisions).toEqual([
      {
        stageId: "generator-output",
        attempt: 1,
        evaluatorVerdict: "FAIL: generator output missed one acceptance criterion.",
      },
    ]);
    expect(evidence.orchestration?.finalReconciliation?.valid).toBe(true);
  });

  it("max-round failure produces escalation evidence", async () => {
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      stageOutputResolver: ({ role, stageId, stageAttempt }) => {
        if (role.id === "planner") {
          return "planner-contract: satisfy acceptance criteria and flag risks.";
        }
        if (stageId === "generator-output") {
          return `generator-${stageAttempt}: still flawed artifact body`;
        }
        if (stageId === "evaluator-verdict") {
          return "FAIL: generator output still violates the planner contract.";
        }
        return undefined;
      },
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({ adapter, team: DEFAULT_TEAM, store, pumpIntervalMs: 1, timeoutMs: 5_000 });

    const result = await service.run(buildTask("t-revision-escalates", { orchestrationMode: "teamlead_direct" }));

    expect(result.status).toBe("completed_with_escalation");
    const runDir = join(workDir, ".pluto", "runs", result.runId);
    const events = (await readFile(join(runDir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "escalation")).toBe(true);
    const evidence = JSON.parse(await readFile(join(runDir, "evidence.json"), "utf8"));
    expect(evidence.orchestration?.escalation).toEqual({
      stageId: "generator-output",
      attempts: 1,
      lastVerdict: "FAIL: generator output still violates the planner contract.",
    });
  });

  it("missing citation rejects final reconciliation", async () => {
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      stageOutputResolver: ({ role, stageId }) => {
        if (role.id === "planner") return "planner-contract: satisfy acceptance criteria and flag risks.";
        if (stageId === "generator-output") return "generator-output: artifact body cites planner contract.";
        if (stageId === "evaluator-verdict") return "PASS: evaluator approved the generator output.";
        return undefined;
      },
      summaryBuilder: () => [
        "# Missing evaluator citation",
        "planner-contract: satisfy acceptance criteria and flag risks.",
        "generator-output: artifact body cites planner contract.",
      ].join("\n"),
    });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({ adapter, team: DEFAULT_TEAM, store, pumpIntervalMs: 1, timeoutMs: 5_000 });

    const result = await service.run(buildTask("t-missing-citation", { orchestrationMode: "teamlead_direct" }));

    expect(result.status).toBe("completed_with_warnings");
    const runDir = join(workDir, ".pluto", "runs", result.runId);
    const events = (await readFile(join(runDir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "final_reconciliation_invalid")).toBe(true);
    const evidence = JSON.parse(await readFile(join(runDir, "evidence.json"), "utf8"));
    expect(evidence.orchestration?.finalReconciliation?.valid).toBe(false);
    expect(evidence.orchestration?.finalReconciliation?.citations.find((citation: { stageId: string }) => citation.stageId === "evaluator-verdict")?.present).toBe(false);
  });

  it("stamps lead_marker on marker-driven worker requests", async () => {
    const adapter = new PlannerOnlyLeadAdapter(["planner", "generator", "evaluator"]);
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 250,
      underdispatchFallbackMs: 25,
    });

    const result = await service.run(buildTask("t-marker-path", { orchestrationMode: "lead_marker" }));

    expect(result.status).toBe("completed");
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    const events = eventsRaw.trim().split("\n").map((line) => JSON.parse(line));
    const workerRequests = events.filter((event) => event.type === "worker_requested");
    expect(workerRequests).toHaveLength(3);
    expect(workerRequests.map((event) => event.payload.orchestratorSource)).toEqual([
      "lead_marker",
      "lead_marker",
      "lead_marker",
    ]);
    expect(events.some((event) => event.type === "orchestrator_underdispatch_fallback")).toBe(false);
  });

  it("falls back to dispatch missing workers when a live lead under-dispatches", async () => {
    const adapter = new PlannerOnlyLeadAdapter();
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 250,
      underdispatchFallbackMs: 1,
    });

    const result = await service.run(buildTask("t-underdispatch-fallback", { orchestrationMode: "lead_marker" }));

    expect(result.status).toBe("completed");
    const roles = result.artifact!.contributions.map((c) => c.roleId);
    expect(roles).toEqual(["planner", "generator", "evaluator"]);
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw).toContain("orchestrator_underdispatch_fallback");
    const events = eventsRaw.trim().split("\n").map((line) => JSON.parse(line));
    const workerRequests = events.filter((event) => event.type === "worker_requested");
    expect(workerRequests.map((event) => [event.payload.targetRole ?? event.roleId, event.payload.orchestratorSource])).toEqual([
      ["planner", "lead_marker"],
      ["generator", "pluto_fallback"],
      ["evaluator", "pluto_fallback"],
    ]);
  });

  it("rejects tasks with minWorkers < 2", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({ adapter, team: DEFAULT_TEAM, store });
    await expect(
      service.run({ ...buildTask("t-bad"), minWorkers: 1 }),
    ).rejects.toThrow(/min_workers_too_low/);
  });

  it("records run_failed when adapter rejects createLeadSession", async () => {
    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    // Force lead failure by manually altering the team's lead role kind.
    const brokenTeam = {
      ...DEFAULT_TEAM,
      roles: DEFAULT_TEAM.roles.map((r) =>
        r.id === DEFAULT_TEAM.leadRoleId ? { ...r, kind: "worker" as const } : r,
      ),
    };
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter,
      team: brokenTeam,
      store,
      timeoutMs: 1_000,
      pumpIntervalMs: 1,
    });

    const result = await service.run(buildTask("t-fail"));
    expect(result.status).toBe("failed");
    expect(result.failure?.message).toMatch(/lead_role_kind_mismatch/);
    const eventsRaw = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "events.jsonl"),
      "utf8",
    );
    expect(eventsRaw).toContain("run_failed");
  });

});
