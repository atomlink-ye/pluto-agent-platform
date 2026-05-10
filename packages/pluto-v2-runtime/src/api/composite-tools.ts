import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ActorRef } from '@pluto/v2-core/actor-ref';
import type { MailboxMessageKind, TaskState } from '@pluto/v2-core/run-event';
import { z } from 'zod';

import type { PlutoToolHandlers } from '../mcp/pluto-mcp-server.js';
import type { PlutoToolResult, PlutoToolSession } from '../tools/pluto-tool-handlers.js';

export type CompositeToolName = 'pluto_worker_complete' | 'pluto_evaluator_verdict' | 'pluto_final_reconciliation';

const LEAD_ACTOR: ActorRef = { kind: 'role', role: 'lead' };
const TERMINAL_TASK_STATES = new Set<TaskState>(['completed', 'failed', 'cancelled']);

const WorkerCompleteArgsSchema = z.object({
  taskId: z.string().min(1),
  summary: z.string().min(1),
  artifacts: z.array(z.string().min(1)).default([]),
}).strict();

const EvaluatorVerdictArgsSchema = z.object({
  taskId: z.string().min(1),
  verdict: z.enum(['pass', 'needs-revision', 'fail']),
  summary: z.string().min(1),
}).strict();

const FinalReconciliationArgsSchema = z.object({
  completedTasks: z.array(z.string().min(1)).min(1),
  citedMessages: z.array(z.string().min(1)).min(1),
  citedArtifactRefs: z.array(z.string().min(1)).default([]),
  unresolvedIssues: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
}).strict();

type PromptViewSnapshot = {
  readonly tasks?: Array<{ id?: unknown; state?: unknown }>;
  readonly mailbox?: Array<{ sequence?: unknown }>;
  readonly artifacts?: Array<{ id?: unknown }>;
};

type PromptTaskView = {
  readonly id: string;
  readonly state: TaskState;
};

type FinalReconciliationFailureKind = 'missing_task' | 'non_terminal_task' | 'missing_message' | 'missing_artifact';

type FinalReconciliationFailure = {
  readonly kind: FinalReconciliationFailureKind;
  readonly ref: string;
};

type FinalReconciliationAudit = {
  readonly status: 'pass' | 'failed_audit';
  readonly failures: readonly FinalReconciliationFailure[];
};

type FinalReconciliationEnvelope = {
  readonly completedTasks: readonly string[];
  readonly citedMessages: readonly string[];
  readonly citedArtifactRefs: readonly string[];
  readonly unresolvedIssues: readonly string[];
  readonly summary: string;
  readonly audit: FinalReconciliationAudit;
};

type FinalReconciliationEvidence = {
  readonly summary: string;
  readonly completedTaskIds: readonly string[];
  readonly citedMessageIds: readonly string[];
  readonly citedArtifactRefs: readonly string[];
  readonly unresolvedIssues: readonly string[];
  readonly audit: FinalReconciliationAudit;
};

type PrimitiveStep = {
  readonly tool: 'pluto_change_task_state' | 'pluto_append_mailbox_message' | 'pluto_complete_run';
  readonly response: Record<string, unknown>;
};

function summarizeSchemaError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

function okJson(value: unknown): PlutoToolResult {
  return {
    ok: true,
    data: {
      content: [{ type: 'text', text: JSON.stringify(value) }],
    },
  };
}

