import type {
  AgentEvent,
  CoordinationTranscriptRefV0,
  EvidencePacketV0,
  ProvenancePinRef,
  StageDependencyTrace,
  WorkerContribution,
  WorkerContributionProvenancePins,
} from "../../contracts/types.js";
import {
  collectPortableRuntimeResultRefs,
  readPortableRuntimeResultValueRef,
  type PortableRuntimeResultAnyRefV0,
  type PortableRuntimeResultValueKeyV0,
} from "../../runtime/result-contract.js";
import { redactObject, redactString, redactWorkspacePath } from "../redactor.js";
import type { TeamTask, TeamRunResult } from "../../contracts/types.js";
import { normalizeBlockerReason } from "../blocker-classifier.js";

export interface GenerateEvidenceInput {
  task: TeamTask;
  result: TeamRunResult;
  events: AgentEvent[];
  startedAt: Date;
  finishedAt: Date;
  blockerReason: BlockerReasonV0 | null;
  runtimeResultRefs?: TeamRunResult["runtimeResultRefs"];
  transcriptRef?: CoordinationTranscriptRefV0;
}

interface WorkerEvidenceAccumulator {
  sessionId: string | null;
  output: string;
  referenceOnly: boolean;
  referenceSummaryFromPayload: boolean;
  provenance: WorkerContributionProvenancePins;
}

export function mapStatus(result: TeamRunResult, blockerReason: BlockerReasonV0 | null): EvidencePacketStatusV0 {
  if ((result.status === "completed" || result.status === "completed_with_escalation" || result.status === "completed_with_warnings") && !blockerReason) return "done";
  if (blockerReason) return "blocked";
  return "failed";
}

export function extractValidation(
  events: AgentEvent[],
  resolveEventValue: (event: AgentEvent, key: PortableRuntimeResultValueKeyV0) => string,
): EvidencePacketV0["validation"] {
  const evalEvents = events.filter(
    (e) => e.roleId === "evaluator" && e.type === "worker_completed",
  );
  if (evalEvents.length === 0) return { outcome: "na", reason: null };

  const lastEval = evalEvents[evalEvents.length - 1]!;
  const output = resolveEventValue(lastEval, "output");
  if (output.startsWith("PASS:")) {
    return { outcome: "pass", reason: output.slice(5).trim() || null };
  }
  if (output.startsWith("FAIL:")) {
    return { outcome: "fail", reason: output.slice(5).trim() || null };
  }
  return { outcome: "na", reason: null };
}

export function extractRisksAndQuestions(
  events: AgentEvent[],
  resolveEventValue: (event: AgentEvent, key: PortableRuntimeResultValueKeyV0) => string,
): { risks: string[]; openQuestions: string[] } {
  const risks: string[] = [];
  const openQuestions: string[] = [];

  for (const ev of events) {
    if (ev.roleId === "evaluator" && ev.type === "worker_completed") {
      const output = resolveEventValue(ev, "output");
      if (output.includes("FAIL:")) {
        risks.push(output.replace(/^FAIL:\s*/, "").trim());
      }
    }

    if (ev.type === "mailbox_transport_post_failed") {
      const message = typeof ev.payload["message"] === "string"
        ? ev.payload["message"]
        : "Mailbox transport post failed.";
      risks.push(message);
    }

    if (ev.type === "mailbox_transport_envelope_rejected") {
      const reason = typeof ev.payload["reason"] === "string"
        ? ev.payload["reason"]
        : "unknown";
      const detail = typeof ev.payload["detail"] === "string"
        ? ev.payload["detail"]
        : null;
      risks.push(detail ? `Mailbox envelope rejected (${reason}): ${detail}` : `Mailbox envelope rejected (${reason}).`);
    }

    if (ev.type === "mailbox_transport_parity_drift") {
      risks.push("Mailbox transport parity drift detected.");
      const missing = Array.isArray(ev.payload["missing"]) ? ev.payload["missing"] as unknown[] : [];
      const extra = Array.isArray(ev.payload["extra"]) ? ev.payload["extra"] as unknown[] : [];
      if (missing.length || extra.length) {
        openQuestions.push(`Parity drift missing=${missing.length} extra=${extra.length}`);
      }
    }
  }

  return { risks, openQuestions };
}

