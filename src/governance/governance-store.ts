import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ApprovalRecordV0,
  DocumentRecordV0,
  GovernanceObjectKindV0,
  GovernanceRecordV0,
  PlaybookRecordV0,
  PublishPackageRecordV0,
  ReviewRecordV0,
  ScheduleRecordV0,
  ScenarioRecordV0,
  VersionRecordV0,
} from "../contracts/governance.js";
import {
  GOVERNANCE_OBJECT_KINDS_V0,
  validateApprovalRecordV0,
  validateDocumentRecordV0,
  validatePlaybookRecordV0,
  validatePublishPackageRecordV0,
  validateReviewRecordV0,
  validateScheduleRecordV0,
  validateScenarioRecordV0,
  validateVersionRecordV0,
} from "../contracts/governance.js";

export interface GovernanceStoreOptions {
  dataDir?: string;
}

export type GovernanceRecordByKindV0 = {
  document: DocumentRecordV0;
  version: VersionRecordV0;
  review: ReviewRecordV0;
  approval: ApprovalRecordV0;
  publish_package: PublishPackageRecordV0;
  playbook: PlaybookRecordV0;
  scenario: ScenarioRecordV0;
  schedule: ScheduleRecordV0;
};

type GovernanceRecordValidator<K extends GovernanceObjectKindV0> = (
  value: unknown,
) =>
  | { ok: true; value: GovernanceRecordByKindV0[K] }
  | { ok: false; errors: string[] };

const GOVERNANCE_VALIDATORS: {
  [K in GovernanceObjectKindV0]: GovernanceRecordValidator<K>;
} = {
  document: validateDocumentRecordV0,
  version: validateVersionRecordV0,
  review: validateReviewRecordV0,
  approval: validateApprovalRecordV0,
  publish_package: validatePublishPackageRecordV0,
  playbook: validatePlaybookRecordV0,
  scenario: validateScenarioRecordV0,
  schedule: validateScheduleRecordV0,
};

export function governanceDir(dataDir: string, kind?: GovernanceObjectKindV0): string {
  return kind === undefined
    ? join(dataDir, "governance")
    : join(dataDir, "governance", kind);
}

export class GovernanceStore {
  private readonly dataDir: string;

  constructor(opts: GovernanceStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async put<K extends GovernanceObjectKindV0>(
    kind: K,
    record: GovernanceRecordByKindV0[K],
  ): Promise<string> {
    const validated = validateGovernanceRecord(kind, record);
    const dir = governanceDir(this.dataDir, kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${validated.id}.json`);
    await writeFile(path, JSON.stringify(validated, null, 2) + "\n", "utf8");
    return path;
  }

  async get<K extends GovernanceObjectKindV0>(
    kind: K,
    id: string,
  ): Promise<GovernanceRecordByKindV0[K] | null> {
    const path = join(governanceDir(this.dataDir, kind), `${id}.json`);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null;
    }

    return validateGovernanceRecord(kind, JSON.parse(raw));
  }

  async list<K extends GovernanceObjectKindV0>(
    kind: K,
  ): Promise<Array<GovernanceRecordByKindV0[K]>> {
    let entries: string[];
    try {
      entries = await readdir(governanceDir(this.dataDir, kind));
    } catch {
      return [];
    }

    const ids = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5))
      .sort((left, right) => left.localeCompare(right));

    const records: Array<GovernanceRecordByKindV0[K]> = [];
    for (const id of ids) {
      const record = await this.get(kind, id);
      if (record !== null) {
        records.push(record);
      }
    }

    return records;
  }

  async exists<K extends GovernanceObjectKindV0>(kind: K, id: string): Promise<boolean> {
    try {
      await access(join(governanceDir(this.dataDir, kind), `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  async listKinds(): Promise<GovernanceObjectKindV0[]> {
    return [...GOVERNANCE_OBJECT_KINDS_V0];
  }
}

function validateGovernanceRecord<K extends GovernanceObjectKindV0>(
  kind: K,
  value: unknown,
): GovernanceRecordByKindV0[K] {
  const result = GOVERNANCE_VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

export type AnyGovernanceRecordV0 = GovernanceRecordV0;
