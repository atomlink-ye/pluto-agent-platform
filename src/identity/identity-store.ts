import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ApiTokenRecordV0,
  IdentityKindV0,
  MembershipBindingV0,
  OrgRecordV0,
  ProjectRecordV0,
  ServiceAccountRecordV0,
  UserRecordV0,
  WorkspaceRecordV0,
} from "../contracts/identity.js";
import {
  validateApiTokenRecordV0,
  validateMembershipBindingV0,
  validateOrgRecordV0,
  validateProjectRecordV0,
  validateServiceAccountRecordV0,
  validateUserRecordV0,
  validateWorkspaceRecordV0,
} from "../contracts/identity.js";

export interface IdentityStoreOptions {
  dataDir?: string;
}

export type IdentityRecordByKindV0 = {
  org: OrgRecordV0;
  workspace: WorkspaceRecordV0;
  project: ProjectRecordV0;
  user: UserRecordV0;
  service_account: ServiceAccountRecordV0;
  membership_binding: MembershipBindingV0;
  api_token: ApiTokenRecordV0;
};

type IdentityRecordValidator<K extends IdentityKindV0> = (
  value: unknown,
) =>
  | { ok: true; value: IdentityRecordByKindV0[K] }
  | { ok: false; errors: string[] };

const IDENTITY_VALIDATORS: {
  [K in IdentityKindV0]: IdentityRecordValidator<K>;
} = {
  org: validateOrgRecordV0,
  workspace: validateWorkspaceRecordV0,
  project: validateProjectRecordV0,
  user: validateUserRecordV0,
  service_account: validateServiceAccountRecordV0,
  membership_binding: validateMembershipBindingV0,
  api_token: validateApiTokenRecordV0,
};

export class IdentityStore {
  private readonly dataDir: string;

  constructor(opts: IdentityStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async put<K extends IdentityKindV0>(kind: K, record: IdentityRecordByKindV0[K]): Promise<IdentityRecordByKindV0[K]> {
    const validated = validateIdentityRecord(kind, record);
    await mkdir(this.kindDir(kind), { recursive: true });
    await writeFile(this.recordPath(kind, validated.id), JSON.stringify(validated, null, 2) + "\n", "utf8");
    return validated;
  }

  async get<K extends IdentityKindV0>(kind: K, id: string): Promise<IdentityRecordByKindV0[K] | null> {
    try {
      const raw = await readFile(this.recordPath(kind, id), "utf8");
      return validateIdentityRecord(kind, JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async list<K extends IdentityKindV0>(kind: K): Promise<Array<IdentityRecordByKindV0[K]>> {
    let entries: string[];
    try {
      entries = await readdir(this.kindDir(kind));
    } catch {
      return [];
    }

    const ids = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5))
      .sort((left, right) => left.localeCompare(right));

    const records: Array<IdentityRecordByKindV0[K]> = [];
    for (const id of ids) {
      const record = await this.get(kind, id);
      if (record !== null) {
        records.push(record);
      }
    }

    return records;
  }

  async exists<K extends IdentityKindV0>(kind: K, id: string): Promise<boolean> {
    try {
      await access(this.recordPath(kind, id));
      return true;
    } catch {
      return false;
    }
  }

  private kindDir(kind: IdentityKindV0): string {
    return join(this.dataDir, "identity", kind);
  }

  private recordPath(kind: IdentityKindV0, id: string): string {
    return join(this.kindDir(kind), `${id}.json`);
  }
}

function validateIdentityRecord<K extends IdentityKindV0>(kind: K, value: unknown): IdentityRecordByKindV0[K] {
  const result = IDENTITY_VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}
