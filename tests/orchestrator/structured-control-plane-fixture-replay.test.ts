import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { AgentEvent } from "@/contracts/types.js";
import type { MailboxMessage } from "@/contracts/four-layer.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";
import { loadLiveSmokeFixture, readJsonLines } from "../fixtures/live-smoke/_helpers.js";

const repoRoot = process.cwd();
const fixtureRunId = "86557df1-0b4a-4bd4-8a75-027a4dcd5d38";
const liveTypedEnvelopeFixtureRunId = "625a9557-69f0-47bb-bda0-355535112aa9";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("structured control-plane fixture replay", () => {
  it("replays the fenced-json evaluator verdict fixture through the harness", async () => {
    const fixture = await loadLiveSmokeFixture<AgentEvent, MailboxMessage>(fixtureRunId);
    const fixtureEvents = fixture.events;
    const fixtureMailbox = fixture.mailboxEntries;
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

  it("replays the live typed-envelope evaluator verdict fixture through the harness", async () => {
    const fixture = await loadLiveSmokeFixture<AgentEvent, MailboxMessage>(liveTypedEnvelopeFixtureRunId);
    const evaluatorOutput = fixture.events.find((event) =>
      event.type === "worker_completed" && event.roleId === "evaluator",
    )?.payload["output"];

    expect(typeof evaluatorOutput).toBe("string");
    expect((evaluatorOutput as string).includes("evaluator_verdict")).toBe(true);
    expect(fixture.events.some((event) => event.type === "evaluator_verdict_received")).toBe(false);

    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const workspace = await mkdtemp(join(tmpdir(), "pluto-live-typed-envelope-replay-"));
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
