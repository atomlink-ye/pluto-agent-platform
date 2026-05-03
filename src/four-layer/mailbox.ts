import { appendFile, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { MailboxMessage, MailboxMessageBody, MailboxMessageKind } from "../contracts/four-layer.js";
import {
  captureRuntimeOwnedFileSnapshot,
  persistRuntimeOwnedFileSnapshot,
  readRuntimeOwnedFileSnapshot,
  runtimeOwnedSnapshotPath,
  type RuntimeOwnedFileSnapshot,
} from "./runtime-owned-files.js";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

export interface MailboxStoreOptions {
  runDir: string;
  teammateIds: string[];
  clock?: () => Date;
  idGen?: () => string;
  teamLeadId?: string;
}

export interface SendMailboxMessageInput {
  to: string;
  from: string;
  kind?: MailboxMessageKind;
  body: MailboxMessageBody;
  summary?: string;
  replyTo?: string;
}

export class FileBackedMailbox {
  private readonly runDir: string;
  private readonly teammateIds: Set<string>;
  private readonly clock: () => Date;
  private readonly idGen: () => string;
  private readonly teamLeadId: string;

  constructor(options: MailboxStoreOptions) {
    this.runDir = options.runDir;
    this.teammateIds = new Set(options.teammateIds);
    this.clock = options.clock ?? (() => new Date());
    this.idGen = options.idGen ?? (() => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);
    this.teamLeadId = options.teamLeadId ?? "team-lead";
  }

  inboxPath(teammateId: string): string {
    return join(this.runDir, "inboxes", `${teammateId}.json`);
  }

  mirrorPath(): string {
    return join(this.runDir, "mailbox.jsonl");
  }

  runtimeSnapshotPath(): string {
    return runtimeOwnedSnapshotPath(this.runDir, "mailbox");
  }

  async ensure(): Promise<void> {
    await mkdir(join(this.runDir, "inboxes"), { recursive: true });
    await mkdir(dirname(this.mirrorPath()), { recursive: true });
    for (const teammateId of this.teammateIds) {
      const inboxPath = this.inboxPath(teammateId);
      try {
        await readFile(inboxPath, "utf8");
      } catch {
        await writeFile(inboxPath, "[]\n", "utf8");
      }
    }
    try {
      await readFile(this.mirrorPath(), "utf8");
    } catch {
      await writeFile(this.mirrorPath(), "", "utf8");
      await this.captureRuntimeSnapshot();
    }
  }

  async send(input: SendMailboxMessageInput): Promise<MailboxMessage> {
    await this.ensure();
    const teammateId = input.to;
    const message: MailboxMessage = {
      id: this.idGen(),
      to: input.to,
      from: input.from,
      createdAt: this.clock().toISOString(),
      kind: input.kind ?? "text",
      body: input.body,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    };
    await withFileLock(`${this.inboxPath(teammateId)}.lock`, async () => {
      const inbox = await this.readInbox(teammateId);
      inbox.push(message);
      await writeFile(this.inboxPath(teammateId), JSON.stringify(inbox, null, 2) + "\n", "utf8");
    });
    await withFileLock(`${this.mirrorPath()}.lock`, async () => {
      await appendFile(this.mirrorPath(), JSON.stringify(message) + "\n", "utf8");
      await this.captureRuntimeSnapshot();
    });
    return message;
  }

  async readRuntimeSnapshot(): Promise<RuntimeOwnedFileSnapshot | null> {
    return readRuntimeOwnedFileSnapshot(this.runtimeSnapshotPath());
  }

  async read(teammateId: string, options: { unreadOnly?: boolean } = {}): Promise<MailboxMessage[]> {
    await this.ensure();
    const inbox = await this.readInbox(teammateId);
    const messages = options.unreadOnly ? inbox.filter((message) => !message.readAt) : inbox;
    return sortMailboxMessages(messages, teammateId, this.teamLeadId);
  }

  async markRead(teammateId: string, messageIds: string[]): Promise<void> {
    await this.ensure();
    const toMark = new Set(messageIds);
    await withFileLock(`${this.inboxPath(teammateId)}.lock`, async () => {
      const inbox = await this.readInbox(teammateId);
      const updated = inbox.map((message) =>
        toMark.has(message.id) && !message.readAt
          ? { ...message, readAt: this.clock().toISOString() }
          : message,
      );
      await writeFile(this.inboxPath(teammateId), JSON.stringify(updated, null, 2) + "\n", "utf8");
    });
  }

  private async readInbox(teammateId: string): Promise<MailboxMessage[]> {
    const raw = await readFile(this.inboxPath(teammateId), "utf8");
    const parsed = JSON.parse(raw) as MailboxMessage[];
    return Array.isArray(parsed) ? parsed : [];
  }

  private async captureRuntimeSnapshot(): Promise<void> {
    // Best-effort: audit guard is emit-only, so snapshot I/O failure must not
    // fail the surrounding mailbox write. Loss of a snapshot just means a
    // future external-write check will skip rather than producing a false
    // positive.
    try {
      const snapshot = await captureRuntimeOwnedFileSnapshot(this.mirrorPath(), this.clock().toISOString());
      await persistRuntimeOwnedFileSnapshot(this.runtimeSnapshotPath(), snapshot);
    } catch {
      // intentionally swallowed
    }
  }
}

export function sortMailboxMessages(
  messages: ReadonlyArray<MailboxMessage>,
  teammateId: string,
  teamLeadId: string,
): MailboxMessage[] {
  return [...messages].sort((left, right) => {
    const byPriority = mailboxPriority(left, teammateId, teamLeadId) - mailboxPriority(right, teammateId, teamLeadId);
    if (byPriority !== 0) return byPriority;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function mailboxPriority(message: MailboxMessage, teammateId: string, teamLeadId: string): number {
  if (message.kind === "shutdown_request") return 0;
  if (message.from === teamLeadId) return 1;
  if (message.from === teammateId) return 3;
  return 2;
}

async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        return await fn();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}
