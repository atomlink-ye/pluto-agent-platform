import { setTimeout as delay } from "node:timers/promises";

import type { PaseoTeamAdapter } from "../contracts/adapter.js";
import type { AgentEvent, AgentEventType } from "../contracts/types.js";
import type {
  DispatchOrchestrationSource,
  MailboxMessage,
  ReceivedTransportMessage,
  RoomRef,
  TransportSince,
} from "../contracts/four-layer.js";
import type { MailboxTransport } from "../four-layer/mailbox-transport.js";

const DEFAULT_WAIT_TIMEOUT_MS = 100;
const MAX_NO_PROGRESS_BACKOFF_ROUNDS = 5;
const MAX_NO_PROGRESS_BACKOFF_TOTAL_MS = 500;
const MAX_SHUTDOWN_DRAIN_PASSES_WITHOUT_PROGRESS = 3;

export interface InboxDeliveryLoopOptions {
  runId: string;
  room: RoomRef;
  transport: MailboxTransport;
  adapter: PaseoTeamAdapter;
  resolveSessionId: (roleId: string) => string | undefined;
  emit: (
    type: AgentEventType,
    payload?: Record<string, unknown>,
    roleId?: string,
    sessionId?: string,
  ) => Promise<AgentEvent>;
  clock?: () => Date;
  waitTimeoutMs?: number;
  onDelivered?: (input: {
    message: MailboxMessage;
    transportMessageId: string;
    roleId: string;
    sessionId: string;
  }) => Promise<void> | void;
  interceptDelivery?: (input: {
    message: MailboxMessage;
    transportMessageId: string;
    roleId: string;
    sessionId: string;
    attemptedAt: string;
  }) => Promise<boolean | Record<string, unknown>>;
  resolveOrchestrationSource?: (message: MailboxMessage) => DispatchOrchestrationSource | undefined;
  markMessageRead?: (message: MailboxMessage) => Promise<void> | void;
}

export interface InboxDeliveryLoopHandle {
  stop(): Promise<void>;
}

