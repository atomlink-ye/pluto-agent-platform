import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  PortableWorkflowDraftSummaryV0,
  PortableWorkflowImportResultV0,
} from "./contracts.js";

export class PortableWorkflowStore {
  private readonly dataDir: string;

  constructor(opts: { dataDir?: string } = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  draftsDir(): string {
    return join(this.dataDir, "portable-workflows");
  }

  dataDirPath(): string {
    return this.dataDir;
  }

  draftPath(draftId: string): string {
    return join(this.draftsDir(), `${draftId}.json`);
  }

  async writeImportResult(result: PortableWorkflowImportResultV0): Promise<string> {
    await mkdir(this.draftsDir(), { recursive: true });
    const path = this.draftPath(result.draftId);
    await writeFile(path, JSON.stringify(result, null, 2) + "\n", "utf8");
    return path;
  }

  async readDraft(draftId: string): Promise<PortableWorkflowImportResultV0 | null> {
    try {
      const raw = await readFile(this.draftPath(draftId), "utf8");
      return JSON.parse(raw) as PortableWorkflowImportResultV0;
    } catch {
      return null;
    }
  }

  async listDrafts(): Promise<PortableWorkflowDraftSummaryV0[]> {
    const drafts = await this.listImportResults();

    return drafts
      .map((draft) => summarizeDraft(draft))
      .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
  }

  async listImportResults(): Promise<PortableWorkflowImportResultV0[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.draftsDir());
    } catch {
      return [];
    }

    const drafts = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            const raw = await readFile(join(this.draftsDir(), entry), "utf8");
            return JSON.parse(raw) as PortableWorkflowImportResultV0;
          } catch {
            return null;
          }
        }),
    );

    return drafts
      .filter((draft): draft is PortableWorkflowImportResultV0 => draft !== null)
      .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
  }
}

export function summarizeDraft(
  draft: PortableWorkflowImportResultV0,
): PortableWorkflowDraftSummaryV0 {
  return {
    schemaVersion: 0,
    draftId: draft.draftId,
    workflowId: draft.bundle?.manifest.workflowId ?? null,
    workflowName: draft.bundle?.manifest.workflowName ?? null,
    mode: draft.mode,
    status: draft.status,
    importedAt: draft.importedAt,
    importable: draft.importable,
    conflictCount: draft.conflicts.length,
  };
}

export function formatPortableWorkflowDraftRef(store: PortableWorkflowStore, draftId: string): string {
  return join(basename(store.dataDirPath()), "portable-workflows", `${draftId}.json`);
}
