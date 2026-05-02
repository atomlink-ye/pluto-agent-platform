import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentEvent,
  BlockerReasonV0,
  CoordinationTranscriptRefV0,
  EvidencePacketStatusV0,
  EvidencePacketV0,
  StageDependencyTrace,
  ProvenancePinRef,
  TeamRunResult,
  TeamTask,
  WorkerContribution,
  WorkerContributionProvenancePins,
} from "../contracts/types.js";
import {
  collectPortableRuntimeResultRefs,
  readPortableRuntimeResultValueRef,
  type PortableRuntimeResultAnyRefV0,
  type PortableRuntimeResultValueKeyV0,
} from "../runtime/result-contract.js";
import { normalizeBlockerReason } from "./blocker-classifier.js";
import {
  redactObject,
  redactString,
  redactWorkspacePath as redactCanonicalWorkspacePath,
} from "./redactor.js";

export function redactSecrets(text: string): string {
  return redactString(text);
}

export function redactEventPayload(payload: unknown): unknown {
  return redactObject(payload);
}

export function redactWorkspacePath(workspacePath: string): string {
  return redactCanonicalWorkspacePath(workspacePath);
}

export function redactEvidencePacketV0(packet: EvidencePacketV0): EvidencePacketV0 {
  const redacted = redactObject(packet) as EvidencePacketV0;
  if (packet.orchestration?.transcript && redacted.orchestration?.transcript) {
    redacted.orchestration.transcript = {
      kind: redactString(packet.orchestration.transcript.kind) as "file" | "shared_channel",
      path: redactString(packet.orchestration.transcript.path),
      roomRef: redactString(packet.orchestration.transcript.roomRef),
    };
  }
  return redacted;
}

export type EvidencePacketValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

const REQUIRED_TOP_LEVEL_FIELDS = [
  "schemaVersion",
  "runId",
  "taskTitle",
  "status",
  "blockerReason",
  "startedAt",
  "finishedAt",
  "workspace",
  "workers",
  "validation",
  "citedInputs",
  "risks",
  "openQuestions",
  "classifierVersion",
  "generatedAt",
] as const;

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validateStringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      errors.push(`${path}[${index}] must be a string`);
    }
  });
}

function validateCoordinationTranscriptRef(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }
  const ref = value as Record<string, unknown>;
  if (ref["kind"] !== "file" && ref["kind"] !== "shared_channel") {
    errors.push(`${path}.kind must be file or shared_channel`);
  }
  if (typeof ref["path"] !== "string") {
    errors.push(`${path}.path must be a string`);
  }
  if (typeof ref["roomRef"] !== "string") {
    errors.push(`${path}.roomRef must be a string`);
  }
}

function validateDependencyTrace(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    const trace = entry as Record<string, unknown>;
    if (typeof trace["stageId"] !== "string") errors.push(`${path}[${index}].stageId must be a string`);
    if (typeof trace["role"] !== "string") errors.push(`${path}[${index}].role must be a string`);
    if (typeof trace["completedAt"] !== "string") errors.push(`${path}[${index}].completedAt must be a string`);
  });
}

