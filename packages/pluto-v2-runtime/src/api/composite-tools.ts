import type { ActorRef, MailboxMessageKind, TaskState } from '@pluto/v2-core';
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
  summary: z.string().min(1),
}).strict();

type PromptTaskView = {
  readonly id: string;
  readonly state: TaskState;
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
  const result = await args.handlers.pluto_read_state(args.session, {});
  if (!result.ok) {
    throw new Error('Unable to read PromptView for composite tool translation.');
  }

  const promptView = jsonFromToolResult(result) as { tasks?: Array<{ id?: unknown; state?: unknown }> };
  const task = promptView.tasks?.find((candidate) => candidate.id === args.taskId);
  if (task == null || typeof task.state !== 'string') {
    return null;
  }

  return {
    id: args.taskId,
    state: task.state as TaskState,
  };
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

function finalReconciliationSummary(args: z.infer<typeof FinalReconciliationArgsSchema>): string {
  return JSON.stringify({
    completedTasks: args.completedTasks,
    citedMessages: args.citedMessages,
    summary: args.summary,
  });
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

  const completion = await handlers.pluto_complete_run(session, {
    status: 'succeeded',
    summary: finalReconciliationSummary(parsed.data),
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

  return okJson({
    accepted: true,
    composite: 'final-reconciliation',
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
