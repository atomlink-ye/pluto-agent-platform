import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { EvidencePacket } from "@/contracts/four-layer.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("task list external write audit", () => {
  it("records a task list audit event in the evidence packet without aborting the run", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-tasklist-audit-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);
    let mutated = false;

    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "fake-smoke" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => new FakeAdapter({ team }),
      onPhase: async (phase, details) => {
        if (phase !== "before_hook_boundary" || details["hookBoundary"] !== "run_end" || mutated) return;
        mutated = true;
        const taskListPath = String(details["taskListPath"]);
        const state = JSON.parse(await readFile(taskListPath, "utf8")) as {
          nextId: number;
          tasks: Array<Record<string, unknown>>;
        };
        state.tasks[0] = {
          ...state.tasks[0],
          summary: `${String(state.tasks[0]?.["summary"] ?? "task")} (externally edited)`,
        };
        await writeFile(taskListPath, JSON.stringify(state, null, 2) + "\n\n", "utf8");
      },
    });

    expect(result.run.status).toBe("succeeded");
    const packet = JSON.parse(await readFile(result.canonicalEvidencePath, "utf8")) as EvidencePacket;
    expect(packet.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tasklist_external_write_detected", hookBoundary: "run_end" }),
    ]));
  });
});
