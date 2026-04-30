import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CitationRefV0,
  ProvenanceEdgeV0,
  SealedEvidenceRefV0,
} from "../contracts/evidence-graph.js";
import {
  toCitationRefV0,
  toProvenanceEdgeV0,
  toSealedEvidenceRefV0,
  validateCitationRefV0,
  validateProvenanceEdgeV0,
  validateSealedEvidenceRefV0,
} from "../contracts/evidence-graph.js";

export interface EvidenceGraphStoreOptions {
  dataDir?: string;
}

type EvidenceGraphRecordByKindV0 = {
  sealed_evidence: SealedEvidenceRefV0;
  citation: CitationRefV0;
  provenance_edge: ProvenanceEdgeV0;
};

export function evidenceGraphDir(
  dataDir: string,
  kind?: keyof EvidenceGraphRecordByKindV0,
): string {
  return kind === undefined
    ? join(dataDir, "evidence-graph")
    : join(dataDir, "evidence-graph", kind);
}

export class EvidenceGraphStore {
  private readonly dataDir: string;

  constructor(opts: EvidenceGraphStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
  }

  async putSealedEvidenceRef(value: Parameters<typeof toSealedEvidenceRefV0>[0]): Promise<string> {
    return this.write("sealed_evidence", toSealedEvidenceRefV0(value));
  }

  async getSealedEvidenceRef(id: string): Promise<SealedEvidenceRefV0 | null> {
    return this.read("sealed_evidence", id, validateSealedEvidenceRefV0);
  }

  async listSealedEvidenceRefs(): Promise<SealedEvidenceRefV0[]> {
    return this.list("sealed_evidence", validateSealedEvidenceRefV0);
  }

  async putCitationRef(value: Parameters<typeof toCitationRefV0>[0]): Promise<string> {
    return this.write("citation", toCitationRefV0(value));
  }

  async getCitationRef(id: string): Promise<CitationRefV0 | null> {
    return this.read("citation", id, validateCitationRefV0);
  }

  async listCitationRefs(): Promise<CitationRefV0[]> {
    return this.list("citation", validateCitationRefV0);
  }

  async putProvenanceEdge(value: Parameters<typeof toProvenanceEdgeV0>[0]): Promise<string> {
    return this.write("provenance_edge", toProvenanceEdgeV0(value));
  }

  async getProvenanceEdge(id: string): Promise<ProvenanceEdgeV0 | null> {
    return this.read("provenance_edge", id, validateProvenanceEdgeV0);
  }

  async listProvenanceEdges(): Promise<ProvenanceEdgeV0[]> {
    return this.list("provenance_edge", validateProvenanceEdgeV0);
  }

  private async write<K extends keyof EvidenceGraphRecordByKindV0>(
    kind: K,
    record: EvidenceGraphRecordByKindV0[K],
  ): Promise<string> {
    const dir = evidenceGraphDir(this.dataDir, kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${record.id}.json`);
    await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
    return path;
  }

  private async read<K extends keyof EvidenceGraphRecordByKindV0>(
    kind: K,
    id: string,
    validator: (value: unknown) => { ok: true; value: EvidenceGraphRecordByKindV0[K] } | { ok: false; errors: string[] },
  ): Promise<EvidenceGraphRecordByKindV0[K] | null> {
    const path = join(evidenceGraphDir(this.dataDir, kind), `${id}.json`);
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const validated = validator(parsed);
      if (!validated.ok) {
        throw new Error(`Invalid ${kind} record: ${validated.errors.join(", ")}`);
      }
      return validated.value;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid ")) {
        throw error;
      }
      return null;
    }
  }

  private async list<K extends keyof EvidenceGraphRecordByKindV0>(
    kind: K,
    validator: (value: unknown) => { ok: true; value: EvidenceGraphRecordByKindV0[K] } | { ok: false; errors: string[] },
  ): Promise<Array<EvidenceGraphRecordByKindV0[K]>> {
    let entries: string[];
    try {
      entries = await readdir(evidenceGraphDir(this.dataDir, kind));
    } catch {
      return [];
    }

    const ids = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5))
      .sort((left, right) => left.localeCompare(right));

    const records: Array<EvidenceGraphRecordByKindV0[K]> = [];
    for (const id of ids) {
      const record = await this.read(kind, id, validator);
      if (record !== null) {
        records.push(record);
      }
    }

    return records;
  }
}
