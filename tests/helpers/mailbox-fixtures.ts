import type {
  EvaluatorVerdictBody,
  FinalReconciliationBody,
  MailboxEnvelope,
  MailboxMessage,
  RevisionRequestBody,
  ShutdownRequestBody,
  ShutdownResponseBody,
  WorkerCompleteBody,
} from "@/contracts/four-layer.js";

type MailboxHarnessRun = {
  roomRef: string;
  runId: string;
  transport: {
    post(input: { room: string; envelope: MailboxEnvelope }): Promise<unknown>;
  };
};

export function createMailboxMessage(input: {
  id: string;
  to: string;
  from: string;
  kind: MailboxMessage["kind"];
  body: MailboxMessage["body"];
}): MailboxMessage {
  return {
    id: input.id,
    to: input.to,
    from: input.from,
    createdAt: new Date().toISOString(),
    kind: input.kind,
    body: input.body,
  };
}

export function buildEnvelope(runId: string, message: MailboxMessage): MailboxEnvelope {
  return {
    schemaVersion: "v1",
    fromRole: message.from,
    toRole: message.to,
    runId,
    ...(typeof message.body === "object" && message.body !== null && "taskId" in message.body && typeof message.body.taskId === "string"
      ? { taskId: message.body.taskId }
      : {}),
    body: message,
  };
}

export async function postSpawnRequest(
  run: MailboxHarnessRun,
  input: { from: string; targetRole: string; taskId: string; id?: string; rationale?: string; to?: string },
): Promise<void> {
  await postMessage(run, createMailboxMessage({
    id: input.id ?? `${input.from}-${input.targetRole}-${input.taskId}`,
    to: input.to ?? "lead",
    from: input.from,
    kind: "spawn_request",
    body: {
      schemaVersion: "v1",
      targetRole: input.targetRole,
      taskId: input.taskId,
      rationale: input.rationale ?? `dispatch ${input.targetRole}`,
    },
  }));
}

export async function postWorkerComplete(
  run: MailboxHarnessRun,
  input: { from: string; taskId: string; status: WorkerCompleteBody["status"]; summary: string; id?: string; to?: string },
): Promise<void> {
  await postMessage(run, createMailboxMessage({
    id: input.id ?? `${input.from}-complete-${input.taskId}`,
    to: input.to ?? "lead",
    from: input.from,
    kind: "worker_complete",
    body: {
      schemaVersion: "v1",
      taskId: input.taskId,
      status: input.status,
      summary: input.summary,
    },
  }));
}

export async function postEvaluatorVerdict(
  run: MailboxHarnessRun,
  input: { id?: string; from: string; to?: string } & Omit<EvaluatorVerdictBody, "schemaVersion">,
): Promise<void> {
  await postMessage(run, createMailboxMessage({
    id: input.id ?? `evaluator-verdict-${input.taskId}`,
    to: input.to ?? "lead",
    from: input.from,
    kind: "evaluator_verdict",
    body: {
      schemaVersion: "v1",
      taskId: input.taskId,
      verdict: input.verdict,
      ...(input.rationale ? { rationale: input.rationale } : {}),
      ...(input.failedRubricRef ? { failedRubricRef: input.failedRubricRef } : {}),
    },
  }));
}

export async function postRevisionRequest(
  run: MailboxHarnessRun,
  input: { id?: string; from: string; to?: string } & Omit<RevisionRequestBody, "schemaVersion">,
): Promise<void> {
  await postMessage(run, createMailboxMessage({
    id: input.id ?? `revision-request-${input.failedTaskId}`,
    to: input.to ?? "lead",
    from: input.from,
    kind: "revision_request",
    body: {
      schemaVersion: "v1",
      failedTaskId: input.failedTaskId,
      failedVerdictMessageId: input.failedVerdictMessageId,
      targetRole: input.targetRole,
      instructions: input.instructions,
    },
  }));
}

export async function postShutdownRequest(
  run: MailboxHarnessRun,
  input: { id?: string; from: string; to?: string } & Omit<ShutdownRequestBody, "schemaVersion">,
): Promise<void> {
  await postMessage(run, createMailboxMessage({
    id: input.id ?? `${input.from}-shutdown-request`,
    to: input.to ?? "lead",
    from: input.from,
    kind: "shutdown_request",
    body: {
      schemaVersion: "v1",
      reason: input.reason,
      ...(input.targetRole ? { targetRole: input.targetRole } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    },
  }));
}

export async function postShutdownResponse(
  run: MailboxHarnessRun,
  input: { id?: string; from: string; fromTaskId?: string; acknowledged?: true; to?: string },
): Promise<void> {
  const body: ShutdownResponseBody = {
    schemaVersion: "v1",
    acknowledged: input.acknowledged ?? (true as const),
    ...(input.fromTaskId ? { fromTaskId: input.fromTaskId } : {}),
  };
  await postMessage(run, createMailboxMessage({
    id: input.id ?? `${input.from}-shutdown-response`,
    to: input.to ?? "lead",
    from: input.from,
    kind: "shutdown_response",
    body,
  }));
}

export async function postFinalReconciliation(
  run: MailboxHarnessRun,
  completedTaskIds: string[],
  input?: { id?: string; from?: string; to?: string; summary?: string },
): Promise<void> {
  const body: FinalReconciliationBody = {
    schemaVersion: "v1",
    summary: input?.summary ?? "manual finalization",
    completedTaskIds,
  };
  await postMessage(run, createMailboxMessage({
    id: input?.id ?? `lead-final-${completedTaskIds.length}`,
    to: input?.to ?? "lead",
    from: input?.from ?? "lead",
    kind: "final_reconciliation",
    body,
  }));
}

async function postMessage(run: MailboxHarnessRun, message: MailboxMessage): Promise<void> {
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}
