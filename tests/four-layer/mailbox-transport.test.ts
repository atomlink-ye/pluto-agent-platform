import { describe, expect, it } from "vitest";

import type { MailboxEnvelope } from "@/contracts/four-layer.js";
import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";

function makeEnvelope(id: string, createdAt: string): MailboxEnvelope {
  return {
    schemaVersion: "v1",
    fromRole: "planner",
    toRole: "lead",
    runId: "run-1",
    taskId: "task-1",
    body: {
      id,
      to: "lead",
      from: "planner",
      createdAt,
      kind: "text",
      body: `message ${id}`,
    },
  };
}

describe("FakeMailboxTransport", () => {
  it("creates rooms idempotently", async () => {
    const transport = new FakeMailboxTransport();
    const first = await transport.createRoom({ runId: "run-1", name: "mailbox" });
    const second = await transport.createRoom({ runId: "run-1", name: "mailbox" });
    expect(second).toBe(first);
  });

  it("posts messages, advances timestamp cursors, and dedupes duplicate wire ids", async () => {
    const timestamps = [
      new Date("2026-05-02T00:00:00.000Z"),
      new Date("2026-05-02T00:00:01.000Z"),
    ];
    const transport = new FakeMailboxTransport({
      clock: () => timestamps[Math.min(timestamps.length - 1, cursor++)]!,
      idGen: () => `msg-${++idCounter}`,
    });
    let cursor = 0;
    let idCounter = 0;
    const room = await transport.createRoom({ runId: "run-1", name: "mailbox" });

    const first = await transport.post({ room, envelope: makeEnvelope("m1", timestamps[0]!.toISOString()) });
    const second = await transport.post({ room, envelope: makeEnvelope("m2", timestamps[1]!.toISOString()) });
    transport.appendRawMessage({
      room,
      transportMessageId: second.transportMessageId,
      transportTimestamp: second.transportTimestamp,
      wireMessage: JSON.stringify(makeEnvelope("m2-dup", timestamps[1]!.toISOString())),
      agentId: "planner",
    });

    const read = await transport.read({ room, since: { kind: "timestamp", value: first.transportTimestamp } });
    expect(read.messages.map((message) => message.transportMessageId)).toEqual([
      first.transportMessageId,
      second.transportMessageId,
    ]);
    expect(read.latestTimestamp).toBe(second.transportTimestamp);
  });

  it("rejects invalid json envelopes without failing the read", async () => {
    const transport = new FakeMailboxTransport();
    const room = await transport.createRoom({ runId: "run-1", name: "mailbox" });
    transport.appendRawMessage({
      room,
      transportMessageId: "bad-json",
      transportTimestamp: "2026-05-02T00:00:00.000Z",
      wireMessage: "{not-json",
      agentId: "planner",
    });

    const read = await transport.read({ room });
    expect(read.messages).toEqual([]);
    expect(transport.drainEnvelopeRejections()).toEqual([
      expect.objectContaining({ reason: "json_parse", transportMessageId: "bad-json" }),
    ]);
  });

  it("rejects schemaVersion mismatches without failing the read", async () => {
    const transport = new FakeMailboxTransport();
    const room = await transport.createRoom({ runId: "run-1", name: "mailbox" });
    transport.appendRawMessage({
      room,
      transportMessageId: "bad-schema",
      transportTimestamp: "2026-05-02T00:00:00.000Z",
      wireMessage: JSON.stringify({ ...makeEnvelope("m1", "2026-05-02T00:00:00.000Z"), schemaVersion: "v0" }),
      agentId: "planner",
    });

    const read = await transport.read({ room });
    expect(read.messages).toEqual([]);
    expect(transport.drainEnvelopeRejections()).toEqual([
      expect.objectContaining({ reason: "schema_version", transportMessageId: "bad-schema" }),
    ]);
  });
});
