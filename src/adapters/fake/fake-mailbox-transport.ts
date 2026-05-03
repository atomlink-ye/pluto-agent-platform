import { randomUUID } from "node:crypto";

import type {
  MailboxEnvelope,
  ReceivedTransportMessage,
  RoomRef,
  TransportMessageRef,
  TransportReadResult,
  TransportWaitResult,
  TransportSince,
} from "../../contracts/four-layer.js";

const REJECTION_REASON_JSON_PARSE = "json_parse" as const;
const REJECTION_REASON_SCHEMA_VERSION = "schema_version" as const;

interface StoredFakeTransportMessage {
  transportMessageId: string;
  transportTimestamp: string;
  wireMessage: string;
  replyTo?: string;
  agentId?: string;
}

interface PendingFakeTransportWait {
  since?: TransportSince;
  timeout?: ReturnType<typeof setTimeout>;
  resolve: (result: TransportWaitResult) => void;
}

export interface FakeMailboxTransportOptions {
  clock?: () => Date;
  idGen?: () => string;
}

export interface FakeMailboxEnvelopeRejection {
  reason: typeof REJECTION_REASON_JSON_PARSE | typeof REJECTION_REASON_SCHEMA_VERSION;
  transportMessageId?: string;
  transportTimestamp?: string;
  detail?: string;
}

export class FakeMailboxTransport {
  private readonly clock: () => Date;
  private readonly idGen: () => string;
  private readonly roomRefsByKey = new Map<string, RoomRef>();
  private readonly roomMessages = new Map<RoomRef, StoredFakeTransportMessage[]>();
  private readonly pendingWaits = new Map<RoomRef, PendingFakeTransportWait[]>();
  private readonly rejections: FakeMailboxEnvelopeRejection[] = [];