export function startInboxDeliveryLoop(options: InboxDeliveryLoopOptions): InboxDeliveryLoopHandle {
  const clock = options.clock ?? (() => new Date());
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const queuedBySession = new Map<string, ReceivedTransportMessage[]>();
  const seenTransportMessageIds = new Set<string>();
  const readMarkedTransportMessageIds = new Set<string>();
  let stopped = false;
  let stopping = false;
  let since: TransportSince | undefined;
  let noProgressRounds = 0;
  let noProgressStartedAtMs: number | null = null;

  const loopPromise = (async () => {
    while (!stopped) {
      const waitResult = await options.transport.wait({
        room: options.room,
        since,
        timeoutMs: waitTimeoutMs,
      });
      if (waitResult.latestTimestamp) {
        since = { kind: "timestamp", value: waitResult.latestTimestamp };
      }

      let madeProgress = false;
      for (const received of waitResult.messages) {
        if (seenTransportMessageIds.has(received.transportMessageId)) {
          continue;
        }
        seenTransportMessageIds.add(received.transportMessageId);
        madeProgress = true;
        await processReceivedMessage(received);
      }

      if (queuedBySession.size > 0) {
        madeProgress = (await drainQueuedMessages()) || madeProgress;
      }

      if (!madeProgress && waitResult.messages.length > 0 && !waitResult.timedOut && !stopping) {
        noProgressRounds += 1;
        noProgressStartedAtMs ??= clock().getTime();
        const noProgressElapsedMs = clock().getTime() - noProgressStartedAtMs;
        if (
          noProgressRounds <= MAX_NO_PROGRESS_BACKOFF_ROUNDS
          && noProgressElapsedMs <= MAX_NO_PROGRESS_BACKOFF_TOTAL_MS
        ) {
          await delay(waitTimeoutMs);
        }
      } else {
        noProgressRounds = 0;
        noProgressStartedAtMs = null;
      }
    }
  })().finally(async () => {
    const attemptedAt = clock().toISOString();
    for (const [sessionId, queued] of queuedBySession.entries()) {
      for (const received of queued) {
        const roleId = normalizeTargetRole(received.envelope.toRole);
        if (!roleId) continue;
        await options.emit(
          "mailbox_message_failed",
          {
            transportMessageId: received.transportMessageId,
            sessionId,
            roleId,
            attemptedAt,
            reason: "run_ended",
          },
          roleId,
          sessionId,
        );
      }
    }
    queuedBySession.clear();
  });

  return {
    async stop() {
      stopping = true;
      await flushShutdownPass();
      stopped = true;
      await loopPromise;
    },
  };

  async function markMessageRead(received: ReceivedTransportMessage): Promise<void> {
    await markMessageReadOnce(options, readMarkedTransportMessageIds, received);
  }

  async function processReceivedMessage(received: ReceivedTransportMessage): Promise<void> {
    const roleId = normalizeTargetRole(received.envelope.toRole);
    if (!roleId) {
      return;
    }
    const sessionId = options.resolveSessionId(roleId);
    const attemptedAt = clock().toISOString();
    if (!sessionId) {
      await options.emit(
        "mailbox_message_failed",
        {
          transportMessageId: received.transportMessageId,
          roleId,
          attemptedAt,
          reason: "session_not_found",
        },
        roleId,
      );
      return;
    }

    const intercepted = await maybeInterceptDelivery(received, roleId, sessionId, attemptedAt);
    if (intercepted) {
      return;
    }

    const existingQueue = queuedBySession.get(sessionId);
    if (existingQueue && existingQueue.length > 0) {
      if (stopping) {
        await failRunEnded(received, roleId, sessionId, attemptedAt);
        return;
      }
      await queueMessage(sessionId, roleId, received);
      return;
    }

    const idle = await isSessionIdle(options.adapter, options.runId, sessionId);
    if (!idle) {
      if (stopping) {
        await failRunEnded(received, roleId, sessionId, attemptedAt);
        return;
      }
      await queueMessage(sessionId, roleId, received);
      return;
    }

    await deliverMessage(received, roleId, sessionId, attemptedAt);
  }

  async function drainQueuedMessages(): Promise<boolean> {
    let madeProgress = false;
    for (const [sessionId, queued] of Array.from(queuedBySession.entries())) {
      if (queued.length === 0) {
        queuedBySession.delete(sessionId);
        continue;
      }
      const idle = await isSessionIdle(options.adapter, options.runId, sessionId);
      if (!idle) {
        continue;
      }
      while (queued.length > 0) {
        const received = queued[0]!;
        const roleId = normalizeTargetRole(received.envelope.toRole);
        const attemptedAt = clock().toISOString();
        if (!roleId) {
          queued.shift();
          continue;
        }
        const intercepted = await maybeInterceptDelivery(received, roleId, sessionId, attemptedAt);
        if (intercepted) {
          queued.shift();
          madeProgress = true;
          continue;
        }
        const delivered = await deliverMessage(received, roleId, sessionId, attemptedAt);
        queued.shift();
        madeProgress = true;
        if (!delivered) {
          break;
        }
      }
      if (queued.length === 0) {
        queuedBySession.delete(sessionId);
      }
    }
    return madeProgress;
  }

  async function queueMessage(sessionId: string, roleId: string, received: ReceivedTransportMessage): Promise<void> {
    const queued = queuedBySession.get(sessionId) ?? [];
    queued.push(received);
    queuedBySession.set(sessionId, queued);
    await options.emit(
      "mailbox_message_queued",
      withOrchestrationSource(received.envelope.body, {
        transportMessageId: received.transportMessageId,
        sessionId,
        roleId,
        queuedAt: clock().toISOString(),
        queueDepth: queued.length,
      }),
      roleId,
      sessionId,
    );
    await markMessageRead(received);
  }

  async function maybeInterceptDelivery(
    received: ReceivedTransportMessage,
    roleId: string,
    sessionId: string,
    attemptedAt: string,
  ): Promise<boolean> {
    try {
      const intercepted = await options.interceptDelivery?.({
        message: received.envelope.body,
        transportMessageId: received.transportMessageId,
        roleId,
        sessionId,
        attemptedAt,
      });
      if (!intercepted) {
        return false;
      }
      const extraPayload = intercepted === true ? {} : intercepted;
      await options.emit(
        "mailbox_message_delivered",
        withOrchestrationSource(received.envelope.body, {
          transportMessageId: received.transportMessageId,
          sessionId,
          roleId,
          deliveredAt: clock().toISOString(),
          deliveryMode: "intercepted",
          ...extraPayload,
        }),
        roleId,
        sessionId,
      );
      await markMessageRead(received);
      return true;
    } catch (error) {
      await options.emit(
        "mailbox_message_failed",
        withOrchestrationSource(received.envelope.body, {
          transportMessageId: received.transportMessageId,
          sessionId,
          roleId,
          attemptedAt,
          reason: error instanceof Error ? error.message : String(error),
        }),
        roleId,
        sessionId,
      );
      return true;
    }
  }

  async function deliverMessage(
    received: ReceivedTransportMessage,
    roleId: string,
    sessionId: string,
    attemptedAt: string,
  ): Promise<boolean> {
    try {
      await options.adapter.sendSessionMessage({
        runId: options.runId,
        sessionId,
        message: renderSessionMessage(received.envelope.body),
        wait: false,
      });
      await options.emit(
        "mailbox_message_delivered",
        withOrchestrationSource(received.envelope.body, {
          transportMessageId: received.transportMessageId,
          sessionId,
          roleId,
          deliveredAt: clock().toISOString(),
        }),
        roleId,
        sessionId,
      );
      await options.onDelivered?.({
        message: received.envelope.body,
        transportMessageId: received.transportMessageId,
        roleId,
        sessionId,
      });
      await markMessageRead(received);
      return true;
    } catch (error) {
      await options.emit(
        "mailbox_message_failed",
        withOrchestrationSource(received.envelope.body, {
          transportMessageId: received.transportMessageId,
          sessionId,
          roleId,
          attemptedAt,
          reason: error instanceof Error ? error.message : String(error),
        }),
        roleId,
        sessionId,
      );
      return false;
    }
  }

  async function flushShutdownPass(): Promise<void> {
    let passesWithoutProgress = 0;
    while (passesWithoutProgress < MAX_SHUTDOWN_DRAIN_PASSES_WITHOUT_PROGRESS) {
      const waitResult = await options.transport.wait({
        room: options.room,
        since,
        timeoutMs: 0,
      });
      if (waitResult.latestTimestamp) {
        since = { kind: "timestamp", value: waitResult.latestTimestamp };
      }

      let madeProgress = false;
      for (const received of waitResult.messages) {
        if (seenTransportMessageIds.has(received.transportMessageId)) {
          continue;
        }
        seenTransportMessageIds.add(received.transportMessageId);
        madeProgress = true;
        await processReceivedMessage(received);
      }

      if (queuedBySession.size > 0) {
        madeProgress = (await drainQueuedMessages()) || madeProgress;
      }

      passesWithoutProgress = madeProgress ? 0 : passesWithoutProgress + 1;
    }
  }

  async function failRunEnded(
    received: ReceivedTransportMessage,
    roleId: string,
    sessionId: string,
    attemptedAt: string,
  ): Promise<void> {
    await options.emit(
      "mailbox_message_failed",
      withOrchestrationSource(received.envelope.body, {
        transportMessageId: received.transportMessageId,
        sessionId,
        roleId,
        attemptedAt,
        reason: "run_ended",
      }),
      roleId,
      sessionId,
    );
    await markMessageRead(received);
  }

  function withOrchestrationSource(message: MailboxMessage, payload: Record<string, unknown>): Record<string, unknown> {
    const orchestrationSource = options.resolveOrchestrationSource?.(message);
    if (!orchestrationSource) {
      return payload;
    }
    return { ...payload, orchestrationSource };
  }
}

