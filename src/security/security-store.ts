import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AuditEventV0,
  RedactionPolicyV0,
  RedactionResultV0,
  ScopedToolPermitV0,
  SecretRefV0,
} from "../contracts/security.js";
import {
  validateAuditEventV0,
  validateRedactionPolicyV0,
  validateRedactionResultV0,
  validateScopedToolPermitV0,
  validateSecretRefV0,
} from "../contracts/security.js";

export interface SecurityStoreOptions {
  dataDir?: string;
}

type SecurityRecordKind = "secret-refs" | "permits" | "redaction-policies" | "redaction-results" | "audit-events";

export class SecurityStore {
  private readonly dataDir: string;

  constructor(opts: SecurityStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async putSecretRef(record: SecretRefV0): Promise<SecretRefV0> {
    return this.putRecord("secret-refs", record.name, record, validateSecretRefV0);
  }

  async getSecretRef(name: string): Promise<SecretRefV0 | null> {
    return this.getRecord("secret-refs", name, validateSecretRefV0);
  }

  async listSecretRefs(workspaceId?: string): Promise<SecretRefV0[]> {
    return this.listRecords("secret-refs", validateSecretRefV0, workspaceId);
  }

  async putPermit(record: ScopedToolPermitV0): Promise<ScopedToolPermitV0> {
    return this.putRecord("permits", record.permitId, record, validateScopedToolPermitV0);
  }

  async getPermit(permitId: string): Promise<ScopedToolPermitV0 | null> {
    return this.getRecord("permits", permitId, validateScopedToolPermitV0);
  }

  async listPermits(workspaceId?: string): Promise<ScopedToolPermitV0[]> {
    return this.listRecords("permits", validateScopedToolPermitV0, workspaceId);
  }

  async putRedactionPolicy(record: RedactionPolicyV0): Promise<RedactionPolicyV0> {
    return this.putRecord("redaction-policies", record.policyId, record, validateRedactionPolicyV0);
  }

  async getRedactionPolicy(policyId: string): Promise<RedactionPolicyV0 | null> {
    return this.getRecord("redaction-policies", policyId, validateRedactionPolicyV0);
  }

  async putRedactionResult(record: RedactionResultV0): Promise<RedactionResultV0> {
    return this.putRecord("redaction-results", record.resultId, record, validateRedactionResultV0);
  }

  async getRedactionResult(resultId: string): Promise<RedactionResultV0 | null> {
    return this.getRecord("redaction-results", resultId, validateRedactionResultV0);
  }

  async appendAuditEvent(record: AuditEventV0): Promise<AuditEventV0> {
    return this.putRecord("audit-events", record.eventId, record, validateAuditEventV0);
  }

  async getAuditEvent(eventId: string): Promise<AuditEventV0 | null> {
    return this.getRecord("audit-events", eventId, validateAuditEventV0);
  }

  async listAuditEvents(workspaceId?: string): Promise<AuditEventV0[]> {
    return this.listRecords("audit-events", validateAuditEventV0, workspaceId);
  }

  private async putRecord<T>(
    kind: SecurityRecordKind,
    id: string,
    record: T,
    validate: (value: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
  ): Promise<T> {
    const validated = validateRecord(record, validate);
    await mkdir(this.kindDir(kind), { recursive: true });
    await writeFile(this.recordPath(kind, id), JSON.stringify(validated, null, 2) + "\n", "utf8");
    return validated;
  }

  private async getRecord<T>(
    kind: SecurityRecordKind,
    id: string,
    validate: (value: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
  ): Promise<T | null> {
    try {
      const raw = await readFile(this.recordPath(kind, id), "utf8");
      return validateRecord(JSON.parse(raw), validate);
    } catch {
      return null;
    }
  }

  private async listRecords<T>(
    kind: SecurityRecordKind,
    validate: (value: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
    workspaceId?: string,
  ): Promise<T[]> {
    try {
      const entries = await readdir(this.kindDir(kind), { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(async (entry) => {
            const raw = await readFile(join(this.kindDir(kind), entry.name), "utf8");
            return validateRecord(JSON.parse(raw), validate);
          }),
      );

      if (workspaceId === undefined) return records;
      return records.filter((record) => hasWorkspaceId(record, workspaceId));
    } catch {
      return [];
    }
  }

  private securityDir(): string {
    return join(this.dataDir, "security", "local-v0");
  }

  private kindDir(kind: SecurityRecordKind): string {
    return join(this.securityDir(), kind);
  }

  private recordPath(kind: SecurityRecordKind, id: string): string {
    return join(this.kindDir(kind), `${id}.json`);
  }
}

function validateRecord<T>(
  value: unknown,
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; errors: string[] },
): T {
  const result = validate(value);
  if (!result.ok) {
    throw new Error(`Invalid security record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function hasWorkspaceId(value: unknown, workspaceId: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (value as { workspaceId?: unknown }).workspaceId === workspaceId;
}