export function extractOrchestrationEvidence(
  startEvent: AgentEvent | undefined,
  completedEvent?: AgentEvent,
  transcriptRef?: CoordinationTranscriptRefV0,
): EvidencePacketV0["orchestration"] | null {
  const payload = startEvent?.payload;
  if (!payload) return null;
  const completionPayload = completedEvent?.payload ?? {};
  const playbook = typeof payload["playbook"] === "object" && payload["playbook"] !== null
    ? payload["playbook"] as Record<string, unknown>
    : null;
  const transcript = typeof payload["transcript"] === "object" && payload["transcript"] !== null
    ? payload["transcript"] as Record<string, unknown>
    : null;
  const playbookId = payload["playbookId"] ?? playbook?.["id"];
  const orchestrationSource = payload["orchestrationSource"] ?? playbook?.["orchestrationSource"];
  const orchestrationMode = payload["orchestrationMode"] ?? completionPayload["orchestrationMode"];
  const transcriptRefPath = transcriptRef?.path ?? transcript?.["path"];
  const transcriptRefRoom = transcriptRef?.roomRef ?? transcript?.["roomRef"];
  const transcriptRefKind = transcriptRef?.kind ?? transcript?.["kind"];
  const dependencyTrace = Array.isArray(completionPayload["dependencyTrace"])
    ? completionPayload["dependencyTrace"] as StageDependencyTrace[]
    : undefined;
  const revisions = Array.isArray(completionPayload["revisions"])
    ? completionPayload["revisions"] as NonNullable<EvidencePacketV0["orchestration"]>["revisions"]
    : undefined;
  const escalation = typeof completionPayload["escalation"] === "object" && completionPayload["escalation"] !== null
    ? completionPayload["escalation"] as NonNullable<EvidencePacketV0["orchestration"]>["escalation"]
    : undefined;
  const finalReconciliation = typeof completionPayload["finalReconciliation"] === "object" && completionPayload["finalReconciliation"] !== null
    ? completionPayload["finalReconciliation"] as NonNullable<EvidencePacketV0["orchestration"]>["finalReconciliation"]
    : undefined;
  if (
    typeof playbookId !== "string" ||
    typeof orchestrationSource !== "string" ||
    typeof transcriptRefPath !== "string" ||
    typeof transcriptRefRoom !== "string" ||
    typeof transcriptRefKind !== "string"
  ) {
    return null;
  }
  return {
    playbookId: redactString(playbookId),
    orchestrationSource: redactString(orchestrationSource),
    ...(typeof orchestrationMode === "string" ? { orchestrationMode: redactString(orchestrationMode) as "teamlead_direct" | "lead_marker" } : {}),
    ...(dependencyTrace ? { dependencyTrace: redactObject(dependencyTrace) as StageDependencyTrace[] } : {}),
    ...(revisions ? { revisions: redactObject(revisions) as NonNullable<EvidencePacketV0["orchestration"]>["revisions"] } : {}),
    ...(escalation ? { escalation: redactObject(escalation) as NonNullable<EvidencePacketV0["orchestration"]>["escalation"] } : {}),
    ...(finalReconciliation ? { finalReconciliation: redactObject(finalReconciliation) as NonNullable<EvidencePacketV0["orchestration"]>["finalReconciliation"] } : {}),
    transcript: {
      kind: redactString(transcriptRefKind) as "file" | "shared_channel",
      path: redactString(transcriptRefPath),
      roomRef: redactString(transcriptRefRoom),
    },
  };
}

function redactForPacket(value: unknown): unknown {
  // Simple redaction for evidence packet - use imported redactObject
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactForPacket);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactForPacket(v)]),
    );
  }
  return value;
}

export function extractContributionProvenance(
  contribution: WorkerContribution | undefined,
): WorkerContributionProvenancePins {
  if (!contribution) {
    return {};
  }

  return {
    ...(contribution.workerRoleRef ? { workerRoleRef: cloneRef(contribution.workerRoleRef) } : {}),
    ...(contribution.skillRef ? { skillRef: cloneRef(contribution.skillRef) } : {}),
    ...(contribution.templateRef ? { templateRef: cloneRef(contribution.templateRef) } : {}),
    ...(contribution.policyPackRefs ? { policyPackRefs: contribution.policyPackRefs.map(cloneRef) } : {}),
    ...(contribution.catalogEntryRef ? { catalogEntryRef: cloneRef(contribution.catalogEntryRef) } : {}),
    ...(contribution.extensionInstallRef !== undefined
      ? { extensionInstallRef: contribution.extensionInstallRef }
      : {}),
  };
}

