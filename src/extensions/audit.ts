import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type ExtensionAuditEventType =
  | "install"
  | "trust-review"
  | "activate"
  | "activate-denied"
  | "deactivate"
  | "revoke";

export interface ExtensionAuditEvent {
  eventId: string;
  eventType: ExtensionAuditEventType;
  occurredAt: string;
  extensionId: string;
  installId: string;
  actor: string;
  details: Record<string, unknown>;
}

export class ExtensionAuditLog {
  private readonly dataDir: string;

  constructor(opts: { dataDir?: string } = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async append(event: ExtensionAuditEvent): Promise<ExtensionAuditEvent> {
    await mkdir(this.auditDir(), { recursive: true });
    await appendFile(this.auditPath(), `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  async list(): Promise<ExtensionAuditEvent[]> {
    try {
      const raw = await readFile(this.auditPath(), "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as ExtensionAuditEvent);
    } catch {
      return [];
    }
  }

  private auditDir(): string {
    return join(this.dataDir, "extensions", "audit");
  }

  private auditPath(): string {
    return join(this.auditDir(), "events.jsonl");
  }
}
