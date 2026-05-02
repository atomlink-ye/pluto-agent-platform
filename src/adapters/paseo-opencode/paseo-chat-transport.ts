import type {
  MailboxEnvelope,
  ReceivedTransportMessage,
  RoomRef,
  TransportMessageRef,
  TransportReadResult,
  TransportSince,
} from "../../contracts/four-layer.js";
import type { MailboxTransport } from "../../four-layer/mailbox-transport.js";
import { DEFAULT_RUNNER, type ProcessRunner } from "./process-runner.js";

const REJECTION_REASON_JSON_PARSE = "json_parse" as const;
const REJECTION_REASON_SCHEMA_VERSION = "schema_version" as const;

export interface PaseoChatEnvelopeRejection {
  reason: typeof REJECTION_REASON_JSON_PARSE | typeof REJECTION_REASON_SCHEMA_VERSION;
  transportMessageId?: string;
  transportTimestamp?: string;
  detail?: string;
}

export interface PaseoChatTransportOptions {
  paseoBin?: string;
  host?: string;
  runner?: ProcessRunner;
}

export class PaseoChatUnavailableError extends Error {
  readonly blockerReason = "chat_transport_unavailable" as const;
  readonly command: string;
  readonly paseoBin: string;
  readonly stderrTail: string;

  constructor(input: { command: string; paseoBin: string; exitCode: number | null; stderr: string }) {
    super(`${input.command} failed (exit ${input.exitCode ?? "unknown"})`);
    this.name = "PaseoChatUnavailableError";
    this.command = input.command;
    this.paseoBin = input.paseoBin;
    this.stderrTail = input.stderr.slice(-200);
  }

  toBlockerPayload() {
    return {
      reason: this.blockerReason,
      message: this.message,
      detail: {
        command: this.command,
        paseoBin: this.paseoBin || "PATH lookup failed",
        stderrTail: this.stderrTail,
      },
    };
  }
}

export class PaseoChatTransport implements MailboxTransport {
  private readonly paseoBin: string;
  private readonly host?: string;
  private readonly runner: ProcessRunner;
  private readonly rejections: PaseoChatEnvelopeRejection[] = [];

  constructor(options: PaseoChatTransportOptions = {}) {
    this.paseoBin = options.paseoBin ?? process.env["PASEO_BIN"] ?? "paseo";
    this.host = normalizePaseoHost(options.host ?? process.env["PASEO_HOST"]);
    this.runner = options.runner ?? DEFAULT_RUNNER;
  }

  async probeCapabilities(): Promise<void> {
    await this.probeSubcommand("create");
    await this.probeSubcommand("post");
    await this.probeSubcommand("read");
  }

  drainEnvelopeRejections(): PaseoChatEnvelopeRejection[] {
    return this.rejections.splice(0);
  }

  async createRoom(input: { runId: string; name: string; purpose?: string }): Promise<RoomRef> {
    void input.runId;
    const args = [
      "chat",
      "create",
      ...(input.purpose ? ["--purpose", input.purpose] : []),
      "--json",
      ...this.hostArgs(),
      input.name,
    ];
    const parsed = await this.execJson(args);
    return firstString(parsed, ["id", "roomId", "name"]) ?? input.name;
  }

  async post(input: { room: RoomRef; envelope: MailboxEnvelope; replyTo?: string }): Promise<TransportMessageRef> {
    const args = [
      "chat",
      "post",
      ...(input.replyTo ? ["--reply-to", input.replyTo] : []),
      "--json",
      ...this.hostArgs(),
      input.room,
      JSON.stringify(input.envelope),
    ];
    const parsed = await this.execJson(args);
    const transportMessageId = requireString(parsed, ["id", "messageId", "transportMessageId"]);
    const transportTimestamp = requireString(parsed, ["timestamp", "createdAt", "ts"]);
    return {
      transportMessageId,
      transportTimestamp,
      roomRef: input.room,
    };
  }

