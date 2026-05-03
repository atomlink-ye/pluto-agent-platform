import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";
import type { PaseoTeamAdapter } from "@/contracts/adapter.js";
import type { AgentEvent, AgentEventType, AgentRoleConfig, AgentSession, TeamConfig, TeamPlaybookV0, TeamTask } from "@/contracts/types.js";
import type { MailboxEnvelope, MailboxMessage, RoomRef, TransportReadResult } from "@/contracts/four-layer.js";
import { startInboxDeliveryLoop } from "@/orchestrator/inbox-delivery-loop.js";

class LoopTestAdapter implements PaseoTeamAdapter {
  readonly sent: Array<{ runId: string; sessionId: string; message: string; wait?: boolean }> = [];
  readonly idleBySession = new Map<string, boolean>();
  readonly rejectedSessions = new Set<string>();

  async startRun(_input: { runId: string; task: TeamTask; team: TeamConfig; playbook?: TeamPlaybookV0 | undefined }): Promise<void> {}
  async createLeadSession(_input: { runId: string; task: TeamTask; role: AgentRoleConfig }): Promise<AgentSession> {
    throw new Error("unused");
  }
  async createWorkerSession(_input: { runId: string; role: AgentRoleConfig; instructions: string }): Promise<AgentSession> {
    throw new Error("unused");
  }
  async sendMessage(_input: { runId: string; sessionId: string; message: string }): Promise<void> {
    throw new Error("unused");
  }
  async sendSessionMessage(input: { runId: string; sessionId: string; message: string; wait?: boolean }): Promise<void> {
    if (this.rejectedSessions.has(input.sessionId)) {
      throw new Error(`send_rejected:${input.sessionId}`);
    }
    this.sent.push({ ...input });
  }
  async sendRoleMessage(_input: { runId: string; roleId: string; message: string; wait?: boolean }): Promise<void> {
    throw new Error("unused");
  }
  async listActiveRoleSessions(_input: { runId: string }): Promise<Record<string, string>> {
    return {};
  }
  async readEvents(_input: { runId: string }): Promise<AgentEvent[]> {
    return [];
  }
  async waitForCompletion(_input: { runId: string; timeoutMs: number }): Promise<AgentEvent[]> {
    return [];
  }
  async endRun(_input: { runId: string }): Promise<void> {}
  async isSessionIdle(input: { runId: string; sessionId: string }): Promise<boolean> {
    void input.runId;
    return this.idleBySession.get(input.sessionId) ?? false;
  }
}

