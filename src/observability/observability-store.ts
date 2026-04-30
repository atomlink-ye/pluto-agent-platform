import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { redactObservabilityRecordForPersistence } from "./redaction.js";
import {
  queryObservabilityRecords,
  validateObservabilityRecordV0,
  type ObservabilityRecordQueryV0,
  type ObservabilityRecordV0,
} from "./query.js";

export interface ObservabilityStoreOptions {
  dataDir?: string;
}

const OBSERVABILITY_KINDS = [
  "metric_series",
  "run_health_summary",
  "adapter_health_summary",
  "redacted_trace",
  "alert",
  "dashboard_definition",
  "usage_meter",
  "budget",
  "budget_snapshot",
  "budget_decision",
] as const;

export class ObservabilityStore {
  private readonly dataDir: string;

  constructor(options: ObservabilityStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async put<T extends ObservabilityRecordV0>(record: T): Promise<T> {
    const sanitized = redactObservabilityRecordForPersistence(requireObservabilityRecord(record)).record;
    await mkdir(this.kindDir(sanitized.kind), { recursive: true });
    await writeFile(this.recordPath(sanitized.kind, sanitized.id), JSON.stringify(sanitized, null, 2) + "\n", "utf8");
    return sanitized as T;
  }

  async get(id: string): Promise<ObservabilityRecordV0 | null>;
  async get(kind: string, id: string): Promise<ObservabilityRecordV0 | null>;
  async get(first: string, second?: string): Promise<ObservabilityRecordV0 | null> {
    if (second !== undefined) {
      return this.readRecord(first, second);
    }

    for (const kind of OBSERVABILITY_KINDS) {
      const record = await this.readRecord(kind, first);
      if (record !== null) {
        return record;
      }
    }

    return null;
  }

  async query(query: ObservabilityRecordQueryV0 = {}): Promise<ObservabilityRecordV0[]> {
    return queryObservabilityRecords(await this.listAllRecords(query.kind), query);
  }

  async listAllRecords(kind?: ObservabilityRecordQueryV0["kind"]): Promise<ObservabilityRecordV0[]> {
    const kinds = kind === undefined
      ? [...OBSERVABILITY_KINDS]
      : Array.isArray(kind) ? [...kind] : [kind];
    const records: ObservabilityRecordV0[] = [];

    for (const entryKind of kinds) {
      let entries: string[];
      try {
        entries = await readdir(this.kindDir(entryKind));
      } catch {
        continue;
      }

      const ids = entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => entry.slice(0, -5))
        .sort((left, right) => left.localeCompare(right));

      for (const id of ids) {
        const record = await this.readRecord(entryKind, id);
        if (record !== null) {
          records.push(record);
        }
      }
    }

    return records;
  }

  private async readRecord(kind: string, id: string): Promise<ObservabilityRecordV0 | null> {
    try {
      const raw = await readFile(this.recordPath(kind, id), "utf8");
      return requireObservabilityRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private observabilityDir(): string {
    return join(this.dataDir, "observability", "local-v0");
  }

  private kindDir(kind: string): string {
    return join(this.observabilityDir(), kind);
  }

  private recordPath(kind: string, id: string): string {
    return join(this.kindDir(kind), `${id}.json`);
  }
}

function requireObservabilityRecord(value: unknown): ObservabilityRecordV0 {
  const validated = validateObservabilityRecordV0(value);
  if (!validated.ok) {
    throw new Error(`Invalid observability record: ${validated.errors.join(", ")}`);
  }

  return validated.value;
}