function validateRevisionEntries(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${path}[${index}] must be an object`);
      return;
    }
    const revision = entry as Record<string, unknown>;
    if (typeof revision["stageId"] !== "string") errors.push(`${path}[${index}].stageId must be a string`);
    if (typeof revision["attempt"] !== "number") errors.push(`${path}[${index}].attempt must be a number`);
    if (typeof revision["evaluatorVerdict"] !== "string") errors.push(`${path}[${index}].evaluatorVerdict must be a string`);
    if (revision["escalated"] !== undefined && typeof revision["escalated"] !== "boolean") {
      errors.push(`${path}[${index}].escalated must be a boolean when present`);
    }
  });
}

function validateEscalation(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }
  const escalation = value as Record<string, unknown>;
  if (typeof escalation["stageId"] !== "string") errors.push(`${path}.stageId must be a string`);
  if (typeof escalation["attempts"] !== "number") errors.push(`${path}.attempts must be a number`);
  if (typeof escalation["lastVerdict"] !== "string") errors.push(`${path}.lastVerdict must be a string`);
}

function validateFinalReconciliation(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }
  const finalReconciliation = value as Record<string, unknown>;
  if (!Array.isArray(finalReconciliation["citations"])) {
    errors.push(`${path}.citations must be an array`);
  } else {
    finalReconciliation["citations"].forEach((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        errors.push(`${path}.citations[${index}] must be an object`);
        return;
      }
      const citation = entry as Record<string, unknown>;
      if (typeof citation["stageId"] !== "string") errors.push(`${path}.citations[${index}].stageId must be a string`);
      if (typeof citation["present"] !== "boolean") errors.push(`${path}.citations[${index}].present must be a boolean`);
      if (citation["snippet"] !== undefined && typeof citation["snippet"] !== "string") {
        errors.push(`${path}.citations[${index}].snippet must be a string when present`);
      }
    });
  }
  if (typeof finalReconciliation["valid"] !== "boolean") {
    errors.push(`${path}.valid must be a boolean`);
  }
}

function validateProvenanceRef(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path} must be an object`);
    return;
  }

  const ref = value as Record<string, unknown>;
  if (typeof ref["id"] !== "string") {
    errors.push(`${path}.id must be a string`);
  }
  if (typeof ref["version"] !== "string") {
    errors.push(`${path}.version must be a string`);
  }
}

function validateWorkerProvenance(
  worker: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (worker["workerRoleRef"] !== undefined) {
    validateProvenanceRef(worker["workerRoleRef"], `${path}.workerRoleRef`, errors);
  }
  if (worker["skillRef"] !== undefined) {
    validateProvenanceRef(worker["skillRef"], `${path}.skillRef`, errors);
  }
  if (worker["templateRef"] !== undefined) {
    validateProvenanceRef(worker["templateRef"], `${path}.templateRef`, errors);
  }
  if (worker["policyPackRefs"] !== undefined) {
    if (!Array.isArray(worker["policyPackRefs"])) {
      errors.push(`${path}.policyPackRefs must be an array`);
    } else {
      worker["policyPackRefs"].forEach((entry, index) => {
        validateProvenanceRef(entry, `${path}.policyPackRefs[${index}]`, errors);
      });
    }
  }
  if (worker["catalogEntryRef"] !== undefined) {
    validateProvenanceRef(worker["catalogEntryRef"], `${path}.catalogEntryRef`, errors);
  }
  if (
    worker["extensionInstallRef"] !== undefined
    && worker["extensionInstallRef"] !== null
    && typeof worker["extensionInstallRef"] !== "string"
  ) {
    errors.push(`${path}.extensionInstallRef must be a string or null`);
  }
}

