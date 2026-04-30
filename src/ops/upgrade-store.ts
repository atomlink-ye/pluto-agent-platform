import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  BackupManifestV0,
  UpgradeGateV0,
  HealthSignalV0,
  RollbackPlaybookV0,
  RuntimePairingStateV0,
  UpgradePlanV0,
  UpgradeRecordSchemaV0,
  UpgradeRunV0,
} from "../contracts/ops.js";
import {
  toBackupManifestV0,
  toUpgradeGateV0,
  toHealthSignalV0,
  toRollbackPlaybookV0,
  toRuntimePairingStateV0,
  toUpgradePlanV0,
  toUpgradeRunV0,
  validateBackupManifestV0,
  validateUpgradeGateV0,
  validateHealthSignalV0,
  validateRollbackPlaybookV0,
  validateRuntimePairingStateV0,
  validateUpgradePlanV0,
  validateUpgradeRunV0,
} from "../contracts/ops.js";
import {
  createUpgradeLocalEventV0,
  toRollbackPlaybookRefV0,
  toUpgradeGateRefV0,
  toUpgradeRunRefV0,
  UpgradeEventStore,
  type UpgradeLocalEventQueryV0,
  type UpgradeLocalEventV0,
} from "./upgrade-events.js";

export interface UpgradeStoreOptions {
  dataDir?: string;
}

type UpgradeRecordBySchemaV0 = {
  "pluto.ops.upgrade-plan": UpgradePlanV0;
  "pluto.ops.upgrade-run": UpgradeRunV0;
  "pluto.ops.backup-manifest": BackupManifestV0;
  "pluto.ops.upgrade-gate": UpgradeGateV0;
  "pluto.ops.health-signal": HealthSignalV0;
  "pluto.ops.rollback-playbook": RollbackPlaybookV0;
  "pluto.ops.runtime-pairing-state": RuntimePairingStateV0;
};

const STORE_DIR_BY_SCHEMA: Record<UpgradeRecordSchemaV0, string> = {
  "pluto.ops.upgrade-plan": "upgrade-plans",
  "pluto.ops.upgrade-run": "upgrade-runs",
  "pluto.ops.backup-manifest": "backup-manifests",
  "pluto.ops.upgrade-gate": "upgrade-gates",
  "pluto.ops.health-signal": "health-signals",
  "pluto.ops.rollback-playbook": "rollback-playbooks",
  "pluto.ops.runtime-pairing-state": "runtime-pairing-states",
};

const WRITER_BY_SCHEMA: {
  [K in UpgradeRecordSchemaV0]: (record: UpgradeRecordBySchemaV0[K] & Record<string, unknown>) => UpgradeRecordBySchemaV0[K];
} = {
  "pluto.ops.upgrade-plan": toUpgradePlanV0,
  "pluto.ops.upgrade-run": toUpgradeRunV0,
  "pluto.ops.backup-manifest": toBackupManifestV0,
  "pluto.ops.upgrade-gate": toUpgradeGateV0,
  "pluto.ops.health-signal": toHealthSignalV0,
  "pluto.ops.rollback-playbook": toRollbackPlaybookV0,
  "pluto.ops.runtime-pairing-state": toRuntimePairingStateV0,
};

const VALIDATOR_BY_SCHEMA: {
  [K in UpgradeRecordSchemaV0]: (value: unknown) => { ok: true; value: UpgradeRecordBySchemaV0[K] } | { ok: false; errors: string[] };
} = {
  "pluto.ops.upgrade-plan": validateUpgradePlanV0,
  "pluto.ops.upgrade-run": validateUpgradeRunV0,
  "pluto.ops.backup-manifest": validateBackupManifestV0,
  "pluto.ops.upgrade-gate": validateUpgradeGateV0,
  "pluto.ops.health-signal": validateHealthSignalV0,
  "pluto.ops.rollback-playbook": validateRollbackPlaybookV0,
  "pluto.ops.runtime-pairing-state": validateRuntimePairingStateV0,
};

export class UpgradeStore {
  private readonly dataDir: string;
  private readonly eventStore: UpgradeEventStore;

  constructor(opts: UpgradeStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
    this.eventStore = new UpgradeEventStore({ dataDir: this.dataDir });
  }

  async put<TSchema extends UpgradeRecordSchemaV0>(
    record: UpgradeRecordBySchemaV0[TSchema],
  ): Promise<UpgradeRecordBySchemaV0[TSchema]> {
    const schema = record.schema as TSchema;
    const previousRun = schema === "pluto.ops.upgrade-run"
      ? await this.get("pluto.ops.upgrade-run", record.id)
      : null;
    const writer = WRITER_BY_SCHEMA[schema] as (
      value: UpgradeRecordBySchemaV0[TSchema] & Record<string, unknown>,
    ) => UpgradeRecordBySchemaV0[TSchema];
    const validated = validateRecord(
      writer(record as UpgradeRecordBySchemaV0[TSchema] & Record<string, unknown>),
      VALIDATOR_BY_SCHEMA[schema],
    );
    await mkdir(this.schemaDir(schema), { recursive: true });
    await writeFile(this.recordPath(schema, record.id), JSON.stringify(validated, null, 2) + "\n", "utf8");
    const event = createLocalAuditEvent(validated, previousRun);
    if (event !== null) {
      await this.eventStore.append(event);
    }
    return validated;
  }

