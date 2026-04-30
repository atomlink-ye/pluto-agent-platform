import type { WorkspaceScopedRefV0 } from "../contracts/identity.js";
import { toRunRefV0 } from "../contracts/governance.js";
import type { EvidencePacketV0 } from "../contracts/types.js";
import { buildDocumentDetailProjection } from "../governance/projections.js";
import { evaluateEvidenceReadiness, type EvidenceReadinessV0 } from "./evidence-readiness.js";
import { buildFirstRunRecords } from "./first-run.js";

export interface BuildFirstArtifactChainInput {
  workspaceStatus: {
    status: string;
    workspaceRef: WorkspaceScopedRefV0;
  };
  workspaceId: string;
  ownerId: string;
  documentTitle: string;
  runId: string;
  runStatus: unknown;
  blockerReason: string | null;
  finishedAt: string | null;
  evidencePacket: EvidencePacketV0;
  artifactMarkdown: string;
  sealedEvidence: unknown;
}

export interface FirstArtifactChainV0 {
  status: EvidenceReadinessV0["status"];
  workspace: {
    status: string;
    ref: WorkspaceScopedRefV0;
  };
  document: NonNullable<ReturnType<typeof buildDocumentDetailProjection>>;
  version: ReturnType<typeof buildFirstRunRecords>["version"];
  run: ReturnType<typeof toRunRefV0>;
  artifact: {
    markdown: string;
    nonEmpty: boolean;
  };
  evidence: {
    packet: EvidencePacketV0;
    sealedEvidence: unknown;
    readiness: EvidenceReadinessV0;
  };
  blockedReasons: string[];
  degradedReasons: string[];
}

export function buildFirstArtifactChain(input: BuildFirstArtifactChainInput): FirstArtifactChainV0 {
  const firstRun = buildFirstRunRecords({
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    documentTitle: input.documentTitle,
    runId: input.runId,
    runStatus: input.runStatus,
    blockerReason: input.blockerReason,
    finishedAt: input.finishedAt,
    evidencePacket: input.evidencePacket,
  });
  const document = buildDocumentDetailProjection({
    document: firstRun.document,
    versions: [firstRun.version],
    provenanceByVersionId: { [firstRun.version.id]: firstRun.provenance },
    runtimeAvailable: true,
  });

  if (document === null) {
    throw new Error("first artifact chain requires a document projection");
  }

  const readiness = evaluateEvidenceReadiness({
    run: {
      runId: input.runId,
      status: input.runStatus,
      blockerReason: input.blockerReason,
      finishedAt: input.finishedAt,
    },
    artifactMarkdown: input.artifactMarkdown,
    evidencePacket: input.evidencePacket,
    sealedEvidence: input.sealedEvidence,
    documentProjection: document,
  });

  return {
    status: readiness.status,
    workspace: {
      status: input.workspaceStatus.status,
      ref: input.workspaceStatus.workspaceRef,
    },
    document,
    version: firstRun.version,
    run: toRunRefV0({
      runId: input.runId,
      status: input.runStatus,
      blockerReason: input.blockerReason,
      finishedAt: input.finishedAt,
    }),
    artifact: {
      markdown: input.artifactMarkdown,
      nonEmpty: input.artifactMarkdown.trim().length > 0,
    },
    evidence: {
      packet: input.evidencePacket,
      sealedEvidence: input.sealedEvidence,
      readiness,
    },
    blockedReasons: readiness.blockedReasons,
    degradedReasons: readiness.degradedReasons,
  };
}
