import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CatalogKind,
  PolicyPackV0,
  SkillCatalogEntryV0,
  SkillDefinitionV0,
  TemplateV0,
  WorkerRoleV0,
} from "./contracts.js";

export type CatalogStoreKind = CatalogKind;

export type CatalogStoreRecordByKind = {
  roles: WorkerRoleV0;
  skills: SkillDefinitionV0;
  templates: TemplateV0;
  "policy-packs": PolicyPackV0;
  entries: SkillCatalogEntryV0;
};

interface CatalogVersionEnvelope<T> {
  schema: "pluto.catalog.version-envelope";
  schemaVersion: 0;
  id: string;
  versions: Record<string, T>;
}

export class CatalogStore {
  private readonly dataDir: string;

  constructor(opts: { dataDir?: string } = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async upsert<T extends CatalogStoreKind>(kind: T, id: string, record: CatalogStoreRecordByKind[T]): Promise<CatalogStoreRecordByKind[T]> {
    await mkdir(this.kindDir(kind), { recursive: true });
    const recordPath = this.recordPath(kind, id);
    const existing = await this.readRecordFile<T>(recordPath);
    const envelope = this.toEnvelope(id, existing);

    envelope.versions[record.version] = record;

    await writeFile(recordPath, JSON.stringify(envelope, null, 2) + "\n", "utf8");
    return record;
  }

  async read<T extends CatalogStoreKind>(kind: T, id: string, version?: string): Promise<CatalogStoreRecordByKind[T] | null> {
    const parsed = await this.readRecordFile<T>(this.recordPath(kind, id));
    if (parsed === null) {
      return null;
    }

    if (!this.isEnvelope(parsed)) {
      if (version && parsed.version !== version) {
        return null;
      }
      return parsed;
    }

    if (version) {
      return parsed.versions[version] ?? null;
    }

    const versions = Object.keys(parsed.versions).sort((a, b) => a.localeCompare(b));
    if (versions.length === 0) {
      return null;
    }
    if (versions.length > 1) {
      throw new Error(`Multiple catalog versions found for ${kind}/${id}; specify a version.`);
    }

    return parsed.versions[versions[0]!] ?? null;
  }

  async list<T extends CatalogStoreKind>(kind: T): Promise<Array<CatalogStoreRecordByKind[T]>> {
    try {
      const entries = await readdir(this.kindDir(kind), { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (entry) => {
            const parsed = await this.readRecordFile<T>(join(this.kindDir(kind), entry.name));
            if (parsed === null) {
              return [];
            }
            if (!this.isEnvelope(parsed)) {
              return [parsed];
            }
            return Object.keys(parsed.versions)
              .sort((a, b) => a.localeCompare(b))
              .map((version) => parsed.versions[version]!) as Array<CatalogStoreRecordByKind[T]>;
          }),
      );
      return records.flat();
    } catch {
      return [];
    }
  }

  private kindDir(kind: CatalogKind): string {
    return join(this.dataDir, "catalog", kind);
  }

  private recordPath(kind: CatalogKind, id: string): string {
    return join(this.kindDir(kind), `${id}.json`);
  }

  private async readRecordFile<T extends CatalogStoreKind>(recordPath: string): Promise<CatalogStoreRecordByKind[T] | CatalogVersionEnvelope<CatalogStoreRecordByKind[T]> | null> {
    try {
      const raw = await readFile(recordPath, "utf8");
      return JSON.parse(raw) as CatalogStoreRecordByKind[T] | CatalogVersionEnvelope<CatalogStoreRecordByKind[T]>;
    } catch {
      return null;
    }
  }

  private toEnvelope<T extends CatalogStoreKind>(id: string, parsed: CatalogStoreRecordByKind[T] | CatalogVersionEnvelope<CatalogStoreRecordByKind[T]> | null): CatalogVersionEnvelope<CatalogStoreRecordByKind[T]> {
    if (parsed && this.isEnvelope(parsed)) {
      return parsed;
    }

    const versions: Record<string, CatalogStoreRecordByKind[T]> = {};
    if (parsed) {
      versions[parsed.version] = parsed;
    }

    return {
      schema: "pluto.catalog.version-envelope",
      schemaVersion: 0,
      id,
      versions,
    };
  }

  private isEnvelope<T extends CatalogStoreKind>(
    parsed: CatalogStoreRecordByKind[T] | CatalogVersionEnvelope<CatalogStoreRecordByKind[T]>,
  ): parsed is CatalogVersionEnvelope<CatalogStoreRecordByKind[T]> {
    return parsed.schema === "pluto.catalog.version-envelope";
  }
}