  async read(input: { room: RoomRef; since?: TransportSince; limit?: number; agentId?: string }): Promise<TransportReadResult> {
    this.rejections.splice(0);
    const args = [
      "chat",
      "read",
      ...(input.limit ? ["--limit", String(input.limit)] : []),
      ...(input.since ? ["--since", formatSince(input.since)] : []),
      ...(input.agentId ? ["--agent", input.agentId] : []),
      "--json",
      ...this.hostArgs(),
      input.room,
    ];
    const parsed = await this.execJson(args);
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)["messages"])
        ? ((parsed as Record<string, unknown>)["messages"] as unknown[])
        : [];
    const messages: ReceivedTransportMessage[] = [];
    let latestTimestamp = firstString(parsed, ["latestTimestamp", "cursor", "nextCursor"]) ?? null;

    for (const row of rows) {
      if (typeof row !== "object" || row === null) {
        continue;
      }
      const record = row as Record<string, unknown>;
      const transportMessageId = firstString(record, ["id", "messageId", "transportMessageId"]);
      const transportTimestamp = firstString(record, ["timestamp", "createdAt", "ts"]);
      const wirePayload = firstString(record, ["message", "text", "content", "body"]);
      if (!wirePayload) {
        continue;
      }
      const envelope = this.tryParseEnvelope(wirePayload, transportMessageId, transportTimestamp);
      if (!envelope || !transportMessageId || !transportTimestamp) {
        continue;
      }
      messages.push({
        transportMessageId,
        transportTimestamp,
        envelope,
        ...(normalizeReplyTo(firstString(record, ["replyTo", "reply_to", "replyToId"]))
          ? { replyTo: normalizeReplyTo(firstString(record, ["replyTo", "reply_to", "replyToId"]))! }
          : {}),
      });
      latestTimestamp = transportTimestamp;
    }

    return { messages, latestTimestamp };
  }

  private async probeSubcommand(subcommand: "create" | "post" | "read"): Promise<void> {
    const command = `paseo chat ${subcommand} --help`;
    try {
      const result = await this.runner.exec(this.paseoBin, ["chat", subcommand, "--help"]);
      if (result.exitCode !== 0) {
        throw new PaseoChatUnavailableError({
          command,
          paseoBin: this.paseoBin,
          exitCode: result.exitCode,
          stderr: result.stderr,
        });
      }
    } catch (error) {
      if (error instanceof PaseoChatUnavailableError) {
        throw error;
      }
      throw new PaseoChatUnavailableError({
        command,
        paseoBin: this.paseoBin,
        exitCode: null,
        stderr: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private tryParseEnvelope(
    raw: string,
    transportMessageId?: string,
    transportTimestamp?: string,
  ): MailboxEnvelope | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.rejections.push({
        reason: REJECTION_REASON_JSON_PARSE,
        transportMessageId,
        transportTimestamp,
        detail: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    if (!isMailboxEnvelope(parsed)) {
      this.rejections.push({
        reason: REJECTION_REASON_SCHEMA_VERSION,
        transportMessageId,
        transportTimestamp,
        detail: typeof parsed === "object" && parsed !== null ? JSON.stringify(parsed) : String(parsed),
      });
      return null;
    }
    return parsed;
  }

  private async execJson(args: string[]): Promise<Record<string, unknown> | unknown[]> {
    const result = await this.runner.exec(this.paseoBin, args);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `paseo chat command failed: ${args.join(" ")}`);
    }
    const parsed = JSON.parse(result.stdout) as Record<string, unknown> | unknown[];
    return parsed;
  }

  private hostArgs(): string[] {
    return this.host ? ["--host", this.host] : [];
  }
}

function formatSince(since: TransportSince): string {
  return since.value;
}

function normalizePaseoHost(host: string | undefined): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^https?:\/\//i, "");
}

function firstString(value: unknown, keys: string[]): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key] as string;
    }
  }
  return undefined;
}

function requireString(value: unknown, keys: string[]): string {
  const found = firstString(value, keys);
  if (!found) {
    throw new Error(`missing required paseo chat field: ${keys.join(",")}`);
  }
  return found;
}

function normalizeReplyTo(value: string | undefined): string | undefined {
  if (!value || value === "-") {
    return undefined;
  }
  return value;
}

function isMailboxEnvelope(value: unknown): value is MailboxEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record["schemaVersion"] === "v1"
    && typeof record["fromRole"] === "string"
    && (typeof record["toRole"] === "string")
    && typeof record["runId"] === "string"
    && typeof record["body"] === "object"
    && record["body"] !== null;
}
