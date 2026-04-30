import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SealedPortableBundleV0 } from "./seal.js";

export interface PortableBundleStoreRecordV0 {
  schemaVersion: 0;
  bundleId: string;
  bundleRef: string;
  sealedBundle: SealedPortableBundleV0;
}

export interface PortableBundleStoreSummaryV0 {
  bundleId: string;
  bundleRef: string;
  sealedAt: string;
  manifestChecksum: string;
}

export class PortableBundleStore {
  private readonly dataDir: string;

  constructor(options: { dataDir?: string } = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async writeBundle(sealedBundle: SealedPortableBundleV0): Promise<PortableBundleStoreRecordV0> {
    const record = this.toRecord(sealedBundle);
    await mkdir(this.bundlesDir(), { recursive: true });
    await writeFile(this.bundlePath(sealedBundle.bundle.bundleId), JSON.stringify(record, null, 2) + "\n", "utf8");
    return record;
  }

  async readBundle(bundleId: string): Promise<PortableBundleStoreRecordV0 | null> {
    try {
      const raw = await readFile(this.bundlePath(bundleId), "utf8");
      return JSON.parse(raw) as PortableBundleStoreRecordV0;
    } catch {
      return null;
    }
  }

  async listBundles(): Promise<PortableBundleStoreSummaryV0[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.bundlesDir());
    } catch {
      return [];
    }

    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            const raw = await readFile(join(this.bundlesDir(), entry), "utf8");
            return JSON.parse(raw) as PortableBundleStoreRecordV0;
          } catch {
            return null;
          }
        }),
    );

    return records
      .filter((record): record is PortableBundleStoreRecordV0 => record !== null)
      .map((record) => ({
        bundleId: record.bundleId,
        bundleRef: record.bundleRef,
        sealedAt: record.sealedBundle.seal.sealedAt,
        manifestChecksum: record.sealedBundle.seal.manifestChecksum.digest,
      }))
      .sort((left, right) => right.sealedAt.localeCompare(left.sealedAt));
  }

  bundleRef(bundleId: string): string {
    return `portable-bundle://${bundleId}`;
  }

  private bundlesDir(): string {
    return join(this.dataDir, "portability", "bundles");
  }

  private bundlePath(bundleId: string): string {
    return join(this.bundlesDir(), `${bundleId}.json`);
  }

  private toRecord(sealedBundle: SealedPortableBundleV0): PortableBundleStoreRecordV0 {
    return {
      schemaVersion: 0,
      bundleId: sealedBundle.bundle.bundleId,
      bundleRef: this.bundleRef(sealedBundle.bundle.bundleId),
      sealedBundle,
    };
  }
}