function errorResult(code: string, message: string, details?: unknown): PlutoToolResult {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function textFromToolResult(result: PlutoToolResult): string {
  if (!result.ok) {
    throw new Error('Expected an ok tool result.');
  }

  const content = (result.data as { content?: Array<{ type?: string; text?: string }> }).content;
  const firstChunk = content?.[0];
  if (firstChunk?.type !== 'text' || typeof firstChunk.text !== 'string') {
    throw new Error('Pluto tool result is missing its text payload.');
  }

  return firstChunk.text;
}

function jsonFromToolResult(result: PlutoToolResult): Record<string, unknown> {
  return JSON.parse(textFromToolResult(result)) as Record<string, unknown>;
}

function rejectionResult(composite: string, failedStep: PrimitiveStep['tool'], response: Record<string, unknown>, steps: readonly PrimitiveStep[]): PlutoToolResult {
  return okJson({
    accepted: false,
    composite,
    failedStep,
    ...response,
    steps,
  });
}

async function readPromptTask(args: {
  handlers: PlutoToolHandlers;
  session: PlutoToolSession;
  taskId: string;
}): Promise<PromptTaskView | null> {
  const promptView = await readPromptView(args.handlers, args.session);
  const task = promptView.tasks?.find((candidate) => candidate.id === args.taskId);
  if (task == null || typeof task.state !== 'string') {
    return null;
  }

  return {
    id: args.taskId,
    state: task.state as TaskState,
  };
}

async function readPromptView(handlers: PlutoToolHandlers, session: PlutoToolSession): Promise<PromptViewSnapshot> {
  const result = await handlers.pluto_read_state(session, {});
  if (!result.ok) {
    throw new Error('Unable to read PromptView for composite tool translation.');
  }

  return jsonFromToolResult(result) as PromptViewSnapshot;
}

function workerCompletionBody(args: z.infer<typeof WorkerCompleteArgsSchema>): string {
  return JSON.stringify({
    summary: args.summary,
    taskId: args.taskId,
    artifacts: args.artifacts,
  });
}

function evaluatorVerdictBody(args: z.infer<typeof EvaluatorVerdictArgsSchema>): string {
  return JSON.stringify({
    summary: args.summary,
    taskId: args.taskId,
    verdict: args.verdict,
  });
}

function validateFinalReconciliation(
  args: z.infer<typeof FinalReconciliationArgsSchema>,
  promptView: PromptViewSnapshot,
): FinalReconciliationAudit {
  const failures: FinalReconciliationFailure[] = [];
  const taskById = new Map(
    (promptView.tasks ?? [])
      .filter((task): task is { id: string; state: TaskState } => typeof task.id === 'string' && typeof task.state === 'string')
      .map((task) => [task.id, task.state as TaskState]),
  );
  const visibleMessageIds = new Set(
    (promptView.mailbox ?? [])
      .flatMap((message) => (typeof message.sequence === 'number' ? [String(message.sequence)] : [])),
  );
  const artifactIds = new Set(
    (promptView.artifacts ?? [])
      .flatMap((artifact) => (typeof artifact.id === 'string' ? [artifact.id] : [])),
  );

  for (const taskId of new Set(args.completedTasks)) {
    const taskState = taskById.get(taskId);
    if (taskState == null) {
      failures.push({ kind: 'missing_task', ref: taskId });
      continue;
    }

    if (!TERMINAL_TASK_STATES.has(taskState)) {
      failures.push({ kind: 'non_terminal_task', ref: taskId });
    }
  }

  for (const messageId of new Set(args.citedMessages)) {
    if (!visibleMessageIds.has(messageId)) {
      failures.push({ kind: 'missing_message', ref: messageId });
    }
  }

  for (const artifactRef of new Set(args.citedArtifactRefs)) {
    if (!artifactIds.has(artifactRef)) {
      failures.push({ kind: 'missing_artifact', ref: artifactRef });
    }
  }

  return {
    status: failures.length === 0 ? 'pass' : 'failed_audit',
    failures,
  };
}

function buildFinalReconciliationEnvelope(
  args: z.infer<typeof FinalReconciliationArgsSchema>,
  audit: FinalReconciliationAudit,
): FinalReconciliationEnvelope {
  return {
    completedTasks: args.completedTasks,
    citedMessages: args.citedMessages,
    citedArtifactRefs: args.citedArtifactRefs,
    unresolvedIssues: args.unresolvedIssues,
    summary: args.summary,
    audit,
  };
}

function buildFinalReconciliationEvidence(envelope: FinalReconciliationEnvelope): FinalReconciliationEvidence {
  return {
    summary: envelope.summary,
    completedTaskIds: envelope.completedTasks,
    citedMessageIds: envelope.citedMessages,
    citedArtifactRefs: envelope.citedArtifactRefs,
    unresolvedIssues: envelope.unresolvedIssues,
    audit: envelope.audit,
  };
}

function finalReconciliationSummary(envelope: FinalReconciliationEnvelope): string {
  const serializedEnvelope = JSON.stringify(envelope);
  return envelope.audit.status === 'pass'
    ? serializedEnvelope
    : `FAILED_AUDIT: ${serializedEnvelope}`;
}

async function writeFinalReconciliationEvidence(session: PlutoToolSession, evidence: FinalReconciliationEvidence): Promise<void> {
  if (session.runDir == null) {
    throw new Error('Final reconciliation requires a session runDir to write evidence.');
  }

  const evidenceDir = join(session.runDir, 'evidence');
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    join(evidenceDir, 'final-reconciliation.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
}

function mailboxKindForVerdict(verdict: z.infer<typeof EvaluatorVerdictArgsSchema>['verdict']): MailboxMessageKind {
  return verdict === 'pass' ? 'final' : 'task';
}

async function runWorkerComplete(handlers: PlutoToolHandlers, session: PlutoToolSession, rawArgs: unknown): Promise<PlutoToolResult> {
  const parsed = WorkerCompleteArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return errorResult('PLUTO_TOOL_BAD_ARGS', summarizeSchemaError(parsed.error), parsed.error.issues);
  }

  const stateChange = await handlers.pluto_change_task_state(session, {
    taskId: parsed.data.taskId,
    to: 'completed',
  });
  if (!stateChange.ok) {
    return stateChange;
  }

  const stateChangeResponse = jsonFromToolResult(stateChange);
  const steps: PrimitiveStep[] = [
    {
      tool: 'pluto_change_task_state',
      response: stateChangeResponse,
    },
  ];
  if (stateChangeResponse.accepted !== true) {
    return rejectionResult('worker-complete', 'pluto_change_task_state', stateChangeResponse, steps);
  }

  const mailbox = await handlers.pluto_append_mailbox_message(session, {
    toActor: LEAD_ACTOR,
    kind: 'completion',
    body: workerCompletionBody(parsed.data),
  });
  if (!mailbox.ok) {
    return mailbox;
  }

  const mailboxResponse = jsonFromToolResult(mailbox);
  steps.push({
    tool: 'pluto_append_mailbox_message',
    response: mailboxResponse,
  });
  if (mailboxResponse.accepted !== true) {
    return rejectionResult('worker-complete', 'pluto_append_mailbox_message', mailboxResponse, steps);
  }

  return okJson({
    accepted: true,
    composite: 'worker-complete',
    taskId: parsed.data.taskId,
    steps,
  });
}

async function runEvaluatorVerdict(handlers: PlutoToolHandlers, session: PlutoToolSession, rawArgs: unknown): Promise<PlutoToolResult> {
  const parsed = EvaluatorVerdictArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return errorResult('PLUTO_TOOL_BAD_ARGS', summarizeSchemaError(parsed.error), parsed.error.issues);
  }

  const task = await readPromptTask({
    handlers,
    session,
    taskId: parsed.data.taskId,
  });
  if (task == null) {
    return errorResult('PLUTO_TOOL_BAD_ARGS', `taskId ${parsed.data.taskId} is not visible to the current actor.`);
  }

  const steps: PrimitiveStep[] = [];
  if (parsed.data.verdict === 'pass' && !TERMINAL_TASK_STATES.has(task.state)) {
    const stateChange = await handlers.pluto_change_task_state(session, {
      taskId: parsed.data.taskId,
      to: 'completed',
    });
    if (!stateChange.ok) {
      return stateChange;
    }

    const stateChangeResponse = jsonFromToolResult(stateChange);
    steps.push({
      tool: 'pluto_change_task_state',
      response: stateChangeResponse,
    });
    if (stateChangeResponse.accepted !== true) {
      return rejectionResult('evaluator-verdict', 'pluto_change_task_state', stateChangeResponse, steps);
    }
  }

  const mailbox = await handlers.pluto_append_mailbox_message(session, {
    toActor: LEAD_ACTOR,
    kind: mailboxKindForVerdict(parsed.data.verdict),
    body: evaluatorVerdictBody(parsed.data),
  });
  if (!mailbox.ok) {
    return mailbox;
  }

  const mailboxResponse = jsonFromToolResult(mailbox);
  steps.push({
    tool: 'pluto_append_mailbox_message',
    response: mailboxResponse,
  });
  if (mailboxResponse.accepted !== true) {
    return rejectionResult('evaluator-verdict', 'pluto_append_mailbox_message', mailboxResponse, steps);
  }

  return okJson({
    accepted: true,
    composite: 'evaluator-verdict',
    taskId: parsed.data.taskId,
    verdict: parsed.data.verdict,
    steps,
  });
}