export function extractCatalogSelectionProvenance(selection: unknown): WorkerContributionProvenancePins {
  if (typeof selection !== "object" || selection === null) {
    return {};
  }

  const candidate = selection as Record<string, unknown>;
  const workerRoleRef = readProvenanceRef(candidate["workerRole"]);
  const skillRef = readProvenanceRef(candidate["skill"]);
  const templateRef = readProvenanceRef(candidate["template"]);
  const policyPackRef = readProvenanceRef(candidate["policyPack"]);
  const catalogEntryRef = readProvenanceRef(candidate["entry"]);

  return {
    ...(workerRoleRef ? { workerRoleRef } : {}),
    ...(skillRef ? { skillRef } : {}),
    ...(templateRef ? { templateRef } : {}),
    ...(policyPackRef ? { policyPackRefs: [policyPackRef] } : {}),
    ...(catalogEntryRef ? { catalogEntryRef } : {}),
  };
}

export function readProvenanceRef(value: unknown): ProvenancePinRef | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const ref = value as Record<string, unknown>;
  if (typeof ref["id"] !== "string" || typeof ref["version"] !== "string") {
    return undefined;
  }

  return { id: ref["id"], version: ref["version"] };
}

export function mergeProvenancePins(
  primary: WorkerContributionProvenancePins,
  fallback: WorkerContributionProvenancePins,
): WorkerContributionProvenancePins {
  return {
    ...(fallback.workerRoleRef ? { workerRoleRef: cloneRef(fallback.workerRoleRef) } : {}),
    ...(fallback.skillRef ? { skillRef: cloneRef(fallback.skillRef) } : {}),
    ...(fallback.templateRef ? { templateRef: cloneRef(fallback.templateRef) } : {}),
    ...(fallback.policyPackRefs ? { policyPackRefs: fallback.policyPackRefs.map(cloneRef) } : {}),
    ...(fallback.catalogEntryRef ? { catalogEntryRef: cloneRef(fallback.catalogEntryRef) } : {}),
    ...(fallback.extensionInstallRef !== undefined ? { extensionInstallRef: fallback.extensionInstallRef } : {}),
    ...(primary.workerRoleRef ? { workerRoleRef: cloneRef(primary.workerRoleRef) } : {}),
    ...(primary.skillRef ? { skillRef: cloneRef(primary.skillRef) } : {}),
    ...(primary.templateRef ? { templateRef: cloneRef(primary.templateRef) } : {}),
    ...(primary.policyPackRefs ? { policyPackRefs: primary.policyPackRefs.map(cloneRef) } : {}),
    ...(primary.catalogEntryRef ? { catalogEntryRef: cloneRef(primary.catalogEntryRef) } : {}),
    ...(primary.extensionInstallRef !== undefined ? { extensionInstallRef: primary.extensionInstallRef } : {}),
  };
}

export function cloneRef(ref: ProvenancePinRef): ProvenancePinRef {
  return { id: ref.id, version: ref.version };
}

export function usesReferenceOnlyPersistence(events: readonly AgentEvent[]): boolean {
  return events.some(
    (event) => isReferenceOnlyEventValue(event, "output") || isReferenceOnlyEventValue(event, "markdown"),
  );
}

export function isReferenceOnlyEventValue(
  event: AgentEvent,
  key: PortableRuntimeResultValueKeyV0,
): boolean {
  return readPortableRuntimeResultValueRef(event, key) !== null && typeof event.payload?.[key] !== "string";
}

export function readReferenceOnlySummary(
  event: AgentEvent,
  key: PortableRuntimeResultValueKeyV0,
): string {
  const summary = event.payload?.["summary"];
  if (typeof summary === "string") {
    return summary;
  }

  if (key === "markdown") {
    return event.payload?.["kind"] === "summary"
      ? "Reference-only lead summary."
      : "Reference-only markdown result.";
  }

  return "Reference-only worker result.";
}

export function createRuntimeValueResolver(
  result: TeamRunResult,
  runtimeResultRefs: readonly PortableRuntimeResultAnyRefV0[],
  contributionOutputs: ReadonlyMap<string, string>,
): (event: AgentEvent, key: PortableRuntimeResultValueKeyV0) => string {
  const runtimeValueRefs = new Map<string, PortableRuntimeResultAnyRefV0>();
  for (const ref of runtimeResultRefs) {
    if (ref.kind !== "value") continue;
    runtimeValueRefs.set(`${ref.eventId}:${ref.valueKey}`, ref);
  }

  return (event, key) => {
    const valueRef = readPortableRuntimeResultValueRef(event, key)
      ?? runtimeValueRefs.get(`${event.id}:${key}`)
      ?? null;
    if (valueRef?.kind === "value") {
      if (key === "output") {
        return event.roleId ? contributionOutputs.get(event.roleId) ?? "" : "";
      }
      if (key === "markdown") {
        return result.artifact?.markdown ?? "";
      }
    }

    const persisted = event.payload?.[key];
    return typeof persisted === "string" ? persisted : "";
  };
}