describe("inbox delivery loop", () => {
  it("delivers immediately when the target session is idle", async () => {
    const transport = new FakeMailboxTransport();
    const room = await transport.createRoom({ runId: "run-idle", name: "idle" });
    const adapter = new LoopTestAdapter();
    adapter.idleBySession.set("planner-session", true);
    const events: AgentEvent[] = [];
    const readMessageIds: string[] = [];
    const mailboxMessage = createMailboxMessage({ to: "planner", from: "lead", body: "hello planner" });
    const loop = startInboxDeliveryLoop({
      runId: "run-idle",
      room,
      transport,
      adapter,
      resolveSessionId: (roleId) => roleId === "planner" ? "planner-session" : undefined,
      emit: async (type: AgentEventType, payload = {}, roleId?: string, sessionId?: string) => {
        const event: AgentEvent = {
          id: `${events.length + 1}`,
          runId: "run-idle",
          ts: new Date().toISOString(),
          type,
          ...(roleId ? { roleId: roleId as AgentEvent["roleId"] } : {}),
          ...(sessionId ? { sessionId } : {}),
          payload,
        };
        events.push(event);
        return event;
      },
      markMessageRead: async (message) => {
        readMessageIds.push(message.id);
      },
      waitTimeoutMs: 5,
    });

    await transport.post({
      room,
      envelope: buildEnvelope("run-idle", mailboxMessage),
    });

    await waitFor(() => adapter.sent.length === 1);
    await loop.stop();

    expect(adapter.sent[0]?.sessionId).toBe("planner-session");
    expect(adapter.sent[0]?.message).toBe("hello planner");
    expect(readMessageIds).toEqual([mailboxMessage.id]);
    expect(events.find((event) => event.type === "mailbox_message_delivered")?.roleId).toBe("planner");
    expect(events.find((event) => event.type === "mailbox_message_delivered")?.sessionId).toBe("planner-session");
    expect(events.find((event) => event.type === "mailbox_message_delivered")?.payload["transportMessageId"]).toBeTruthy();
  });

  it("queues a busy target and drains after a later idle check", async () => {
    const transport = new FakeMailboxTransport();
    const room = await transport.createRoom({ runId: "run-queue", name: "queue" });
    const adapter = new LoopTestAdapter();
    adapter.idleBySession.set("planner-session", false);
    const events: AgentEvent[] = [];
    const readMessageIds: string[] = [];
    const mailboxMessage = createMailboxMessage({ to: "planner", from: "lead", body: "queued hello" });
    const loop = startInboxDeliveryLoop({
      runId: "run-queue",
      room,
      transport,
      adapter,
      resolveSessionId: () => "planner-session",
      emit: async (type: AgentEventType, payload = {}, roleId?: string, sessionId?: string) => {
        const event: AgentEvent = {
          id: `${events.length + 1}`,
          runId: "run-queue",
          ts: new Date().toISOString(),
          type,
          ...(roleId ? { roleId: roleId as AgentEvent["roleId"] } : {}),
          ...(sessionId ? { sessionId } : {}),
          payload,
        };
        events.push(event);
        return event;
      },
      markMessageRead: async (message) => {
        readMessageIds.push(message.id);
      },
      waitTimeoutMs: 5,
    });

    await transport.post({
      room,
      envelope: buildEnvelope("run-queue", mailboxMessage),
    });

    await waitFor(() => events.some((event) => event.type === "mailbox_message_queued"));
    expect(adapter.sent).toHaveLength(0);

    adapter.idleBySession.set("planner-session", true);
    await waitFor(() => adapter.sent.length === 1);
    await loop.stop();

    expect(events.map((event) => event.type)).toContain("mailbox_message_queued");
    expect(events.map((event) => event.type)).toContain("mailbox_message_delivered");
    expect(readMessageIds).toEqual([mailboxMessage.id]);
  });

  it("records failed delivery when the target session cannot be resolved", async () => {
    const transport = new FakeMailboxTransport();
    const room = await transport.createRoom({ runId: "run-failed", name: "failed" });
    const adapter = new LoopTestAdapter();
    const events: AgentEvent[] = [];
    const loop = startInboxDeliveryLoop({
      runId: "run-failed",
      room,
      transport,
      adapter,
      resolveSessionId: () => undefined,
      emit: async (type: AgentEventType, payload = {}, roleId?: string, sessionId?: string) => {
        const event: AgentEvent = {
          id: `${events.length + 1}`,
          runId: "run-failed",
          ts: new Date().toISOString(),
          type,
          ...(roleId ? { roleId: roleId as AgentEvent["roleId"] } : {}),
          ...(sessionId ? { sessionId } : {}),
          payload,
        };
        events.push(event);
        return event;
      },
      waitTimeoutMs: 5,
    });

    await transport.post({
      room,
      envelope: buildEnvelope("run-failed", createMailboxMessage({ to: "planner", from: "lead", body: "cannot deliver" })),
    });

    await waitFor(() => events.some((event) => event.type === "mailbox_message_failed"));
    await loop.stop();

    expect(adapter.sent).toHaveLength(0);
    expect(events.find((event) => event.type === "mailbox_message_failed")?.payload["reason"]).toBe("session_not_found");
  });

  it("keeps timing out cleanly when no new transport messages arrive", async () => {
    const transport = new CountingTransport();
    const adapter = new LoopTestAdapter();
    const events: AgentEvent[] = [];
    const loop = startInboxDeliveryLoop({
      runId: "run-timeout",
      room: "counting-room",
      transport,
      adapter,
      resolveSessionId: () => "planner-session",
      emit: async (type: AgentEventType, payload = {}, roleId?: string, sessionId?: string) => {
        const event: AgentEvent = {
          id: `${events.length + 1}`,
          runId: "run-timeout",
          ts: new Date().toISOString(),
          type,
          ...(roleId ? { roleId: roleId as AgentEvent["roleId"] } : {}),
          ...(sessionId ? { sessionId } : {}),
          payload,
        };
        events.push(event);
        return event;
      },
      waitTimeoutMs: 5,
    });

    await waitFor(() => transport.waitCalls > 1);
    await loop.stop();

    expect(transport.waitCalls).toBeGreaterThan(1);
    expect(adapter.sent).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("does a final shutdown pass for a late arrival without queueing", async () => {
    const lateMessage = createMailboxMessage({ to: "planner", from: "lead", body: "late arrival" });
    const transport = new FinalPassPostTransport(() => ({
      room: "shutdown-room",
      envelope: buildEnvelope("run-shutdown", lateMessage),
    }));
    const adapter = new LoopTestAdapter();
    adapter.idleBySession.set("planner-session", true);
    const events: AgentEvent[] = [];
    const loop = startInboxDeliveryLoop({
      runId: "run-shutdown",
      room: "shutdown-room",
      transport,
      adapter,
      resolveSessionId: () => "planner-session",
      emit: async (type: AgentEventType, payload = {}, roleId?: string, sessionId?: string) => {
        const event: AgentEvent = {
          id: `${events.length + 1}`,
          runId: "run-shutdown",
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
    expect(adapter.sent[0]?.message).toBe("late arrival");
    expect(events.some((event) => event.type === "mailbox_message_queued")).toBe(false);
    expect(events.some((event) => event.type === "mailbox_message_delivered")).toBe(true);
    expect(events.some((event) => event.type === "mailbox_message_failed" && event.payload["reason"] === "run_ended")).toBe(false);
  });
});

class CountingTransport extends FakeMailboxTransport {
  waitCalls = 0;

  override async wait(input: { room: RoomRef; timeoutMs: number; since?: Parameters<FakeMailboxTransport["wait"]>[0]["since"] }) {
    this.waitCalls += 1;
    return await super.wait(input);
  }

  override async read(input: { room: RoomRef; since?: Parameters<FakeMailboxTransport["read"]>[0]["since"]; limit?: number; agentId?: string }): Promise<TransportReadResult> {
    return await super.read(input);
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

function createMailboxMessage(input: { to: string; from: string; body: MailboxMessage["body"]; kind?: MailboxMessage["kind"] }): MailboxMessage {
  return {
    id: `${input.from}-${input.to}-${Math.random()}`,
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

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await delay(10);
  }
}
