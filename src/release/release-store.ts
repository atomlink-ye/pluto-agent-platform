import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GovernanceEventStore } from "../audit/governance-event-store.js";
import {
  buildReadinessEvaluatedAuditEvent,
  buildWaiverAuditEvents,
} from "../audit/governance-events.js";
import type {
  EvalRubricRefV0,
  EvalRubricSummaryV0,
  QAGateRecordV0,
  ReleaseCandidateRecordV0,
  ReleaseReadinessReportV0,
  WaiverRecordV0,
} from "../contracts/release.js";
import {
  toEvalRubricRefV0,
  toEvalRubricSummaryV0,
  toQAGateRecordV0,
  toReleaseCandidateRecordV0,
  toReleaseReadinessReportV0,
  toWaiverRecordV0,
  validateEvalRubricRefV0,
  validateEvalRubricSummaryV0,
  validateQAGateRecordV0,
  validateReleaseCandidateRecordV0,
  validateReleaseReadinessReportV0,
  validateWaiverRecordV0,
} from "../contracts/release.js";

export interface ReleaseStoreOptions {
  dataDir?: string;
}

type ReleaseRecordByKindV0 = {
  candidate: ReleaseCandidateRecordV0;
  qa_gate: QAGateRecordV0;
  eval_rubric_ref: EvalRubricRefV0;
  eval_rubric_summary: EvalRubricSummaryV0;
  waiver: WaiverRecordV0;
  readiness_report: ReleaseReadinessReportV0;
};

export function releaseDir(dataDir: string, kind?: keyof ReleaseRecordByKindV0): string {
  return kind === undefined
    ? join(dataDir, "release")
    : join(dataDir, "release", kind);
}

export class ReleaseStore {
  private readonly dataDir: string;
  private readonly governanceAuditStore: GovernanceEventStore;

  constructor(opts: ReleaseStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
    this.governanceAuditStore = new GovernanceEventStore({ dataDir: this.dataDir });
  }

  async putReleaseCandidate(value: ReleaseCandidateRecordV0 & Record<string, unknown>): Promise<string> {
    return this.write("candidate", toReleaseCandidateRecordV0(value));
  }

  async getReleaseCandidate(id: string): Promise<ReleaseCandidateRecordV0 | null> {
    return this.read("candidate", id, validateReleaseCandidateRecordV0);
  }

  async listReleaseCandidates(): Promise<ReleaseCandidateRecordV0[]> {
    return this.list("candidate", validateReleaseCandidateRecordV0);
  }

  async putQAGate(value: QAGateRecordV0 & Record<string, unknown>): Promise<string> {
    return this.write("qa_gate", toQAGateRecordV0(value));
  }

  async getQAGate(id: string): Promise<QAGateRecordV0 | null> {
    return this.read("qa_gate", id, validateQAGateRecordV0);
  }

  async listQAGates(): Promise<QAGateRecordV0[]> {
    return this.list("qa_gate", validateQAGateRecordV0);
  }

  async putEvalRubricRef(value: EvalRubricRefV0 & Record<string, unknown>): Promise<string> {
    return this.write("eval_rubric_ref", toEvalRubricRefV0(value));
  }

  async getEvalRubricRef(id: string): Promise<EvalRubricRefV0 | null> {
    return this.read("eval_rubric_ref", id, validateEvalRubricRefV0);
  }

  async listEvalRubricRefs(): Promise<EvalRubricRefV0[]> {
    return this.list("eval_rubric_ref", validateEvalRubricRefV0);
  }

  async putEvalRubricSummary(value: EvalRubricSummaryV0 & Record<string, unknown>): Promise<string> {
    return this.write("eval_rubric_summary", toEvalRubricSummaryV0(value));
  }

  async getEvalRubricSummary(id: string): Promise<EvalRubricSummaryV0 | null> {
    return this.read("eval_rubric_summary", id, validateEvalRubricSummaryV0);
  }

  async listEvalRubricSummaries(): Promise<EvalRubricSummaryV0[]> {
    return this.list("eval_rubric_summary", validateEvalRubricSummaryV0);
  }

  async putWaiver(value: WaiverRecordV0 & Record<string, unknown>): Promise<string> {
    const record = toWaiverRecordV0(value);
    const previous = await this.getWaiver(record.id);
    const path = await this.write("waiver", record);
    await this.governanceAuditStore.appendMany(buildWaiverAuditEvents(record, previous?.status ?? null));
    return path;
  }

  async getWaiver(id: string): Promise<WaiverRecordV0 | null> {
    return this.read("waiver", id, validateWaiverRecordV0);
  }

  async listWaivers(): Promise<WaiverRecordV0[]> {
    return this.list("waiver", validateWaiverRecordV0);
  }

  async putReadinessReport(value: ReleaseReadinessReportV0 & Record<string, unknown>): Promise<string> {
    const record = toReleaseReadinessReportV0(value);
    const previous = await this.getReadinessReport(record.id);
    const candidate = await this.getReleaseCandidate(record.candidateId);
    const path = await this.write("readiness_report", record);
    await this.governanceAuditStore.append(buildReadinessEvaluatedAuditEvent(record, candidate, previous?.status ?? null));
    return path;
  }

  async getReadinessReport(id: string): Promise<ReleaseReadinessReportV0 | null> {
    return this.read("readiness_report", id, validateReleaseReadinessReportV0);
  }

  async listReadinessReports(): Promise<ReleaseReadinessReportV0[]> {
    return this.list("readiness_report", validateReleaseReadinessReportV0);
  }

  private async write<K extends keyof ReleaseRecordByKindV0>(
    kind: K,
    record: ReleaseRecordByKindV0[K],
  ): Promise<string> {
    const dir = releaseDir(this.dataDir, kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${record.id}.json`);
    await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
    return path;
  }

  private async read<K extends keyof ReleaseRecordByKindV0>(
    kind: K,
    id: string,
    validator: (value: unknown) => { ok: true; value: ReleaseRecordByKindV0[K] } | { ok: false; errors: string[] },
  ): Promise<ReleaseRecordByKindV0[K] | null> {
    const path = join(releaseDir(this.dataDir, kind), `${id}.json`);
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

  private async list<K extends keyof ReleaseRecordByKindV0>(
    kind: K,
    validator: (value: unknown) => { ok: true; value: ReleaseRecordByKindV0[K] } | { ok: false; errors: string[] },
  ): Promise<Array<ReleaseRecordByKindV0[K]>> {
    let entries: string[];
    try {
      entries = await readdir(releaseDir(this.dataDir, kind));
    } catch {
      return [];
    }

    const ids = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5))
      .sort((left, right) => left.localeCompare(right));

    const records: Array<ReleaseRecordByKindV0[K]> = [];
    for (const id of ids) {
      const record = await this.read(kind, id, validator);
      if (record !== null) {
        records.push(record);
      }
    }

    return records;
  }
}
