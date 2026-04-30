import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GovernanceEventStore } from "../audit/governance-event-store.js";
import {
  buildExportSealedAuditEvent,
  buildPackageAssembledAuditEvent,
  buildPublishAttemptedAuditEvent,
  buildRollbackAuditEvent,
} from "../audit/governance-events.js";
import type {
  ExportAssetRecordV0,
  PublishAttemptRecordV0,
  PublishAuditEventV0,
  PublishPackageRecordV0,
  RollbackRetractRecordV0,
} from "../contracts/publish.js";
import {
  toExportAssetRecordV0,
  toPublishAttemptRecordV0,
  toPublishPackageRecordV0,
  toRollbackRetractRecordV0,
  validateExportAssetRecordV0,
  validatePublishAttemptRecordV0,
  validatePublishAuditEventV0,
  validatePublishPackageRecordV0,
  validateRollbackRetractRecordV0,
} from "../contracts/publish.js";

export interface PublishStoreOptions {
  dataDir?: string;
}

type PublishRecordByKindV0 = {
  packages: PublishPackageRecordV0;
  export_assets: ExportAssetRecordV0;
  attempts: PublishAttemptRecordV0;
  rollbacks: RollbackRetractRecordV0;
  audit_events: PublishAuditEventV0;
};

type PublishValidator<K extends keyof PublishRecordByKindV0> = (
  value: unknown,
) =>
  | { ok: true; value: PublishRecordByKindV0[K] }
  | { ok: false; errors: string[] };

const VALIDATORS: { [K in keyof PublishRecordByKindV0]: PublishValidator<K> } = {
  packages: validatePublishPackageRecordV0,
  export_assets: validateExportAssetRecordV0,
  attempts: validatePublishAttemptRecordV0,
  rollbacks: validateRollbackRetractRecordV0,
  audit_events: validatePublishAuditEventV0,
};

export function publishDir(dataDir: string, kind?: keyof PublishRecordByKindV0): string {
  return kind === undefined ? join(dataDir, "publish") : join(dataDir, "publish", kind);
}

export class PublishStore {
  private readonly dataDir: string;
  private readonly governanceAuditStore: GovernanceEventStore;

  constructor(options: PublishStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
    this.governanceAuditStore = new GovernanceEventStore({ dataDir: this.dataDir });
  }

  async putPublishPackage(value: Parameters<typeof toPublishPackageRecordV0>[0]): Promise<string> {
    const record = toPublishPackageRecordV0(value);
    const previous = await this.getPublishPackage(record.id);
    const path = await this.write("packages", record);
    await this.governanceAuditStore.append(buildPackageAssembledAuditEvent(record, previous?.status ?? null));
    return path;
  }

  async getPublishPackage(id: string): Promise<PublishPackageRecordV0 | null> {
    return this.read("packages", id);
  }

  async listPublishPackages(): Promise<PublishPackageRecordV0[]> {
    return this.list("packages");
  }

  async putExportAssetRecord(value: Parameters<typeof toExportAssetRecordV0>[0]): Promise<string> {
    const record = toExportAssetRecordV0(value);
    const path = await this.write("export_assets", record);
    await this.governanceAuditStore.append(buildExportSealedAuditEvent(record));
    return path;
  }

  async getExportAssetRecord(id: string): Promise<ExportAssetRecordV0 | null> {
    return this.read("export_assets", id);
  }

  async listExportAssetRecords(): Promise<ExportAssetRecordV0[]> {
    return this.list("export_assets");
  }

  async recordPublishAttempt(value: Parameters<typeof toPublishAttemptRecordV0>[0]): Promise<string> {
    const record = toPublishAttemptRecordV0(value);
    if (await this.hasIdempotencyKey(record.idempotencyKey)) {
      throw new Error(`duplicate publish idempotency key: ${record.idempotencyKey}`);
    }

    const path = await this.write("attempts", record);
    await this.write("audit_events", toAuditEvent(record));
    await this.governanceAuditStore.append(buildPublishAttemptedAuditEvent(record));
    return path;
  }

  async getPublishAttempt(id: string): Promise<PublishAttemptRecordV0 | null> {
    return this.read("attempts", id);
  }

