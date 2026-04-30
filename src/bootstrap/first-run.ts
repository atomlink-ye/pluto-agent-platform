import type {
  DocumentRecordV0,
  VersionProvenanceRefsV0,
  VersionRecordV0,
} from "../contracts/governance.js";
import { toEvidencePacketRefV0, toRunRefV0 } from "../contracts/governance.js";
import type { EvidencePacketV0 } from "../contracts/types.js";

export interface BuildFirstRunRecordsInput {
  workspaceId: string;
  ownerId: string;
  documentTitle: string;
  runId: string;
  runStatus: unknown;
  blockerReason: string | null;
  finishedAt: string | null;
  evidencePacket?: EvidencePacketV0 | null;
}

export interface FirstRunRecordsV0 {
  document: DocumentRecordV0;
  version: VersionRecordV0;
  provenance: VersionProvenanceRefsV0;
}

export function buildFirstRunRecords(input: BuildFirstRunRecordsInput): FirstRunRecordsV0 {
  const documentId = `bootstrap-document-${input.workspaceId}`;
  const versionId = `${documentId}-version-1`;
  const timestamp = input.finishedAt ?? input.evidencePacket?.generatedAt ?? "1970-01-01T00:00:00.000Z";
  const latestRun = toRunRefV0({
    runId: input.runId,
    status: input.runStatus,
    blockerReason: input.blockerReason,
    finishedAt: input.finishedAt,
  });
  const latestEvidence = input.evidencePacket
    ? toEvidencePacketRefV0({
        runId: input.evidencePacket.runId,
        evidencePath: `.pluto/runs/${input.evidencePacket.runId}/evidence.json`,
        validation: input.evidencePacket.validation,
      })
    : undefined;

  const document: DocumentRecordV0 = {
    schemaVersion: 0,
    kind: "document",
    id: documentId,
    workspaceId: input.workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: latestRun.status === "succeeded" ? "ready" : latestRun.status === "blocked" ? "blocked" : "active",
    title: input.documentTitle,
    ownerId: input.ownerId,
    currentVersionId: versionId,
  };

  const version: VersionRecordV0 = {
    schemaVersion: 0,
    kind: "version",
    id: versionId,
    workspaceId: input.workspaceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: document.status,
    documentId,
    createdById: input.ownerId,
    label: "v1-first-artifact",
  };

  return {
    document,
    version,
    provenance: {
      latestRun,
      latestEvidence,
      supportingRuns: [latestRun],
    },
  };
}
