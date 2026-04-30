import type { SkillCatalogEntryV0 } from "./contracts.js";
import { CatalogStore } from "./catalog-store.js";

interface CatalogLifecycleContext {
  store?: CatalogStore;
}

export interface SubmitCatalogAssetInput extends CatalogLifecycleContext {
  assetId: string;
  version?: string;
}

export interface ApproveCatalogAssetInput extends CatalogLifecycleContext {
  assetId: string;
  version?: string;
}

export interface DeprecateCatalogAssetInput extends CatalogLifecycleContext {
  assetId: string;
  version?: string;
  replacementEntryId?: string;
  sunsetAt?: string;
  note?: string;
}

export async function submitCatalogAsset(input: SubmitCatalogAssetInput): Promise<SkillCatalogEntryV0> {
  const store = input.store ?? new CatalogStore();
  const entry = await requireEntry(store, input.assetId, input.version);

  const updated: SkillCatalogEntryV0 = {
    ...entry,
    reviewStatus: "submitted",
  };

  await store.upsert("entries", updated.id, updated);
  return updated;
}

export async function approveCatalogAsset(input: ApproveCatalogAssetInput): Promise<SkillCatalogEntryV0> {
  const store = input.store ?? new CatalogStore();
  const entry = await requireEntry(store, input.assetId, input.version);

  const updated: SkillCatalogEntryV0 = {
    ...entry,
    status: "active",
    reviewStatus: "approved",
  };

  await store.upsert("entries", updated.id, updated);
  return updated;
}

export async function deprecateCatalogAsset(input: DeprecateCatalogAssetInput): Promise<SkillCatalogEntryV0> {
  const store = input.store ?? new CatalogStore();
  const entry = await requireEntry(store, input.assetId, input.version);

  const updated: SkillCatalogEntryV0 = {
    ...entry,
    status: "deprecated",
    deprecation: {
      status: "deprecated",
      replacementEntryId: input.replacementEntryId,
      sunsetAt: input.sunsetAt,
      note: input.note,
    },
  };

  await store.upsert("entries", updated.id, updated);
  return updated;
}

async function requireEntry(store: CatalogStore, assetId: string, version?: string): Promise<SkillCatalogEntryV0> {
  const entry = await store.read("entries", assetId, version);
  if (entry === null) {
    throw new Error(version ? `Catalog asset not found: ${assetId}@${version}` : `Catalog asset not found: ${assetId}`);
  }
  return entry;
}
