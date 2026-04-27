import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import type { TeamTask } from "@/contracts/types.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-mvp-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const buildTask = (id: string): TeamTask => ({
  id,
  title: `Hello team ${id}`,
  prompt: "Produce a hello-team markdown artifact.",
  workspacePath: workDir,
  minWorkers: 2,
});

describe("TeamRunService with FakeAdapter (E2E)", () => {
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

    const result = await service.run(buildTask("t-e2e-1"));

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
    expect(eventTypes).toContain("lead_started");
    expect(eventTypes.filter((t) => t === "worker_started").length).toBeGreaterThanOrEqual(2);
    expect(eventTypes.filter((t) => t === "worker_completed").length).toBeGreaterThanOrEqual(2);
    expect(eventTypes).toContain("lead_message");
    expect(eventTypes).toContain("artifact_created");
    expect(eventTypes[eventTypes.length - 1]).toBe("run_completed");

    // artifact.md exists and references each contributing role.
    const artifactMd = await readFile(
      join(workDir, ".pluto", "runs", result.runId, "artifact.md"),
      "utf8",
    );
    expect(artifactMd).toContain("planner");
    expect(artifactMd).toContain("generator");
    expect(artifactMd).toContain("evaluator");
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
