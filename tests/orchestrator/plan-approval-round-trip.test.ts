import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";
import { FakeAdapter } from "@/adapters/fake/index.js";
import type { PaseoTeamAdapter } from "@/contracts/adapter.js";
import type { AgentEvent, AgentEventType, AgentRoleConfig, AgentSession, TeamConfig, TeamPlaybookV0, TeamTask } from "@/contracts/types.js";
import type { MailboxEnvelope, MailboxMessage, RoomRef } from "@/contracts/four-layer.js";
import { startInboxDeliveryLoop } from "@/orchestrator/inbox-delivery-loop.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("plan approval round trip", () => {
  it("flows through transport plus the inbox delivery loop and leaves delivery evidence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-plan-approval-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);

    let adapter: FakeAdapter | undefined;
    const transport = new FakeMailboxTransport({
      clock: () => new Date("2026-05-02T19:24:25.925Z"),
    });
    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "fake-smoke" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => {
        adapter = new FakeAdapter({ team });
        return adapter;
      },
      createMailboxTransport: () => transport,
    });

    expect(result.run.status).toBe("succeeded");

    const mailboxMessages = (await readFile(join(result.runDir, "mailbox.jsonl"), "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as MailboxMessage);
    const requestMessage = mailboxMessages.find((message) => message.kind === "plan_approval_request");
    const responseMessage = mailboxMessages.find((message) => message.kind === "plan_approval_response");
    expect(requestMessage?.transportMessageId).toBeTruthy();
    expect(responseMessage?.transportMessageId).toBeTruthy();
    expect(requestMessage?.deliveryStatus).toBe("pending");
    expect(responseMessage?.deliveryStatus).toBe("pending");

    const events = (await readFile(join(result.runDir, "events.jsonl"), "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AgentEvent);
    expect(events.some((event) => event.type === "plan_approval_requested")).toBe(true);
    expect(events.some((event) => event.type === "plan_approval_responded")).toBe(true);
    expect(events.some((event) =>
      event.type === "mailbox_message_delivered"
      && event.payload["transportMessageId"] === requestMessage?.transportMessageId,
    )).toBe(true);
    expect(events.some((event) =>
      event.type === "mailbox_message_delivered"
      && event.payload["transportMessageId"] === responseMessage?.transportMessageId,
    )).toBe(true);

    const sentMessages = adapter?.getSentMessages() ?? [];
    expect(sentMessages.some((message) =>
      message.via === "session" && message.sessionId.startsWith("fake-lead-") && message.message.includes("plan_approval_request"),
    )).toBe(true);
    expect(sentMessages.some((message) =>
      message.via === "session" && message.sessionId.startsWith("fake-worker-planner-") && message.message.includes("plan_approval_response"),
    )).toBe(true);
  });

  it("delivers a late plan approval response during the shutdown final pass", async () => {
    const responseMessage = createMailboxMessage({
      id: "late-plan-response",
      to: "planner",
      from: "lead",
      kind: "plan_approval_response",
      body: { approved: true, mode: "workspace_write", taskId: "task-1" },
    });
    const transport = new FinalPassPostTransport(() => ({
      room: "plan-room",
      envelope: buildEnvelope("run-plan-late", responseMessage),
    }));
    const adapter = new LoopRoundTripAdapter();
    adapter.idleBySession.set("planner-session", true);
    const events: AgentEvent[] = [];
    const loop = startInboxDeliveryLoop({
      runId: "run-plan-late",
      room: "plan-room",
      transport,
      adapter,
      resolveSessionId: (roleId) => roleId === "planner" ? "planner-session" : undefined,
      emit: async (type: AgentEventType, payload = {}, roleId?: string, sessionId?: string) => {
        const event: AgentEvent = {
          id: `${events.length + 1}`,
          runId: "run-plan-late",
          ts: new Date().toISOString(),
          type,
          ...(roleId ? { roleId: roleId as AgentEvent["roleId"] } : {}),
          ...(sessionId ? { sessionId } : {}),
          payload,
        };
        events.push(event);
        return event;
      },
      waitTimeoutMs: 50,
    });

    await loop.stop();

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]?.sessionId).toBe("planner-session");
    expect(adapter.sent[0]?.message).toContain("plan_approval_response");
    expect(events.some((event) => event.type === "mailbox_message_delivered")).toBe(true);
    expect(events.some((event) => event.type === "mailbox_message_failed" && event.payload["reason"] === "run_ended")).toBe(false);
  });
});

class LoopRoundTripAdapter implements PaseoTeamAdapter {
  readonly sent: Array<{ runId: string; sessionId: string; message: string; wait?: boolean }> = [];
  readonly idleBySession = new Map<string, boolean>();

  async startRun(_input: { runId: string; task: TeamTask; team: TeamConfig; playbook?: TeamPlaybookV0 | undefined }): Promise<void> {}
  async createLeadSession(_input: { runId: string; task: TeamTask; role: AgentRoleConfig }): Promise<AgentSession> { throw new Error("unused"); }
  async createWorkerSession(_input: { runId: string; role: AgentRoleConfig; instructions: string }): Promise<AgentSession> { throw new Error("unused"); }
  async sendMessage(_input: { runId: string; sessionId: string; message: string }): Promise<void> { throw new Error("unused"); }
  async sendSessionMessage(input: { runId: string; sessionId: string; message: string; wait?: boolean }): Promise<void> { this.sent.push({ ...input }); }
  async sendRoleMessage(_input: { runId: string; roleId: string; message: string; wait?: boolean }): Promise<void> { throw new Error("unused"); }
  async readEvents(_input: { runId: string }): Promise<AgentEvent[]> { return []; }
  async waitForCompletion(_input: { runId: string; timeoutMs: number }): Promise<AgentEvent[]> { return []; }
  async endRun(_input: { runId: string }): Promise<void> {}
  async isSessionIdle(input: { runId: string; sessionId: string }): Promise<boolean> {
    void input.runId;
    return this.idleBySession.get(input.sessionId) ?? false;
  }
}

class FinalPassPostTransport extends FakeMailboxTransport {
  private fired = false;

  constructor(private readonly buildLatePost: () => Parameters<FakeMailboxTransport["post"]>[0]) {
    super();
  }

  override async wait(input: { room: RoomRef; timeoutMs: number; since?: Parameters<FakeMailboxTransport["wait"]>[0]["since"] }) {
    if (input.timeoutMs === 0 && !this.fired) {
      this.fired = true;
      await this.post(this.buildLatePost());
    }
    return await super.wait(input);
  }
}

function createMailboxMessage(input: {
  id: string;
  to: string;
  from: string;
  body: MailboxMessage["body"];
  kind?: MailboxMessage["kind"];
}): MailboxMessage {
  return {
    id: input.id,
    to: input.to,
    from: input.from,
    createdAt: new Date().toISOString(),
    kind: input.kind ?? "text",
    body: input.body,
  };
}

function buildEnvelope(runId: string, body: MailboxMessage): MailboxEnvelope {
  return {
    schemaVersion: "v1",
    fromRole: body.from,
    toRole: body.to,
    runId,
    body,
  };
}
