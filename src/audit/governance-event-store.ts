import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { GovernanceEventQueryV0, GovernanceEventRecordV0 } from "./governance-events.js";
import { validateGovernanceEventRecordV0 } from "./governance-events.js";

export interface GovernanceEventStoreOptions {
  dataDir?: string;
}

export function governanceAuditDir(dataDir: string): string {
  return join(dataDir, "audit", "governance-events");
}

export class GovernanceEventStore {
  private readonly dataDir: string;

  constructor(options: GovernanceEventStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async append(event: GovernanceEventRecordV0): Promise<GovernanceEventRecordV0> {
    const validated = requireGovernanceEvent(event);
    await mkdir(governanceAuditDir(this.dataDir), { recursive: true });
    await appendFile(this.eventLogPath(), `${JSON.stringify(validated)}\n`, "utf8");
    return validated;
  }

  async appendMany(events: readonly GovernanceEventRecordV0[]): Promise<GovernanceEventRecordV0[]> {
    const appended: GovernanceEventRecordV0[] = [];
    for (const event of events) {
      appended.push(await this.append(event));
    }
    return appended;
  }

  async get(eventId: string): Promise<GovernanceEventRecordV0 | null> {
    const events = await this.list();
    return events.find((event) => event.eventId === eventId) ?? null;
  }

  async list(query: GovernanceEventQueryV0 = {}): Promise<GovernanceEventRecordV0[]> {
    const events = await this.readAll();
    const eventTypes = query.eventType === undefined
      ? null
      : new Set(Array.isArray(query.eventType) ? query.eventType : [query.eventType]);

    return events.filter((event) => {
      if (eventTypes !== null && !eventTypes.has(event.eventType)) {
        return false;
      }
      if (query.targetKind !== undefined && event.target.kind !== query.targetKind) {
        return false;
      }
      if (query.targetRecordId !== undefined && event.target.recordId !== query.targetRecordId) {
        return false;
      }
      if (query.actorId !== undefined && event.actor.principalId !== query.actorId) {
        return false;
      }
      if (query.since !== undefined && event.createdAt < query.since) {
        return false;
      }
      if (query.until !== undefined && event.createdAt > query.until) {
        return false;
      }
      return true;
    });
  }

  private async readAll(): Promise<GovernanceEventRecordV0[]> {
    let raw: string;
    try {
      raw = await readFile(this.eventLogPath(), "utf8");
    } catch {
      return [];
    }

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => requireGovernanceEvent(JSON.parse(line)));
  }

  private eventLogPath(): string {
    return join(governanceAuditDir(this.dataDir), "events.jsonl");
  }
}

function requireGovernanceEvent(value: unknown): GovernanceEventRecordV0 {
  const validated = validateGovernanceEventRecordV0(value);
  if (!validated.ok) {
    throw new Error(`Invalid governance audit event: ${validated.errors.join(", ")}`);
  }

  return validated.value;
}