async function runFinalReconciliation(handlers: PlutoToolHandlers, session: PlutoToolSession, rawArgs: unknown): Promise<PlutoToolResult> {
  const parsed = FinalReconciliationArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return errorResult('PLUTO_TOOL_BAD_ARGS', summarizeSchemaError(parsed.error), parsed.error.issues);
  }

  const promptView = await readPromptView(handlers, session);
  const audit = validateFinalReconciliation(parsed.data, promptView);
  const envelope = buildFinalReconciliationEnvelope(parsed.data, audit);
  const evidence = buildFinalReconciliationEvidence(envelope);

  const completion = await handlers.pluto_complete_run(session, {
    status: audit.status === 'pass' ? 'succeeded' : 'failed',
    summary: finalReconciliationSummary(envelope),
  });
  if (!completion.ok) {
    return completion;
  }

  const completionResponse = jsonFromToolResult(completion);
  const steps: PrimitiveStep[] = [
    {
      tool: 'pluto_complete_run',
      response: completionResponse,
    },
  ];
  if (completionResponse.accepted !== true) {
    return rejectionResult('final-reconciliation', 'pluto_complete_run', completionResponse, steps);
  }

  await writeFinalReconciliationEvidence(session, evidence);

  return okJson({
    accepted: true,
    composite: 'final-reconciliation',
    runStatus: audit.status === 'pass' ? 'succeeded' : 'failed',
    auditSummary: evidence,
    steps,
  });
}

export async function runCompositeTool(args: {
  toolName: CompositeToolName;
  handlers: PlutoToolHandlers;
  session: PlutoToolSession;
  rawArgs: unknown;
}): Promise<PlutoToolResult> {
  switch (args.toolName) {
    case 'pluto_worker_complete':
      return runWorkerComplete(args.handlers, args.session, args.rawArgs);
    case 'pluto_evaluator_verdict':
      return runEvaluatorVerdict(args.handlers, args.session, args.rawArgs);
    case 'pluto_final_reconciliation':
      return runFinalReconciliation(args.handlers, args.session, args.rawArgs);
  }
}
