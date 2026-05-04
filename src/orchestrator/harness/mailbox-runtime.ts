import { captureRuntimeOwnedFileSnapshot } from "../../four-layer/runtime-owned-files.js";
import type {
  DispatchOrchestrationSource,
  EvidenceAuditEvent,
  EvidenceAuditEventKind,
  EvidenceAuditHookBoundary,
  MailboxEnvelope,
  MailboxMessage,
  MailboxMessageKind,
  Run,
} from "../../contracts/four-layer.js";
import type { AgentEvent, AgentEventType, CoordinationTranscriptRefV0 } from "../../contracts/types.js";
import type { MailboxTransport } from "../../four-layer/mailbox-transport.js";

export interface SendMailboxMessageInput {
  to: string;
  from: string;
  kind?: MailboxMessageKind;
  body: MailboxMessage["body"];
  summary?: string;
  replyTo?: string;
  transportReplyTo?: string;
  taskId?: string;
}

export interface CreateMailboxRuntimeInput {
  runId: string;
  runDir: string;
  run: Pick<Run, "startedAt">;
  mailboxRef: CoordinationTranscriptRefV0;
  dispatchMode: DispatchOrchestrationSource;
  clock: () => Date;
  emit: (type: AgentEventType, payload?: Record<string, unknown>, roleId?: string, sessionId?: string) => Promise<AgentEvent>;
  onPhase?: (phase: string, details: Record<string, unknown>) => Promise<void> | void;
  auditEvents: EvidenceAuditEvent[];
  mailbox: {
    mirrorPath(): string;
    readMirror(): Promise<MailboxMessage[]>;
    readRuntimeSnapshot(): Promise<{ sha256: string; lineCount: number } | null>;
    createMessage(input: SendMailboxMessageInput): MailboxMessage;
    appendToInbox(message: MailboxMessage): Promise<void>;
    appendToMirror(message: MailboxMessage): Promise<void>;
  };
  taskList: {
    path(): string;
    readRuntimeSnapshot(): Promise<{ sha256: string; lineCount: number } | null>;
  };
  getMailboxTransport: () => MailboxTransport | undefined;
}

