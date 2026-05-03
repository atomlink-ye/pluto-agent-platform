import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { AgentEvent } from "@/contracts/types.js";
import type { TaskRecord } from "@/contracts/four-layer.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";
import { readJsonFile, readJsonLines } from "../fixtures/live-smoke/_helpers.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.sequential("custom playbook smoke", () => {
  it("runs the chat-driven path with architect/coder/qa instead of planner/generator/evaluator", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const workspace = await mkdtemp(join(tmpdir(), "pluto-custom-playbook-"));
      const dataDir = join(workspace, ".pluto");
      tempDirs.push(workspace);

      const result = await runManagerHarness({
        rootDir: repoRoot,
        selection: {
          scenario: "hello-team",
          runProfile: "fake-smoke",
          playbook: "architect-coder-qa",
          runtimeTask: "Produce a markdown file that says hello from the lead, architect, coder, and qa.",
        },
        workspaceOverride: workspace,
        dataDir,
        createAdapter: ({ team }) => new FakeAdapter({ team }),
      });

      const tasks = await readJsonFile<{ tasks?: TaskRecord[] }>(join(result.runDir, "tasks.json"));
      const events = await readJsonLines<AgentEvent>(join(result.runDir, "events.jsonl"));
      const workerRoles = ["architect", "coder", "qa"];

      expect(result.run.status).toBe("succeeded");
      expect(tasks.tasks?.map((task) => task.assigneeId)).toEqual(workerRoles);
      expect(result.legacyResult.artifact?.contributions.map((contribution) => contribution.roleId)).toEqual(workerRoles);

      for (const roleId of workerRoles) {
        expect(events.some((event) =>
          event.type === "spawn_request_executed"
          && event.payload["targetRole"] === roleId,
        )).toBe(true);
      }
      expect(events.some((event) => event.type === "spawn_request_executed" && event.payload["targetRole"] === "planner")).toBe(false);
      expect(events.some((event) => event.type === "spawn_request_executed" && event.payload["targetRole"] === "generator")).toBe(false);
      expect(events.some((event) => event.type === "spawn_request_executed" && event.payload["targetRole"] === "evaluator")).toBe(false);
    });
  });
});

async function withEnv<T>(entries: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(entries)) {
    original.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
