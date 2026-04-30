import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ContentBlobRecordV0,
  DeletionRequestV0,
  EventLedgerEntryV0,
  ExternalRefRecordV0,
  LegalHoldOverlayV0,
  MetadataRecordV0,
  RetentionPolicyV0,
  StorageObjectKindV0,
  StorageRecordV0,
  StorageRefV0,
  StorageStatusV0,
  TombstoneRecordV0,
} from "../contracts/storage.js";
import {
  STORAGE_OBJECT_KINDS_V0,
  toStorageStatusV0,
  validateContentBlobRecordV0,
  validateDeletionRequestV0,
  validateEventLedgerEntryV0,
  validateExternalRefRecordV0,
  validateLegalHoldOverlayV0,
  validateMetadataRecordV0,
  validateRetentionPolicyV0,
  validateTombstoneRecordV0,
} from "../contracts/storage.js";

export interface StorageStoreOptions {
  dataDir?: string;
}

export type StorageRecordByKindV0 = {
  metadata: MetadataRecordV0;
  content_blob: ContentBlobRecordV0;
  external_ref: ExternalRefRecordV0;
  event_ledger: EventLedgerEntryV0;
  retention_policy: RetentionPolicyV0;
  deletion_request: DeletionRequestV0;
  tombstone: TombstoneRecordV0;
  legal_hold_overlay: LegalHoldOverlayV0;
};

type StorageRecordValidator<K extends StorageObjectKindV0> = (
  value: unknown,
) => { ok: true; value: StorageRecordByKindV0[K] } | { ok: false; errors: string[] };

const STORAGE_VALIDATORS: {
  [K in StorageObjectKindV0]: StorageRecordValidator<K>;
} = {
  metadata: validateMetadataRecordV0,
  content_blob: validateContentBlobRecordV0,
  external_ref: validateExternalRefRecordV0,
  event_ledger: validateEventLedgerEntryV0,
  retention_policy: validateRetentionPolicyV0,
  deletion_request: validateDeletionRequestV0,
  tombstone: validateTombstoneRecordV0,
  legal_hold_overlay: validateLegalHoldOverlayV0,
};

export class StorageStore {
  private readonly dataDir: string;

  constructor(opts: StorageStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async put<K extends StorageObjectKindV0>(
    kind: K,
    record: StorageRecordByKindV0[K],
  ): Promise<StorageStatusV0> {
    const validated = validateStorageRecord(kind, record);
    await mkdir(this.kindDir(kind), { recursive: true });
    await writeFile(this.recordPath(kind, validated.id), JSON.stringify(validated, null, 2) + "\n", "utf8");
    return toStorageStatusV0(validated);
  }

  async get<K extends StorageObjectKindV0>(kind: K, id: string): Promise<StorageRecordByKindV0[K] | null> {
    const parsed = await this.readRecordFile(kind, id);
    if (parsed === null) {
      return null;
    }

    return validateStorageRecord(kind, parsed);
  }

  async getStatus(ref: StorageRefV0): Promise<StorageStatusV0 | null> {
    const record = await this.get(ref.kind, ref.recordId);
    return record === null ? null : toStorageStatusV0(record);
  }

  async list<K extends StorageObjectKindV0>(kind: K): Promise<Array<StorageRecordByKindV0[K]>> {
    try {
      const entries = await readdir(this.kindDir(kind), { withFileTypes: true });
      const ids = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => entry.name.slice(0, -5));

      const records: Array<StorageRecordByKindV0[K]> = [];
      for (const id of ids) {
        const record = await this.get(kind, id);
        if (record !== null) {
          records.push(record);
        }
      }

      return records;
    } catch {
      return [];
    }
  }

  async listStatuses<K extends StorageObjectKindV0>(kind: K): Promise<Array<StorageStatusV0>> {
    const records = await this.list(kind);
    return records.map((record) => toStorageStatusV0(record));
  }

  async listKinds(): Promise<StorageObjectKindV0[]> {
    return [...STORAGE_OBJECT_KINDS_V0];
  }

  async delete(kind: StorageObjectKindV0, id: string): Promise<boolean> {
    try {
      await rm(this.recordPath(kind, id), { force: true });
      return true;
    } catch {
      return false;
    }
  }

  private kindDir(kind: StorageObjectKindV0): string {
    return join(this.dataDir, "storage", kind);
  }

  private recordPath(kind: StorageObjectKindV0, id: string): string {
    return join(this.kindDir(kind), `${id}.json`);
  }

  private async readRecordFile<K extends StorageObjectKindV0>(
    kind: K,
    id: string,
  ): Promise<StorageRecordByKindV0[K] | null> {
    try {
      const raw = await readFile(this.recordPath(kind, id), "utf8");
      return JSON.parse(raw) as StorageRecordByKindV0[K];
    } catch {
      return null;
    }
  }
}

function validateStorageRecord<K extends StorageObjectKindV0>(kind: K, value: unknown): StorageRecordByKindV0[K] {
  const result = STORAGE_VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

export type AnyStorageRecordV0 = StorageRecordV0;
