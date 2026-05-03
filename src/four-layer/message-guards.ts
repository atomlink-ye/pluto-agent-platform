import type {
  EvaluatorVerdictBody,
  FinalReconciliationBody,
  MailboxMessage,
  MailboxMessageBody,
  PlanApprovalRequestBody,
  PlanApprovalResponseBody,
  RevisionRequestBody,
  ShutdownRequestBody,
  ShutdownResponseBody,
  SpawnRequestBody,
  WorkerCompleteBody,
} from "../contracts/four-layer.js";

function asRecord(body: MailboxMessageBody): Record<string, unknown> | null {
  return typeof body === "object" && body !== null ? body as unknown as Record<string, unknown> : null;
}

export function isSpawnRequest(message: MailboxMessage): message is MailboxMessage & { body: SpawnRequestBody } {
  const body = asRecord(message.body);
  if (message.kind !== "spawn_request" || !body || body["schemaVersion"] !== "v1") {
    return false;
  }
  return typeof body["taskId"] === "string"
    && typeof body["targetRole"] === "string";
}

export function isWorkerComplete(message: MailboxMessage): message is MailboxMessage & { body: WorkerCompleteBody } {
  const body = asRecord(message.body);
  if (message.kind !== "worker_complete" || !body || body["schemaVersion"] !== "v1") {
    return false;
  }
  return typeof body["taskId"] === "string"
    && (body["status"] === "succeeded" || body["status"] === "failed");
}

export function isFinalReconciliation(message: MailboxMessage): message is MailboxMessage & { body: FinalReconciliationBody } {
  const body = asRecord(message.body);
  if (message.kind !== "final_reconciliation" || !body || body["schemaVersion"] !== "v1") {
    return false;
  }
  return typeof body["summary"] === "string"
    && Array.isArray(body["completedTaskIds"]);
}

export function isPlanApprovalRequest(message: MailboxMessage): message is MailboxMessage & { body: PlanApprovalRequestBody } {
  return message.kind === "plan_approval_request" && asRecord(message.body) !== null;
}

export function isPlanApprovalResponse(message: MailboxMessage): message is MailboxMessage & { body: PlanApprovalResponseBody } {
  return message.kind === "plan_approval_response" && asRecord(message.body) !== null;
}

export function isShutdownRequest(message: MailboxMessage): message is MailboxMessage & { body: ShutdownRequestBody } {
  const body = asRecord(message.body);
  if (message.kind !== "shutdown_request" || !body || body["schemaVersion"] !== "v1") {
    return false;
  }
  return typeof body["reason"] === "string"
    && (body["targetRole"] === undefined || typeof body["targetRole"] === "string")
    && (body["timeoutMs"] === undefined || typeof body["timeoutMs"] === "number");
}

export function isShutdownResponse(message: MailboxMessage): message is MailboxMessage & { body: ShutdownResponseBody } {
  const body = asRecord(message.body);
  if (message.kind !== "shutdown_response" || !body || body["schemaVersion"] !== "v1") {
    return false;
  }
  return body["acknowledged"] === true
    && (body["fromTaskId"] === undefined || typeof body["fromTaskId"] === "string");
}

export function isEvaluatorVerdict(message: MailboxMessage): message is MailboxMessage & { body: EvaluatorVerdictBody } {
  const body = asRecord(message.body);
  if (message.kind !== "evaluator_verdict" || !body || body["schemaVersion"] !== "v1") {
    return false;
  }
  return typeof body["taskId"] === "string"
    && (body["verdict"] === "pass" || body["verdict"] === "fail")
    && (body["rationale"] === undefined || typeof body["rationale"] === "string")
    && (body["failedRubricRef"] === undefined || typeof body["failedRubricRef"] === "string");
}

export function isRevisionRequest(message: MailboxMessage): message is MailboxMessage & { body: RevisionRequestBody } {
  const body = asRecord(message.body);
  if (message.kind !== "revision_request" || !body || body["schemaVersion"] !== "v1") {
    return false;
  }
  return typeof body["failedTaskId"] === "string"
    && typeof body["failedVerdictMessageId"] === "string"
    && typeof body["targetRole"] === "string"
    && typeof body["instructions"] === "string";
}
