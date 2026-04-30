import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GovernanceEventStore } from "../audit/governance-event-store.js";
import {
  buildDecisionAuditEvents,
  buildDelegationAuditEvent,
  buildReviewRequestedAuditEvent,
} from "../audit/governance-events.js";
import type {
  ApprovalRequestV0,
  DecisionRecordV0,
  DelegationRecordV0,
  ReviewRequestV0,
  SlaOverlayV0,
} from "../contracts/review.js";
import {
  validateApprovalRequestV0,
  validateDecisionRecordV0,
  validateDelegationRecordV0,
  validateReviewRequestV0,
  validateSlaOverlayV0,
} from "../contracts/review.js";

export interface ReviewStoreOptions {
  dataDir?: string;
}

export interface AssignmentRecordV0 {
  schema: "pluto.review.assignment";
  schemaVersion: 0;
  id: string;
  requestId: string;
  requestKind: "review" | "approval";
  actorId: string;
  roleLabel: string;
  assignedAt: string;
  revokedAt: string | null;
  revokedById: string | null;
}

type ReviewStoreRecordKindV0 =
  | "review_request"
  | "approval_request"
  | "decision"
  | "assignment"
  | "delegation"
  | "sla_overlay";

type ReviewStoreRecordByKindV0 = {
  review_request: ReviewRequestV0;
  approval_request: ApprovalRequestV0;
  decision: DecisionRecordV0;
  assignment: AssignmentRecordV0;
  delegation: DelegationRecordV0;
  sla_overlay: SlaOverlayV0;
};

type ReviewStoreValidator<K extends ReviewStoreRecordKindV0> = (value: unknown) =>
  | { ok: true; value: ReviewStoreRecordByKindV0[K] }
  | { ok: false; errors: string[] };

const REVIEW_STORE_VALIDATORS: {
  [K in ReviewStoreRecordKindV0]: ReviewStoreValidator<K>;
} = {
  review_request: validateReviewRequestV0,
  approval_request: validateApprovalRequestV0,
  decision: validateDecisionRecordV0,
  assignment: validateAssignmentRecordV0,
  delegation: validateDelegationRecordV0,
  sla_overlay: validateSlaOverlayV0,
};

export function reviewDir(dataDir: string, kind?: ReviewStoreRecordKindV0): string {
  return kind === undefined
    ? join(dataDir, "review")
    : join(dataDir, "review", kind);
}

export class ReviewStore {
  private readonly dataDir: string;
  private readonly auditStore: GovernanceEventStore;

  constructor(opts: ReviewStoreOptions = {}) {
    this.dataDir = opts.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
    this.auditStore = new GovernanceEventStore({ dataDir: this.dataDir });
  }

  async putReviewRequest(record: ReviewRequestV0): Promise<string> {
    const path = await this.write("review_request", record);
    await this.auditStore.append(buildReviewRequestedAuditEvent(record));
    return path;
  }

  async getReviewRequest(id: string): Promise<ReviewRequestV0 | null> {
    return this.read("review_request", id);
  }

  async listReviewRequests(): Promise<ReviewRequestV0[]> {
    return this.list("review_request");
  }

  async putApprovalRequest(record: ApprovalRequestV0): Promise<string> {
    return this.write("approval_request", record);
  }

  async getApprovalRequest(id: string): Promise<ApprovalRequestV0 | null> {
    return this.read("approval_request", id);
  }

  async listApprovalRequests(): Promise<ApprovalRequestV0[]> {
    return this.list("approval_request");
  }

  async putDecision(record: DecisionRecordV0): Promise<string> {
    const path = await this.write("decision", record);
    await this.auditStore.appendMany(buildDecisionAuditEvents(record));
    return path;
  }

  async getDecision(id: string): Promise<DecisionRecordV0 | null> {
    return this.read("decision", id);
  }

  async listDecisions(): Promise<DecisionRecordV0[]> {
    return this.list("decision");
  }

  async putAssignment(record: AssignmentRecordV0): Promise<string> {
    return this.write("assignment", record);
  }

  async getAssignment(id: string): Promise<AssignmentRecordV0 | null> {
    return this.read("assignment", id);
  }

