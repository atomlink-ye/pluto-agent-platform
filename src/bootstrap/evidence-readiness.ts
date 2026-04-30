import { assertEvidenceUsableForGovernance } from "../evidence/seal.js";
import { validateEvidencePacketV0 } from "../orchestrator/evidence.js";

export interface EvidenceReadinessDocumentProjectionV0 {
  pageState?: string;
  currentVersion: { id: string } | null;
  evidence: Array<{ runId: string; evidencePath: string; validationOutcome: string }>;
  recentRuns: Array<{ runId: string; status: string; blockerReason: string | null; finishedAt: string | null }>;
}

export interface EvaluateEvidenceReadinessInput {
  run: {
    runId: string;
    status: unknown;
    blockerReason: string | null;
    finishedAt: string | null;
  };
  artifactMarkdown: string;
  evidencePacket: unknown;
  sealedEvidence: unknown;
  documentProjection: EvidenceReadinessDocumentProjectionV0 | null;
}

export interface EvidenceReadinessV0 {
  status: "ready" | "blocked" | "degraded";
  reviewReady: boolean;
  artifactNonEmpty: boolean;
  blockedReasons: string[];
  degradedReasons: string[];
}

export function evaluateEvidenceReadiness(input: EvaluateEvidenceReadinessInput): EvidenceReadinessV0 {
  const blockedReasons: string[] = [];
  const degradedReasons: string[] = [];
  const artifactNonEmpty = input.artifactMarkdown.trim().length > 0;
  const reviewReady = input.documentProjection !== null
    && input.documentProjection.currentVersion !== null
    && input.documentProjection.evidence.length > 0
    && input.documentProjection.recentRuns.length > 0;

  if (!artifactNonEmpty) {
    blockedReasons.push("empty_artifact");
  }

  const packetValidation = validateEvidencePacketV0(input.evidencePacket);
  if (!packetValidation.ok) {
    blockedReasons.push("invalid_evidence_packet");
  }

  try {
    assertEvidenceUsableForGovernance(input.sealedEvidence, input.evidencePacket);
  } catch {
    blockedReasons.push("missing_sealed_evidence");
  }

  if (input.documentProjection === null || input.documentProjection.evidence.length === 0) {
    degradedReasons.push("missing_evidence_surface");
  }
  if (input.documentProjection === null || input.documentProjection.recentRuns.length === 0) {
    degradedReasons.push("missing_run_surface");
  }

  return {
    status: blockedReasons.length > 0 ? "blocked" : degradedReasons.length > 0 ? "degraded" : "ready",
    reviewReady,
    artifactNonEmpty,
    blockedReasons,
    degradedReasons,
  };
}
