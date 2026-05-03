import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PaseoOpenCodeAdapter } from "@/adapters/paseo-opencode/index.js";
import { PaseoChatTransport, PaseoChatUnavailableError } from "@/adapters/paseo-opencode/paseo-chat-transport.js";
import type { ProcessRunner } from "@/adapters/paseo-opencode/process-runner.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("PaseoChatTransport capability probing", () => {
  it("returns a structured chat_transport_unavailable blocker when help probing fails", async () => {
    const runner: ProcessRunner = {
      async exec() {
        return { stdout: "", stderr: "missing paseo", exitCode: 127 };
      },
      follow() {
        return { dispose: async () => undefined };
      },
    };

    const transport = new PaseoChatTransport({ paseoBin: "paseo", runner });
    await expect(transport.probeCapabilities()).rejects.toBeInstanceOf(PaseoChatUnavailableError);
    await transport.probeCapabilities().catch((error: unknown) => {
      const typed = error as PaseoChatUnavailableError;
      expect(typed.toBlockerPayload()).toEqual({
        reason: "chat_transport_unavailable",
        message: "paseo chat create --help failed (exit 127)",
        detail: {
          command: "paseo chat create --help",
          paseoBin: "paseo",
          stderrTail: "missing paseo",
        },
      });
    });
  });

  it("fails the harness with chat_transport_unavailable before adapter startup when paseo chat is missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-paseo-chat-missing-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    const previousBin = process.env["PASEO_BIN"];
    process.env["PASEO_BIN"] = "/definitely/missing/paseo";
    try {
      const result = await runManagerHarness({
        rootDir: repoRoot,
        selection: { scenario: "hello-team", runProfile: "fake-smoke" },
        workspaceOverride: workspace,
        dataDir,
        createAdapter: ({ workspaceCwd }) => new PaseoOpenCodeAdapter({ workspaceCwd, deleteAgentsOnEnd: false }),
      });

      expect(result.run.status).toBe("failed");
      expect(result.legacyResult.blockerReason).toBe("chat_transport_unavailable");
      const eventsRaw = await readFile(join(result.runDir, "events.jsonl"), "utf8");
      const events = eventsRaw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      const blocker = events.find((event) => event["type"] === "blocker");
      expect((blocker?.["payload"] as Record<string, unknown>)?.["reason"]).toBe("chat_transport_unavailable");
    } finally {
      if (previousBin === undefined) {
        delete process.env["PASEO_BIN"];
      } else {
        process.env["PASEO_BIN"] = previousBin;
      }
    }
  });

  it("reads live chat payloads that serialize the envelope in the body field", async () => {
    const runner: ProcessRunner = {
      async exec(_cmd, args) {
        if (args[0] === "chat" && args[1] === "read") {
          return {
            stdout: JSON.stringify([
              {
                id: "transport-1",
                createdAt: "2026-05-02T00:00:00.000Z",
                replyTo: "-",
                body: JSON.stringify({
                  schemaVersion: "v1",
                  fromRole: "planner",
                  toRole: "lead",
                  runId: "run-1",
                  body: {
                    id: "local-1",
                    to: "lead",
                    from: "planner",
                    createdAt: "2026-05-02T00:00:00.000Z",
                    kind: "text",
                    body: "hello",
                  },
                }),
              },
            ]),
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "{}", stderr: "", exitCode: 0 };
      },
      follow() {
        return { dispose: async () => undefined };
      },
    };

    const transport = new PaseoChatTransport({ paseoBin: "paseo", runner });
    const read = await transport.read({ room: "room-1" });
    expect(read.messages).toEqual([
      expect.objectContaining({
        transportMessageId: "transport-1",
        transportTimestamp: "2026-05-02T00:00:00.000Z",
        envelope: expect.objectContaining({ runId: "run-1" }),
      }),
    ]);
  });

  it("treats chat read timeouts as an empty poll result", async () => {
    const runner: ProcessRunner = {
      async exec(_cmd, args) {
        if (args[0] === "chat" && args[1] === "read") {
          return {
            stdout: "",
            stderr: "CHAT_READ_FAILED: Timeout waiting for message (10000ms)",
            exitCode: 1,
          };
        }
        return { stdout: "{}", stderr: "", exitCode: 0 };
      },
      follow() {
        return { dispose: async () => undefined };
      },
    };

    const transport = new PaseoChatTransport({ paseoBin: "paseo", runner });
    await expect(transport.read({ room: "room-1" })).resolves.toEqual({ messages: [], latestTimestamp: null });
  });

  it("recovers a posted message by reading the room when chat post times out after delivery", async () => {
    const envelope = {
      schemaVersion: "v1",
      fromRole: "planner",
      toRole: "lead",
      runId: "run-1",
      body: {
        id: "local-1",
        to: "lead",
        from: "planner",
        createdAt: "2026-05-02T00:00:00.000Z",
        kind: "text",
        body: "hello",
      },
    } as const;
    const runner: ProcessRunner = {
      async exec(_cmd, args) {
        if (args[0] === "chat" && args[1] === "post") {
          return {
            stdout: "",
            stderr: "CHAT_POST_FAILED: Timeout waiting for message (10000ms)",
            exitCode: 1,
          };
        }
        if (args[0] === "chat" && args[1] === "read") {
          return {
            stdout: JSON.stringify([
              {
                id: "transport-2",
                createdAt: "2026-05-02T00:00:01.000Z",
                replyTo: "transport-1",
                body: JSON.stringify(envelope),
              },
            ]),
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "{}", stderr: "", exitCode: 0 };
      },
      follow() {
        return { dispose: async () => undefined };
      },
    };

    const transport = new PaseoChatTransport({ paseoBin: "paseo", runner });
    await expect(transport.post({ room: "room-1", envelope, replyTo: "transport-1" })).resolves.toEqual({
      transportMessageId: "transport-2",
      transportTimestamp: "2026-05-02T00:00:01.000Z",
      roomRef: "room-1",
    });
  });
});