  constructor(options: FakeMailboxTransportOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  async createRoom(input: { runId: string; name: string; purpose?: string }): Promise<RoomRef> {
    void input.purpose;
    const key = `${input.runId}:${input.name}`;
    const existing = this.roomRefsByKey.get(key);
    if (existing) {
      return existing;
    }
    const roomRef = `fake-room:${key}`;
    this.roomRefsByKey.set(key, roomRef);
    this.roomMessages.set(roomRef, []);
    return roomRef;
  }

  async post(input: { room: RoomRef; envelope: MailboxEnvelope; replyTo?: string }): Promise<TransportMessageRef> {
    const ref = {
      transportMessageId: this.idGen(),
      transportTimestamp: this.clock().toISOString(),
      roomRef: input.room,
    };
    const stored: StoredFakeTransportMessage = {
      transportMessageId: ref.transportMessageId,
      transportTimestamp: ref.transportTimestamp,
      wireMessage: JSON.stringify(input.envelope),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      agentId: input.envelope.fromRole,
    };
    this.messagesForRoom(input.room).push(stored);
    await this.flushWaits(input.room);
    return ref;
  }

  async read(input: { room: RoomRef; since?: TransportSince; limit?: number; agentId?: string }): Promise<TransportReadResult> {
    this.rejections.splice(0);
    const seen = new Set<string>();
    const messages: ReceivedTransportMessage[] = [];
    let latestTimestamp: string | null = null;

    for (const stored of this.messagesForRoom(input.room)) {
      if (!matchesSince(stored.transportTimestamp, input.since, this.clock)) {
        continue;
      }
      if (input.agentId && stored.agentId !== input.agentId) {
        continue;
      }
      if (seen.has(stored.transportMessageId)) {
        continue;
      }
      seen.add(stored.transportMessageId);

      const envelope = this.tryParseEnvelope(stored);
      if (!envelope) {
        latestTimestamp = stored.transportTimestamp;
        continue;
      }
      messages.push({
        transportMessageId: stored.transportMessageId,
        transportTimestamp: stored.transportTimestamp,
        envelope,
        ...(stored.replyTo ? { replyTo: stored.replyTo } : {}),
      });
      latestTimestamp = stored.transportTimestamp;

      if (input.limit && messages.length >= input.limit) {
        break;
      }
    }

    return { messages, latestTimestamp };
  }

  async wait(input: { room: RoomRef; since?: TransportSince; timeoutMs: number }): Promise<TransportWaitResult> {
    const immediate = await this.read({ room: input.room, since: input.since });
    if (hasWaitResultPayload(immediate)) {
      return { ...immediate, timedOut: false };
    }
    if (input.timeoutMs === 0) {
      return { ...immediate, timedOut: true };
    }

    return await new Promise<TransportWaitResult>((resolve) => {
      const wait: PendingFakeTransportWait = {
        since: input.since,
        resolve: (result) => {
          if (wait.timeout) {
            clearTimeout(wait.timeout);
          }
          this.removePendingWait(input.room, wait);
          resolve(result);
        },
      };
      wait.timeout = setTimeout(() => {
        wait.resolve({ messages: [], latestTimestamp: null, timedOut: true });
      }, input.timeoutMs);
      this.pendingWaitsForRoom(input.room).push(wait);
      void this.flushWaits(input.room);
    });
  }

  appendRawMessage(input: {
    room: RoomRef;
    wireMessage: string;
    transportMessageId?: string;
    transportTimestamp?: string;
    replyTo?: string;
    agentId?: string;
  }): void {
    this.messagesForRoom(input.room).push({
      transportMessageId: input.transportMessageId ?? this.idGen(),
      transportTimestamp: input.transportTimestamp ?? this.clock().toISOString(),
      wireMessage: input.wireMessage,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
    void this.flushWaits(input.room);
  }

  drainEnvelopeRejections(): FakeMailboxEnvelopeRejection[] {
    return this.rejections.splice(0);
  }

  private messagesForRoom(room: RoomRef): StoredFakeTransportMessage[] {
    const existing = this.roomMessages.get(room);
    if (existing) {
      return existing;
    }
    const created: StoredFakeTransportMessage[] = [];
    this.roomMessages.set(room, created);
    return created;
  }

  private pendingWaitsForRoom(room: RoomRef): PendingFakeTransportWait[] {
    const existing = this.pendingWaits.get(room);
    if (existing) {
      return existing;
    }
    const created: PendingFakeTransportWait[] = [];
    this.pendingWaits.set(room, created);
    return created;
  }

  private removePendingWait(room: RoomRef, wait: PendingFakeTransportWait): void {
    const waits = this.pendingWaits.get(room);
    if (!waits) {
      return;
    }
    const index = waits.indexOf(wait);
    if (index >= 0) {
      waits.splice(index, 1);
    }
    if (waits.length === 0) {
      this.pendingWaits.delete(room);
    }
  }

  private async flushWaits(room: RoomRef): Promise<void> {
    const waits = [...(this.pendingWaits.get(room) ?? [])];
    for (const wait of waits) {
      const read = await this.read({ room, since: wait.since });
      if (!hasWaitResultPayload(read)) {
        continue;
      }
      wait.resolve({ ...read, timedOut: false });
    }
  }

  private tryParseEnvelope(stored: StoredFakeTransportMessage): MailboxEnvelope | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.wireMessage);
    } catch (error) {
      this.rejections.push({
        reason: REJECTION_REASON_JSON_PARSE,
        transportMessageId: stored.transportMessageId,
        transportTimestamp: stored.transportTimestamp,
        detail: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (!isMailboxEnvelope(parsed)) {
      this.rejections.push({
        reason: REJECTION_REASON_SCHEMA_VERSION,
        transportMessageId: stored.transportMessageId,
        transportTimestamp: stored.transportTimestamp,
        detail: typeof parsed === "object" && parsed !== null ? JSON.stringify(parsed) : String(parsed),
      });
      return null;
    }

    return parsed;
  }
}

function hasWaitResultPayload(result: TransportReadResult): boolean {
  return result.messages.length > 0 || result.latestTimestamp !== null;
}

function matchesSince(
  transportTimestamp: string,
  since: TransportSince | undefined,
  clock: () => Date,
): boolean {
  if (!since) {
    return true;
  }
  if (since.kind === "timestamp") {
    return transportTimestamp >= since.value;
  }
  const durationMs = parseDurationMs(since.value);
  if (durationMs === null) {
    return true;
  }
  return Date.parse(transportTimestamp) >= clock().getTime() - durationMs;
}

function parseDurationMs(value: string): number | null {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    default:
      return null;
  }
}

function isMailboxEnvelope(value: unknown): value is MailboxEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record["schemaVersion"] === "v1"
    && typeof record["fromRole"] === "string"
    && typeof record["toRole"] === "string"
    && typeof record["runId"] === "string"
    && typeof record["body"] === "object"
    && record["body"] !== null;
}