  async get<TSchema extends UpgradeRecordSchemaV0>(
    schema: TSchema,
    id: string,
  ): Promise<UpgradeRecordBySchemaV0[TSchema] | null> {
    try {
      const raw = await readFile(this.recordPath(schema, id), "utf8");
      return validateRecord(JSON.parse(raw), VALIDATOR_BY_SCHEMA[schema]);
    } catch {
      return null;
    }
  }

  async list<TSchema extends UpgradeRecordSchemaV0>(
    schema: TSchema,
    workspaceId?: string,
  ): Promise<Array<UpgradeRecordBySchemaV0[TSchema]>> {
    try {
      const entries = await readdir(this.schemaDir(schema), { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(async (entry) => {
            const raw = await readFile(join(this.schemaDir(schema), entry.name), "utf8");
            return validateRecord(JSON.parse(raw), VALIDATOR_BY_SCHEMA[schema]);
          }),
      );

      if (workspaceId === undefined) {
        return records;
      }

      return records.filter((record) => record.workspaceId === workspaceId);
    } catch {
      return [];
    }
  }

  async appendEvent(event: UpgradeLocalEventV0): Promise<UpgradeLocalEventV0> {
    return this.eventStore.append(event);
  }

  async getEvent(eventId: string): Promise<UpgradeLocalEventV0 | null> {
    return this.eventStore.get(eventId);
  }

  async listEvents(query: UpgradeLocalEventQueryV0 = {}): Promise<UpgradeLocalEventV0[]> {
    return this.eventStore.list(query);
  }

  private upgradeDir(): string {
    return join(this.dataDir, "ops", "upgrade", "local-v0");
  }

  private schemaDir(schema: UpgradeRecordSchemaV0): string {
    return join(this.upgradeDir(), STORE_DIR_BY_SCHEMA[schema]);
  }

  private recordPath(schema: UpgradeRecordSchemaV0, id: string): string {
    return join(this.schemaDir(schema), `${id}.json`);
  }
}

function validateRecord<T>(
  value: unknown,
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
): T {
  const result = validate(value);
  if (!result.ok) {
    throw new Error(`Invalid upgrade record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function createLocalAuditEvent(
  record: UpgradeRecordBySchemaV0[UpgradeRecordSchemaV0],
  previousRun: UpgradeRunV0 | null,
): UpgradeLocalEventV0 | null {
  switch (record.schema) {
    case "pluto.ops.upgrade-run": {
      if (previousRun === null || previousRun.status === record.status) {
        return null;
      }

      return createUpgradeLocalEventV0({
        eventType: record.status === "completed"
          ? "completion_recorded"
          : record.status === "failed"
            ? "failure_recorded"
            : record.status === "rolledBack"
              ? "rollback_recorded"
              : record.status === "running"
                ? "execution_started"
                : "phase_transition_recorded",
        workspaceId: record.workspaceId,
        planId: record.planId,
        upgradeRunId: record.id,
        occurredAt: record.updatedAt,
        actorId: "system",
        subjectRef: toUpgradeRunRefV0(record),
        objectRef: toUpgradeRunRefV0(record),
        evidenceRefs: [...record.evidenceRefs, ...record.backupRefs, ...record.healthRefs, ...record.rollbackRefs],
        details: {
          fromStatus: previousRun.status,
          toStatus: record.status,
          failureReason: record.failureReason,
        },
      });
    }
    case "pluto.ops.upgrade-gate":
      return createUpgradeLocalEventV0({
        eventType: "gate_evaluated",
        workspaceId: record.workspaceId,
        planId: record.planId,
        upgradeRunId: record.upgradeRunId,
        occurredAt: record.checkedAt,
        actorId: "system",
        subjectRef: toUpgradeRunRefV0(stubRunFromRecord(record, record.checkedAt)),
        objectRef: toUpgradeGateRefV0(record),
        evidenceRefs: record.evidenceRefs,
        details: {
          gateKey: record.gateKey,
          status: record.status,
          summary: record.summary,
        },
      });
    case "pluto.ops.rollback-playbook":
      return createUpgradeLocalEventV0({
        eventType: "rollback_prepared",
        workspaceId: record.workspaceId,
        planId: record.planId,
        upgradeRunId: record.upgradeRunId,
        occurredAt: record.updatedAt,
        actorId: "system",
        subjectRef: toUpgradeRunRefV0(stubRunFromRecord(record, record.updatedAt)),
        objectRef: toRollbackPlaybookRefV0(record),
        evidenceRefs: [...record.rollbackRefs, ...record.evidenceRefs],
        details: {
          triggerSummary: record.triggerSummary,
          stepCount: String(record.steps.length),
        },
      });
    default:
      return null;
  }
}

function stubRunFromRecord(
  record: UpgradeGateV0 | RollbackPlaybookV0,
  timestamp: string,
): UpgradeRunV0 {
  return {
    schema: "pluto.ops.upgrade-run",
    schemaVersion: 0,
    id: record.upgradeRunId,
    workspaceId: record.workspaceId,
    planId: record.planId,
    sourceRuntimeVersion: record.sourceRuntimeVersion,
    targetRuntimeVersion: record.targetRuntimeVersion,
    status: "planned",
    approvalRefs: record.approvalRefs,
    backupRefs: record.backupRefs,
    healthRefs: record.healthRefs,
    rollbackRefs: record.rollbackRefs,
    evidenceRefs: record.evidenceRefs,
    lastTransitionAt: timestamp,
    lastTransitionKey: null,
    startedAt: null,
    finishedAt: null,
    failureReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
