import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ExtensionInstallV0,
  ExtensionKind,
  ExtensionPackageV0,
  ExtensionSignatureV0,
  MarketplaceListingV0,
  TrustReviewV0,
} from "./contracts.js";

export type ExtensionStoreKind = ExtensionKind;

export type ExtensionStoreRecordByKind = {
  packages: ExtensionPackageV0;
  installs: ExtensionInstallV0;
  "trust-reviews": TrustReviewV0;
  signatures: ExtensionSignatureV0;
  "marketplace-listings": MarketplaceListingV0;
};

export class ExtensionStore {
  private readonly dataDir: string;

  constructor(opts: { dataDir?: string } = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async upsert<T extends ExtensionStoreKind>(kind: T, id: string, record: ExtensionStoreRecordByKind[T]): Promise<ExtensionStoreRecordByKind[T]> {
    await mkdir(this.kindDir(kind), { recursive: true });
    await writeFile(this.recordPath(kind, id), JSON.stringify(record, null, 2) + "\n", "utf8");
    return record;
  }

  async read<T extends ExtensionStoreKind>(kind: T, id: string): Promise<ExtensionStoreRecordByKind[T] | null> {
    try {
      const raw = await readFile(this.recordPath(kind, id), "utf8");
      return JSON.parse(raw) as ExtensionStoreRecordByKind[T];
    } catch {
      return null;
    }
  }

  async list<T extends ExtensionStoreKind>(kind: T): Promise<Array<ExtensionStoreRecordByKind[T]>> {
    try {
      const entries = await readdir(this.kindDir(kind), { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (entry) => {
            const raw = await readFile(join(this.kindDir(kind), entry.name), "utf8");
            return JSON.parse(raw) as ExtensionStoreRecordByKind[T];
          }),
      );
      return records;
    } catch {
      return [];
    }
  }

  private kindDir(kind: ExtensionKind): string {
    return join(this.dataDir, "extensions", kind);
  }

  private recordPath(kind: ExtensionKind, id: string): string {
    return join(this.kindDir(kind), `${id}.json`);
  }
}
