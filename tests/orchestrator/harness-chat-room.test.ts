import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";
import { FileBackedMailbox } from "@/four-layer/mailbox.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function readJsonLines<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

describe.sequential("harness chat room wiring", () => {
  it("emits a real shared-channel room ref and stores transport metadata in mailbox entries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-harness-chat-room-"));
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
    expect(result.run.coordinationChannel?.locator.startsWith("fake-room:")).toBe(true);
    expect(result.run.coordinationChannel?.locator.startsWith("mailbox:")).toBe(false);

    const events = await readJsonLines<Record<string, unknown>>(join(result.runDir, "events.jsonl"));
    const created = events.find((event) => event["type"] === "coordination_transcript_created");
    expect(created).toBeDefined();
    expect((created?.["payload"] as Record<string, unknown>)?.["roomRef"]).toBe(result.run.coordinationChannel?.locator);

    const mailboxMessages = events.filter((event) => event["type"] === "mailbox_message");
    expect(mailboxMessages.length).toBeGreaterThan(0);
    expect(mailboxMessages.every((event) => typeof (event["payload"] as Record<string, unknown>)?.["transportMessageId"] === "string")).toBe(true);
    expect(events.some((event) => event["type"] === "mailbox_transport_parity_drift")).toBe(false);

    const mirror = await readJsonLines<Record<string, unknown>>(join(result.runDir, "mailbox.jsonl"));
    expect(mirror.length).toBeGreaterThan(0);
    expect(mirror.every((message) => message["transportStatus"] === "ok")).toBe(true);
    expect(mirror.every((message) => typeof message["transportMessageId"] === "string")).toBe(true);
  });

  it("continues the run when transport post fails and records post_failed mirror entries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-harness-post-fail-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    class PostFailingTransport extends FakeMailboxTransport {
      override async post(): Promise<never> {
        throw new Error("synthetic transport post failure");
      }
    }

    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "fake-smoke" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => new FakeAdapter({ team }),
      createMailboxTransport: () => new PostFailingTransport(),
    });

    expect(result.run.status).toBe("succeeded");
    const events = await readJsonLines<Record<string, unknown>>(join(result.runDir, "events.jsonl"));
    expect(events.some((event) => event["type"] === "mailbox_transport_post_failed")).toBe(true);
    const mirror = await readJsonLines<Record<string, unknown>>(join(result.runDir, "mailbox.jsonl"));
    expect(mirror.length).toBeGreaterThan(0);
    expect(mirror.every((message) => message["transportStatus"] === "post_failed")).toBe(true);
  });

  it("fails closed when mirror append fails after transport post", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-harness-mirror-fail-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    const originalAppendToMirror = FileBackedMailbox.prototype.appendToMirror;
    FileBackedMailbox.prototype.appendToMirror = async function failingAppendToMirror() {
      throw new Error("synthetic mirror append failure");
    };

    try {
      const result = await runManagerHarness({
        rootDir: repoRoot,
        selection: { scenario: "hello-team", runProfile: "fake-smoke" },
        workspaceOverride: workspace,
        dataDir,
        createAdapter: ({ team }) => new FakeAdapter({ team }),
      });

      expect(result.run.status).toBe("failed");
      const events = await readJsonLines<Record<string, unknown>>(join(result.runDir, "events.jsonl"));
      const blocker = events.find((event) => event["type"] === "blocker");
      expect((blocker?.["payload"] as Record<string, unknown>)?.["reason"]).toBe("mailbox_mirror_failed");
    } finally {
      FileBackedMailbox.prototype.appendToMirror = originalAppendToMirror;
    }
  });
});