  async listPublishAttempts(): Promise<PublishAttemptRecordV0[]> {
    return this.list("attempts");
  }

  async recordRollbackRetract(value: Parameters<typeof toRollbackRetractRecordV0>[0]): Promise<string> {
    const record = toRollbackRetractRecordV0(value);
    const path = await this.write("rollbacks", record);
    await this.write("audit_events", toAuditEvent(record));
    await this.governanceAuditStore.append(buildRollbackAuditEvent(record));
    return path;
  }

  async getRollbackRetractRecord(id: string): Promise<RollbackRetractRecordV0 | null> {
    return this.read("rollbacks", id);
  }

  async listRollbackRetractRecords(): Promise<RollbackRetractRecordV0[]> {
    return this.list("rollbacks");
  }

  async listAuditEvents(): Promise<PublishAuditEventV0[]> {
    return this.list("audit_events");
  }

  async hasIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    const attempts = await this.listPublishAttempts();
    return attempts.some((attempt) => attempt.idempotencyKey === idempotencyKey);
  }

  async exists<K extends keyof PublishRecordByKindV0>(kind: K, id: string): Promise<boolean> {
    try {
      await access(join(publishDir(this.dataDir, kind), `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  private async write<K extends keyof PublishRecordByKindV0>(kind: K, record: PublishRecordByKindV0[K]): Promise<string> {
    const validated = validateRecord(kind, record);
    const dir = publishDir(this.dataDir, kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${validated.id}.json`);
    await writeFile(path, JSON.stringify(validated, null, 2) + "\n", "utf8");
    return path;
  }

  private async read<K extends keyof PublishRecordByKindV0>(kind: K, id: string): Promise<PublishRecordByKindV0[K] | null> {
    const path = join(publishDir(this.dataDir, kind), `${id}.json`);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null;
    }

    return validateRecord(kind, JSON.parse(raw));
  }

  private async list<K extends keyof PublishRecordByKindV0>(kind: K): Promise<Array<PublishRecordByKindV0[K]>> {
    let entries: string[];
    try {
      entries = await readdir(publishDir(this.dataDir, kind));
    } catch {
      return [];
    }

    const ids = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5));

    const records: Array<PublishRecordByKindV0[K]> = [];
    for (const id of ids) {
      const record = await this.read(kind, id);
      if (record !== null) {
        records.push(record);
      }
    }

    return records.sort((left, right) => {
      const leftCreatedAt = "createdAt" in left && typeof left.createdAt === "string" ? left.createdAt : left.id;
      const rightCreatedAt = "createdAt" in right && typeof right.createdAt === "string" ? right.createdAt : right.id;
      return leftCreatedAt.localeCompare(rightCreatedAt) || left.id.localeCompare(right.id);
    });
  }
}

function validateRecord<K extends keyof PublishRecordByKindV0>(kind: K, value: unknown): PublishRecordByKindV0[K] {
  const result = VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function toAuditEvent(record: PublishAttemptRecordV0 | RollbackRetractRecordV0): PublishAuditEventV0 {
  if (record.schema === "pluto.publish.attempt") {
    return {
      schema: "pluto.publish.audit-event",
      schemaVersion: 0,
      id: `audit-${record.id}`,
      eventType: "publish",
      publishPackageId: record.publishPackageId,
      publishAttemptId: record.id,
      recordId: record.id,
      actorId: record.publisher.principalId,
      createdAt: record.createdAt,
      summary: `publish attempt ${record.id} recorded for ${record.channelTarget.channelId}`,
    };
  }

  const eventType: PublishAuditEventV0["eventType"] = record.action === "retract"
    ? "retract"
    : record.action === "supersede"
      ? "supersede"
      : "rollback";

  return {
    schema: "pluto.publish.audit-event",
    schemaVersion: 0,
    id: `audit-${record.id}`,
    eventType,
    publishPackageId: record.publishPackageId,
    publishAttemptId: record.publishAttemptId,
    recordId: record.id,
    actorId: record.actorId,
    createdAt: record.createdAt,
    summary: `${record.action} recorded for publish attempt ${record.publishAttemptId}`,
  };
}