export function generateEvidencePacket(input: GenerateEvidenceInput): EvidencePacketV0 {
  const { task, result, events, startedAt, finishedAt } = input;
  const blockerReason = normalizeBlockerReason(input.blockerReason);
  const runtimeResultRefs = input.runtimeResultRefs ?? result.runtimeResultRefs ?? collectPortableRuntimeResultRefs(events);
  const referenceOnlyPersistence = usesReferenceOnlyPersistence(events);
  const contributionOutputs = new Map<string, string>(
    result.artifact?.contributions.map((contribution) => [contribution.roleId, contribution.output]) ?? [],
  );
  const resolveEventValue = createRuntimeValueResolver(result, runtimeResultRefs, contributionOutputs);

  const workerEvents = events.filter(
    (e) => e.type === "worker_started" || e.type === "worker_completed",
  );
  const workerMap = new Map<string, WorkerEvidenceAccumulator>();
  const artifactContributions = new Map<string, WorkerContribution>(
    (result.artifact?.contributions ?? []).map((contribution) => [contribution.roleId, contribution] as const),
  );
  for (const ev of workerEvents) {
    const role = ev.roleId;
    if (!role) continue;
    const existing = workerMap.get(role) ?? {
      sessionId: null,
      output: "",
      referenceOnly: false,
      referenceSummaryFromPayload: false,
      provenance: {},
    };
    if (ev.type === "worker_started") {
      existing.sessionId = ev.sessionId ?? null;
    } else if (ev.type === "worker_completed") {
      existing.referenceOnly = isReferenceOnlyEventValue(ev, "output");
      existing.referenceSummaryFromPayload = existing.referenceOnly && typeof ev.payload?.["summary"] === "string";
      existing.output = existing.referenceOnly
        ? readReferenceOnlySummary(ev, "output")
        : resolveEventValue(ev, "output");
      existing.provenance = mergeProvenancePins(
        extractContributionProvenance(artifactContributions.get(role)),
        extractCatalogSelectionProvenance(ev.payload?.["catalogSelection"]),
      );
    }
    workerMap.set(role, existing);
  }

  for (const [role, output] of contributionOutputs) {
    const existing = workerMap.get(role);
    if (!existing) {
      workerMap.set(role, {
        sessionId: null,
        output,
        referenceOnly: false,
        referenceSummaryFromPayload: false,
        provenance: extractContributionProvenance(artifactContributions.get(role)),
      });
      continue;
    }
    if (!existing.output || (existing.referenceOnly && !existing.referenceSummaryFromPayload)) {
      existing.output = output;
    }
    existing.provenance = mergeProvenancePins(
      extractContributionProvenance(artifactContributions.get(role)),
      existing.provenance,
    );
    workerMap.set(role, existing);
  }

  const workers: EvidencePacketV0["workers"] = Array.from(workerMap.entries()).map(
    ([role, info]) => ({
      role,
      sessionId: info.sessionId,
      contributionSummary: redactString(info.output.slice(0, 500) || ""),
      tokenUsageApprox: null,
      durationMsApprox: null,
      ...info.provenance,
    }),
  );

  const validation = extractValidation(events, resolveEventValue);
  const { risks, openQuestions } = extractRisksAndQuestions(events, resolveEventValue);
  const runStarted = events.find((event) => event.type === "run_started");
  const orchestrationTerminalEvent = [...events].reverse().find(
    (event) => event.type === "run_completed" || event.type === "artifact_created",
  );
  const orchestration = extractOrchestrationEvidence(runStarted, orchestrationTerminalEvent, input.transcriptRef);

  const packet: EvidencePacketV0 = {
    schemaVersion: 0,
    runId: result.runId,
    taskTitle: redactString(task.title),
    status: mapStatus(result, blockerReason),
    blockerReason,
    ...(runtimeResultRefs.length > 0
      ? { runtimeResultRefs: redactObject(runtimeResultRefs) as EvidencePacketV0["runtimeResultRefs"] }
      : {}),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    workspace: referenceOnlyPersistence ? null : redactWorkspacePath(task.workspacePath) || null,
    workers,
    validation: {
      outcome: validation.outcome,
      reason: validation.reason ? redactString(validation.reason) : null,
    },
    citedInputs: {
      taskPrompt: redactString(task.prompt),
      workspaceMarkers: [],
    },
    risks: risks.map((risk) => redactString(risk)),
    openQuestions: openQuestions.map((q) => redactString(q)),
    classifierVersion: 0,
    generatedAt: new Date().toISOString(),
    ...(orchestration ? { orchestration } : {}),
  };

  return packet;
}