async function markMessageReadOnce(
  options: InboxDeliveryLoopOptions,
  readMarkedTransportMessageIds: Set<string>,
  received: ReceivedTransportMessage,
): Promise<void> {
  if (readMarkedTransportMessageIds.has(received.transportMessageId)) {
    return;
  }
  readMarkedTransportMessageIds.add(received.transportMessageId);
  await options.markMessageRead?.(received.envelope.body);
}

function normalizeTargetRole(toRole: string | "broadcast"): string | null {
  if (toRole === "broadcast" || toRole === "pluto") {
    return null;
  }
  return toRole;
}

function renderSessionMessage(message: MailboxMessage): string {
  if (message.kind === "text" && typeof message.body === "string") {
    return message.body;
  }
  return JSON.stringify({
    id: message.id,
    to: message.to,
    from: message.from,
    kind: message.kind,
    summary: message.summary,
    replyTo: message.replyTo,
    body: message.body,
  });
}

async function isSessionIdle(adapter: PaseoTeamAdapter, runId: string, sessionId: string): Promise<boolean> {
  if (hasAsyncIdleCheck(adapter)) {
    return await adapter.isSessionIdle({ runId, sessionId });
  }
  return true;
}

function hasAsyncIdleCheck(
  adapter: PaseoTeamAdapter,
): adapter is PaseoTeamAdapter & { isSessionIdle(input: { runId: string; sessionId: string }): Promise<boolean> } {
  return typeof (adapter as { isSessionIdle?: unknown }).isSessionIdle === "function";
}