export function validateEvidencePacketV0(packet: unknown): EvidencePacketValidationResult {
  const errors: string[] = [];

  if (typeof packet !== "object" || packet === null) {
    return { ok: false, errors: ["packet must be an object"] };
  }

  const p = packet as Record<string, unknown>;
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!hasOwnProperty(p, field)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (p["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  if (typeof p["runId"] !== "string") errors.push("runId must be a string");
  if (typeof p["taskTitle"] !== "string") errors.push("taskTitle must be a string");
  if (!["done", "blocked", "failed"].includes(p["status"] as string)) {
    errors.push("status must be one of done, blocked, failed");
  }

  if (p["blockerReason"] !== null) {
    if (typeof p["blockerReason"] !== "string") {
      errors.push("blockerReason must be a string or null");
    } else if (normalizeBlockerReason(p["blockerReason"]) === "unknown" && p["blockerReason"] !== "unknown") {
      errors.push("blockerReason must be a canonical or legacy-normalizable blocker reason");
    }
  }

  if (typeof p["startedAt"] !== "string") errors.push("startedAt must be a string");
  if (typeof p["finishedAt"] !== "string") errors.push("finishedAt must be a string");
  if (p["workspace"] !== null && typeof p["workspace"] !== "string") {
    errors.push("workspace must be a string or null");
  }

  if (!Array.isArray(p["workers"])) {
    errors.push("workers must be an array");
  } else {
    for (const [index, workerValue] of p["workers"].entries()) {
      if (typeof workerValue !== "object" || workerValue === null) {
        errors.push(`workers[${index}] must be an object`);
        continue;
      }

      const worker = workerValue as Record<string, unknown>;
      if (typeof worker["role"] !== "string") {
        errors.push(`workers[${index}].role must be a string`);
      }
      if (worker["sessionId"] !== null && typeof worker["sessionId"] !== "string") {
        errors.push(`workers[${index}].sessionId must be a string or null`);
      }
      if (typeof worker["contributionSummary"] !== "string") {
        errors.push(`workers[${index}].contributionSummary must be a string`);
      }
      if (worker["tokenUsageApprox"] !== null && typeof worker["tokenUsageApprox"] !== "number") {
        errors.push(`workers[${index}].tokenUsageApprox must be a number or null`);
      }
      if (worker["durationMsApprox"] !== null && typeof worker["durationMsApprox"] !== "number") {
        errors.push(`workers[${index}].durationMsApprox must be a number or null`);
      }
      validateWorkerProvenance(worker, `workers[${index}]`, errors);
    }
  }

  if (typeof p["validation"] !== "object" || p["validation"] === null) {
    errors.push("validation must be an object");
  } else {
    const validation = p["validation"] as Record<string, unknown>;
    if (!["pass", "fail", "na"].includes(validation["outcome"] as string)) {
      errors.push("validation.outcome must be one of pass, fail, na");
    }
    if (validation["reason"] !== null && typeof validation["reason"] !== "string") {
      errors.push("validation.reason must be a string or null");
    }
  }

  if (typeof p["citedInputs"] !== "object" || p["citedInputs"] === null) {
    errors.push("citedInputs must be an object");
  } else {
    const citedInputs = p["citedInputs"] as Record<string, unknown>;
    if (typeof citedInputs["taskPrompt"] !== "string") {
      errors.push("citedInputs.taskPrompt must be a string");
    }
    validateStringArray(citedInputs["workspaceMarkers"], "citedInputs.workspaceMarkers", errors);
  }

  validateStringArray(p["risks"], "risks", errors);
  validateStringArray(p["openQuestions"], "openQuestions", errors);

  if (p["classifierVersion"] !== 0) errors.push("classifierVersion must be 0");
  if (typeof p["generatedAt"] !== "string") errors.push("generatedAt must be a string");

  if (p["orchestration"] !== undefined) {
    if (typeof p["orchestration"] !== "object" || p["orchestration"] === null) {
      errors.push("orchestration must be an object when present");
    } else {
      const orchestration = p["orchestration"] as Record<string, unknown>;
      if (typeof orchestration["playbookId"] !== "string") {
        errors.push("orchestration.playbookId must be a string");
      }
      if (typeof orchestration["orchestrationSource"] !== "string") {
        errors.push("orchestration.orchestrationSource must be a string");
      }
      if (orchestration["orchestrationMode"] !== undefined && typeof orchestration["orchestrationMode"] !== "string") {
        errors.push("orchestration.orchestrationMode must be a string when present");
      }
      if (orchestration["dependencyTrace"] !== undefined) {
        validateDependencyTrace(orchestration["dependencyTrace"], "orchestration.dependencyTrace", errors);
      }
      if (orchestration["revisions"] !== undefined) {
        validateRevisionEntries(orchestration["revisions"], "orchestration.revisions", errors);
      }
      if (orchestration["escalation"] !== undefined) {
        validateEscalation(orchestration["escalation"], "orchestration.escalation", errors);
      }
      if (orchestration["finalReconciliation"] !== undefined) {
        validateFinalReconciliation(orchestration["finalReconciliation"], "orchestration.finalReconciliation", errors);
      }
      if (orchestration["transcript"] !== undefined) {
        validateCoordinationTranscriptRef(orchestration["transcript"], "orchestration.transcript", errors);
      } else {
        errors.push("orchestration.transcript must be present");
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

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

function mapStatus(result: TeamRunResult, blockerReason: BlockerReasonV0 | null): EvidencePacketStatusV0 {
  if ((result.status === "completed" || result.status === "completed_with_escalation" || result.status === "completed_with_warnings") && !blockerReason) return "done";
  if (blockerReason) return "blocked";
  return "failed";
}

function extractValidation(
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

function extractRisksAndQuestions(
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
    workspace: referenceOnlyPersistence ? null : redactCanonicalWorkspacePath(task.workspacePath) || null,
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

function extractOrchestrationEvidence(
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

function extractContributionProvenance(
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

function extractCatalogSelectionProvenance(selection: unknown): WorkerContributionProvenancePins {
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

function readProvenanceRef(value: unknown): ProvenancePinRef | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const ref = value as Record<string, unknown>;
  if (typeof ref["id"] !== "string" || typeof ref["version"] !== "string") {
    return undefined;
  }

  return { id: ref["id"], version: ref["version"] };
}

function mergeProvenancePins(
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

function cloneRef(ref: ProvenancePinRef): ProvenancePinRef {
  return { id: ref.id, version: ref.version };
}

function usesReferenceOnlyPersistence(events: readonly AgentEvent[]): boolean {
  return events.some(
    (event) => isReferenceOnlyEventValue(event, "output") || isReferenceOnlyEventValue(event, "markdown"),
  );
}

function isReferenceOnlyEventValue(
  event: AgentEvent,
  key: PortableRuntimeResultValueKeyV0,
): boolean {
  return readPortableRuntimeResultValueRef(event, key) !== null && typeof event.payload?.[key] !== "string";
}

function readReferenceOnlySummary(
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

function createRuntimeValueResolver(
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

export function renderEvidenceMarkdown(packet: EvidencePacketV0): string {
  const lines: string[] = [];
  lines.push(`# Evidence Packet — ${packet.runId}`);
  lines.push("");
  lines.push(`- **Status:** ${packet.status}`);
  if (packet.blockerReason) {
    lines.push(`- **Blocker:** ${packet.blockerReason}`);
  }
  lines.push(`- **Task:** ${packet.taskTitle}`);
  lines.push(`- **Started:** ${packet.startedAt}`);
  lines.push(`- **Finished:** ${packet.finishedAt}`);
  if (packet.workspace) {
    lines.push(`- **Workspace:** ${packet.workspace}`);
  }
  lines.push("");
  lines.push("## Workers");
  lines.push("");
  for (const w of packet.workers) {
    lines.push(`### ${w.role}`);
    lines.push(`- Session: ${w.sessionId ?? "n/a"}`);
    lines.push(`- Contribution: ${w.contributionSummary || "(none)"}`);
    lines.push("");
  }
  lines.push("## Validation");
  lines.push(`- Outcome: ${packet.validation.outcome}`);
  if (packet.validation.reason) {
    lines.push(`- Reason: ${packet.validation.reason}`);
  }
  lines.push("");
  if (packet.risks.length > 0) {
    lines.push("## Risks");
    for (const r of packet.risks) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }
  if (packet.openQuestions.length > 0) {
    lines.push("## Open Questions");
    for (const q of packet.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }
  lines.push("## Cited Inputs");
  lines.push(`- Prompt: ${packet.citedInputs.taskPrompt}`);
  if (packet.citedInputs.workspaceMarkers.length > 0) {
    lines.push(`- Workspace markers: ${packet.citedInputs.workspaceMarkers.join(", ")}`);
  }
  lines.push("");
  lines.push(`---`);
  lines.push(`Schema version: ${packet.schemaVersion} | Classifier version: ${packet.classifierVersion} | Generated: ${packet.generatedAt}`);
  lines.push("");
  return redactString(lines.join("\n"));
}

export async function writeEvidence(
  runDir: string,
  packet: EvidencePacketV0,
): Promise<{ mdPath: string; jsonPath: string }> {
  const mdPath = join(runDir, "evidence.md");
  const jsonPath = join(runDir, "evidence.json");
  const redactedPacket = redactEvidencePacketV0(packet);
  const validation = validateEvidencePacketV0(redactedPacket);
  if (!validation.ok) {
    throw new Error(`evidence_packet_invalid: ${validation.errors.join("; ")}`);
  }

  try {
    await writeFile(mdPath, renderEvidenceMarkdown(redactedPacket), "utf8");
    await writeFile(jsonPath, JSON.stringify(redactedPacket, null, 2) + "\n", "utf8");
  } catch (cause) {
    await Promise.all([
      rm(mdPath, { force: true }).catch(() => {}),
      rm(jsonPath, { force: true }).catch(() => {}),
    ]);
    throw cause;
  }

  return { mdPath, jsonPath };
}
