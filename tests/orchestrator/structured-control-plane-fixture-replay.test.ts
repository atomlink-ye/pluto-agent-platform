import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { AgentEvent } from "@/contracts/types.js";
import type { MailboxMessage } from "@/contracts/four-layer.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const fixtureRunId = "86557df1-0b4a-4bd4-8a75-027a4dcd5d38";
const fixtureDir = join(repoRoot, "tests", "fixtures", "live-smoke", fixtureRunId);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("structured control-plane fixture replay", () => {
  it("replays the fenced-json evaluator verdict fixture through the harness", async () => {
    const fixtureEvents = await readJsonLines<AgentEvent>(join(fixtureDir, "events.jsonl"));
    const fixtureMailbox = await readJsonLines<MailboxMessage>(join(fixtureDir, "mailbox.jsonl"));
    const evaluatorOutput = fixtureEvents.find((event) =>
      event.type === "worker_completed" && event.roleId === "evaluator",
    )?.payload["output"];

    expect(typeof evaluatorOutput).toBe("string");
    expect((evaluatorOutput as string).includes("```json")).toBe(true);
    expect(fixtureMailbox.some((message) => message.kind === "evaluator_verdict")).toBe(false);

    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const workspace = await mkdtemp(join(tmpdir(), "pluto-live-fixture-replay-"));
      const dataDir = join(workspace, ".pluto");
      tempDirs.push(workspace);

      const result = await runManagerHarness({
        rootDir: repoRoot,
        selection: { scenario: "hello-team", runProfile: "fake-smoke" },
        workspaceOverride: workspace,
        dataDir,
        createAdapter: ({ team }) => new FakeAdapter({
          team,
          workerOutputs: {
            evaluator: evaluatorOutput as string,
          },
        }),
      });

      expect(result.run.status).toBe("succeeded");

      const replayEvents = await readJsonLines<AgentEvent>(join(result.runDir, "events.jsonl"));
      const replayMailbox = await readJsonLines<MailboxMessage>(join(result.runDir, "mailbox.jsonl"));
      expect(replayEvents.some((event) =>
        event.type === "evaluator_verdict_received"
        && event.payload["taskId"] === "task-3"
        && event.payload["verdict"] === "pass",
      )).toBe(true);
      expect(replayMailbox.some((message) => message.kind === "evaluator_verdict")).toBe(true);
    });
  });
});

async function readJsonLines<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

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