export function createMailboxRuntime(input: CreateMailboxRuntimeInput): {
  sendMailboxMessage: (message: SendMailboxMessageInput) => Promise<MailboxMessage>;
  recordMailboxMessageEvent: (
    message: MailboxMessage,
    roleId?: string,
    sessionId?: string,
    orchestrationSource?: DispatchOrchestrationSource,
    extraPayload?: Record<string, unknown>,
  ) => Promise<void>;
  auditRuntimeMirrors: (hookBoundary: EvidenceAuditHookBoundary) => Promise<void>;
  auditMailboxTransportParity: () => Promise<void>;
  resolveMailboxOrchestrationSource: (message: MailboxMessage) => DispatchOrchestrationSource | undefined;
  mailboxRef: CoordinationTranscriptRefV0;
} {
  const recordMailboxMessageEvent = async (
    message: MailboxMessage,
    roleId?: string,
    sessionId?: string,
    orchestrationSource?: DispatchOrchestrationSource,
    extraPayload?: Record<string, unknown>,
  ) => {
    await input.emit("mailbox_message", {
      messageId: message.id,
      to: message.to,
      from: message.from,
      kind: message.kind,
      transportMessageId: message.transportMessageId,
      ...(orchestrationSource ? { orchestrationSource } : {}),
      ...(extraPayload ?? {}),
    }, roleId, sessionId);
  };

  const sendMailboxMessage = async (messageInput: SendMailboxMessageInput): Promise<MailboxMessage> => {
    const mailboxTransport = input.getMailboxTransport();
    if (!mailboxTransport || !input.mailboxRef.roomRef) {
      throw new Error("mailbox_transport_not_ready");
    }

    const baseMessage = input.mailbox.createMessage(messageInput);
    const envelope: MailboxEnvelope = {
      schemaVersion: "v1",
      fromRole: baseMessage.from,
      toRole: baseMessage.to,
      runId: input.runId,
      ...(messageInput.taskId ? { taskId: messageInput.taskId } : {}),
      body: baseMessage,
    };

    let mirroredMessage = baseMessage;
    try {
      const transportRef = await mailboxTransport.post({
        room: input.mailboxRef.roomRef,
        envelope,
        ...(messageInput.transportReplyTo ? { replyTo: messageInput.transportReplyTo } : {}),
      });
      mirroredMessage = {
        ...baseMessage,
        transportMessageId: transportRef.transportMessageId,
        transportTimestamp: transportRef.transportTimestamp,
        transportStatus: "ok",
        deliveryStatus: "pending",
      };
    } catch (error) {
      mirroredMessage = {
        ...baseMessage,
        transportStatus: "post_failed",
        deliveryStatus: "failed",
        deliveryAttemptedAt: input.clock().toISOString(),
        deliveryFailedReason: "transport_post_failed",
      };
      await input.emit("mailbox_transport_post_failed", {
        messageId: baseMessage.id,
        to: baseMessage.to,
        from: baseMessage.from,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await input.mailbox.appendToInbox(mirroredMessage);
    try {
      await input.mailbox.appendToMirror(mirroredMessage);
    } catch (error) {
      throw new MailboxMirrorWriteError(error instanceof Error ? error.message : String(error));
    }
    return mirroredMessage;
  };

  const dispatchMessageKinds = new Set<MailboxMessageKind>([
    "evaluator_verdict",
    "revision_request",
    "shutdown_request",
    "shutdown_response",
    "spawn_request",
    "worker_complete",
    "final_reconciliation",
  ]);
  const resolveMailboxOrchestrationSource = (message: MailboxMessage): DispatchOrchestrationSource | undefined =>
    dispatchMessageKinds.has(message.kind) ? input.dispatchMode : undefined;

  const auditMailboxTransportParity = async () => {
    const mailboxTransport = input.getMailboxTransport();
    if (!mailboxTransport || !input.mailboxRef.roomRef || !input.run.startedAt) {
      return;
    }

    const mirrorMessages = await input.mailbox.readMirror();
    const mirrorTransportIds = mirrorMessages
      .filter((message) => message.transportStatus === "ok" && typeof message.transportMessageId === "string")
      .map((message) => message.transportMessageId!);

    try {
      const transportRead = await mailboxTransport.read({
        room: input.mailboxRef.roomRef,
        since: { kind: "timestamp", value: input.run.startedAt },
      });
      for (const rejection of drainEnvelopeRejections(mailboxTransport)) {
        await input.emit("mailbox_transport_envelope_rejected", rejection);
      }
      const transportIds = transportRead.messages.map((message) => message.transportMessageId);
      const mirrorSet = new Set(mirrorTransportIds);
      const transportSet = new Set(transportIds);
      const missing = mirrorTransportIds.filter((id) => !transportSet.has(id));
      const extra = transportIds.filter((id) => !mirrorSet.has(id));
      const reorderedAt: number[] = [];
      for (let index = 0; index < Math.min(mirrorTransportIds.length, transportIds.length); index += 1) {
        if (mirrorTransportIds[index] !== transportIds[index]) {
          reorderedAt.push(index);
        }
      }
      if (missing.length || extra.length || reorderedAt.length) {
        await input.emit("mailbox_transport_parity_drift", { missing, extra, reorderedAt });
      }
    } catch (error) {
      await input.emit("mailbox_transport_parity_drift", {
        missing: mirrorTransportIds,
        extra: [],
        reorderedAt: [],
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const recordAuditEvent = async (
    kind: EvidenceAuditEventKind,
    payload: Omit<EvidenceAuditEvent, "kind">,
  ): Promise<void> => {
    input.auditEvents.push({ kind, ...payload });
    await input.emit(kind, payload);
  };

  const checkRuntimeMirror = async (
    kind: EvidenceAuditEventKind,
    hookBoundary: EvidenceAuditHookBoundary,
    filePath: string,
    readSnapshot: () => Promise<{ sha256: string; lineCount: number } | null>,
  ): Promise<void> => {
    const lastKnown = await readSnapshot();
    if (!lastKnown) return;
    let observed;
    try {
      observed = await captureRuntimeOwnedFileSnapshot(filePath, input.clock().toISOString());
    } catch {
      return;
    }
    if (observed.sha256 === lastKnown.sha256 && observed.lineCount === lastKnown.lineCount) {
      return;
    }
    await recordAuditEvent(kind, {
      filePath,
      lastKnownSha256: lastKnown.sha256,
      observedSha256: observed.sha256,
      lastKnownLineCount: lastKnown.lineCount,
      observedLineCount: observed.lineCount,
      hookBoundary,
    });
  };

  const auditRuntimeMirrors = async (hookBoundary: EvidenceAuditHookBoundary): Promise<void> => {
    await input.onPhase?.("before_hook_boundary", {
      runId: input.runId,
      runDir: input.runDir,
      hookBoundary,
      mailboxPath: input.mailbox.mirrorPath(),
      taskListPath: input.taskList.path(),
    });
    await Promise.all([
      checkRuntimeMirror(
        "mailbox_external_write_detected",
        hookBoundary,
        input.mailbox.mirrorPath(),
        () => input.mailbox.readRuntimeSnapshot(),
      ),
      checkRuntimeMirror(
        "tasklist_external_write_detected",
        hookBoundary,
        input.taskList.path(),
        () => input.taskList.readRuntimeSnapshot(),
      ),
    ]);
  };

  return {
    sendMailboxMessage,
    recordMailboxMessageEvent,
    auditRuntimeMirrors,
    auditMailboxTransportParity,
    resolveMailboxOrchestrationSource,
    mailboxRef: input.mailboxRef,
  };
}

export class MailboxMirrorWriteError extends Error {
  constructor(message: string) {
    super(`mailbox_mirror_failed: ${message}`);
    this.name = "MailboxMirrorWriteError";
  }

  toBlockerPayload() {
    return {
      reason: "mailbox_mirror_failed",
      message: this.message,
      detail: {
        operation: "append_mailbox_mirror",
      },
    };
  }
}

function drainEnvelopeRejections(transport: MailboxTransport): Array<Record<string, unknown>> {
  if (!hasEnvelopeRejectionDrain(transport)) {
    return [];
  }
  return transport.drainEnvelopeRejections().map((rejection) => ({ ...rejection }));
}

function hasEnvelopeRejectionDrain(
  transport: MailboxTransport,
): transport is MailboxTransport & { drainEnvelopeRejections: () => Array<Record<string, unknown>> } {
  return typeof (transport as { drainEnvelopeRejections?: unknown }).drainEnvelopeRejections === "function";
}
