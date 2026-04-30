import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  InboundWorkItemRecordV0,
  IntegrationRecordKindV0,
  IntegrationRecordV0,
  OutboundTargetRecordV0,
  OutboundWriteRecordV0,
  WebhookDeliveryAttemptV0,
  WebhookSubscriptionRecordV0,
  WorkSourceBindingRecordV0,
  WorkSourceRecordV0,
} from "../contracts/integration.js";
import {
  INTEGRATION_RECORD_KINDS_V0,
  validateInboundWorkItemRecordV0,
  validateOutboundTargetRecordV0,
  validateOutboundWriteRecordV0,
  validateWebhookDeliveryAttemptV0,
  validateWebhookSubscriptionRecordV0,
  validateWorkSourceBindingRecordV0,
  validateWorkSourceRecordV0,
} from "../contracts/integration.js";

export interface IntegrationStoreOptions {
  dataDir?: string;
}

export type IntegrationRecordByKindV0 = {
  work_source: WorkSourceRecordV0;
  work_source_binding: WorkSourceBindingRecordV0;
  inbound_work_item: InboundWorkItemRecordV0;
  outbound_target: OutboundTargetRecordV0;
  outbound_write: OutboundWriteRecordV0;
  webhook_subscription: WebhookSubscriptionRecordV0;
  webhook_delivery_attempt: WebhookDeliveryAttemptV0;
};

type IntegrationRecordValidator<K extends IntegrationRecordKindV0> = (
  value: unknown,
) =>
  | { ok: true; value: IntegrationRecordByKindV0[K] }
  | { ok: false; errors: string[] };

const VALIDATORS: {
  [K in IntegrationRecordKindV0]: IntegrationRecordValidator<K>;
} = {
  work_source: validateWorkSourceRecordV0,
  work_source_binding: validateWorkSourceBindingRecordV0,
  inbound_work_item: validateInboundWorkItemRecordV0,
  outbound_target: validateOutboundTargetRecordV0,
  outbound_write: validateOutboundWriteRecordV0,
  webhook_subscription: validateWebhookSubscriptionRecordV0,
  webhook_delivery_attempt: validateWebhookDeliveryAttemptV0,
};

export function integrationDir(dataDir: string, kind?: IntegrationRecordKindV0): string {
  return kind === undefined
    ? join(dataDir, "integration", "local-v0")
    : join(dataDir, "integration", "local-v0", kind);
}

export class IntegrationStore {
  private readonly dataDir: string;

  constructor(options: IntegrationStoreOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async put<K extends IntegrationRecordKindV0>(
    kind: K,
    record: IntegrationRecordByKindV0[K],
  ): Promise<IntegrationRecordByKindV0[K]> {
    const validated = validateIntegrationRecord(kind, record);
    const dir = integrationDir(this.dataDir, kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${validated.id}.json`);
    await writeFile(path, JSON.stringify(validated, null, 2) + "\n", "utf8");
    return validated;
  }

  async get<K extends IntegrationRecordKindV0>(
    kind: K,
    id: string,
  ): Promise<IntegrationRecordByKindV0[K] | null> {
    const path = join(integrationDir(this.dataDir, kind), `${id}.json`);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null;
    }

    return validateIntegrationRecord(kind, JSON.parse(raw));
  }

  async list<K extends IntegrationRecordKindV0>(kind: K): Promise<Array<IntegrationRecordByKindV0[K]>> {
    let entries: string[];
    try {
      entries = await readdir(integrationDir(this.dataDir, kind));
    } catch {
      return [];
    }

    const ids = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5))
      .sort((left, right) => left.localeCompare(right));

    const records: Array<IntegrationRecordByKindV0[K]> = [];
    for (const id of ids) {
      const record = await this.get(kind, id);
      if (record !== null) {
        records.push(record);
      }
    }

    return records;
  }

  async exists<K extends IntegrationRecordKindV0>(kind: K, id: string): Promise<boolean> {
    try {
      await access(join(integrationDir(this.dataDir, kind), `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  async listKinds(): Promise<IntegrationRecordKindV0[]> {
    return [...INTEGRATION_RECORD_KINDS_V0];
  }
}

function validateIntegrationRecord<K extends IntegrationRecordKindV0>(
  kind: K,
  value: unknown,
): IntegrationRecordByKindV0[K] {
  const result = VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

export type AnyIntegrationRecordV0 = IntegrationRecordV0;
