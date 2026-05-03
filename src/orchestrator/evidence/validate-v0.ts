import type {
  BlockerReasonV0,
  CoordinationTranscriptRefV0,
  EvidencePacketV0,
  StageDependencyTrace,
} from "../../contracts/types.js";
import { normalizeBlockerReason } from "../blocker-classifier.js";

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