  async listAssignments(): Promise<AssignmentRecordV0[]> {
    return this.list("assignment");
  }

  async putDelegation(record: DelegationRecordV0): Promise<string> {
    const previous = await this.getDelegation(record.id);
    const path = await this.write("delegation", record);
    await this.auditStore.append(buildDelegationAuditEvent(
      record,
      previous === null ? null : previous.revokedAt === null ? "active" : "revoked",
    ));
    return path;
  }

  async getDelegation(id: string): Promise<DelegationRecordV0 | null> {
    return this.read("delegation", id);
  }

  async listDelegations(): Promise<DelegationRecordV0[]> {
    return this.list("delegation");
  }

  async putSlaOverlay(record: SlaOverlayV0): Promise<string> {
    return this.write("sla_overlay", record);
  }

  async getSlaOverlay(id: string): Promise<SlaOverlayV0 | null> {
    return this.read("sla_overlay", id);
  }

  async listSlaOverlays(): Promise<SlaOverlayV0[]> {
    return this.list("sla_overlay");
  }

  async exists(kind: ReviewStoreRecordKindV0, id: string): Promise<boolean> {
    try {
      await access(join(reviewDir(this.dataDir, kind), `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  private async write<K extends ReviewStoreRecordKindV0>(
    kind: K,
    record: ReviewStoreRecordByKindV0[K],
  ): Promise<string> {
    const validated = validateReviewStoreRecord(kind, record);
    const dir = reviewDir(this.dataDir, kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${validated.id}.json`);
    await writeFile(path, JSON.stringify(validated, null, 2) + "\n", "utf8");
    return path;
  }

  private async read<K extends ReviewStoreRecordKindV0>(
    kind: K,
    id: string,
  ): Promise<ReviewStoreRecordByKindV0[K] | null> {
    const path = join(reviewDir(this.dataDir, kind), `${id}.json`);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return null;
    }

    return validateReviewStoreRecord(kind, JSON.parse(raw));
  }

  private async list<K extends ReviewStoreRecordKindV0>(
    kind: K,
  ): Promise<Array<ReviewStoreRecordByKindV0[K]>> {
    let entries: string[];
    try {
      entries = await readdir(reviewDir(this.dataDir, kind));
    } catch {
      return [];
    }

    const ids = entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.slice(0, -5))
      .sort((left, right) => left.localeCompare(right));

    const records: Array<ReviewStoreRecordByKindV0[K]> = [];
    for (const id of ids) {
      const record = await this.read(kind, id);
      if (record !== null) {
        records.push(record);
      }
    }

    return records;
  }
}

function validateReviewStoreRecord<K extends ReviewStoreRecordKindV0>(
  kind: K,
  value: unknown,
): ReviewStoreRecordByKindV0[K] {
  const result = REVIEW_STORE_VALIDATORS[kind](value);
  if (!result.ok) {
    throw new Error(`Invalid ${kind} record: ${result.errors.join(", ")}`);
  }

  return result.value;
}

function validateAssignmentRecordV0(
  value: unknown,
): { ok: true; value: AssignmentRecordV0 } | { ok: false; errors: string[] } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, errors: ["record must be an object"] };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];

  if (record["schema"] !== "pluto.review.assignment") {
    errors.push("schema must be pluto.review.assignment");
  }

  if (record["schemaVersion"] !== 0) {
    errors.push("schemaVersion must be 0");
  }

  for (const field of ["id", "requestId", "requestKind", "actorId", "roleLabel", "assignedAt"]) {
    if (typeof record[field] !== "string") {
      errors.push(`${field} must be a string`);
    }
  }

  if (record["requestKind"] !== "review" && record["requestKind"] !== "approval") {
    errors.push("requestKind must be review or approval");
  }

  if (record["revokedAt"] !== null && typeof record["revokedAt"] !== "string") {
    errors.push("revokedAt must be a string or null");
  }

  if (record["revokedById"] !== null && typeof record["revokedById"] !== "string") {
    errors.push("revokedById must be a string or null");
  }

  return errors.length === 0
    ? { ok: true, value: record as unknown as AssignmentRecordV0 }
    : { ok: false, errors };
}
