import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AUTHORITY_MATRIX,
  InMemoryEventLogStore,
  RunKernel,
  SCHEMA_VERSION,
  TeamContextSchema,
  counterIdProvider,
  fixedClockProvider,
  initialState,
  type ActorRef,
} from '@pluto/v2-core';

import { startPlutoLocalApi } from '../../src/api/pluto-local-api.js';
import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';
import { makePlutoToolHandlers } from '../../src/tools/pluto-tool-handlers.js';

const FIXED_ISO = '2026-05-08T00:00:00.000Z';
const TOKEN_BY_ACTOR = new Map([
  ['role:lead', 'pluto-test-token-lead'],
  ['role:generator', 'pluto-test-token-generator'],
  ['role:evaluator', 'pluto-test-token-evaluator'],
]);

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };
const EVALUATOR: ActorRef = { kind: 'role', role: 'evaluator' };

function tokenForActor(actorKey: string): string {
  const token = TOKEN_BY_ACTOR.get(actorKey);
  if (token == null) {
    throw new Error(`Missing test token for ${actorKey}`);
  }

  return token;
}

function createKernel() {
  return new RunKernel({
    initialState: initialState(TeamContextSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/composite-tools',
      runProfileRef: 'unit-test',
      declaredActors: [
        { kind: 'manager' },
        LEAD,
        GENERATOR,
        EVALUATOR,
        { kind: 'system' },
      ],
      initialTasks: [],
      policy: AUTHORITY_MATRIX,
    })),
    eventLog: new InMemoryEventLogStore(),
    idProvider: counterIdProvider(1),
    clockProvider: fixedClockProvider(FIXED_ISO),
  });
}

function sequentialRequestIds(values: readonly string[]) {
  let index = 0;

  return () => {
    const value = values[index];
    if (value == null) {
      throw new Error(`Missing request id at index ${index}`);
    }

    index += 1;
    return value;
  };
}

async function requestApi(args: {
  rootUrl: string;
  actor: string;
  path: string;
  body: unknown;
}) {
  const response = await fetch(`${args.rootUrl}${args.path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokenForActor(args.actor)}`,
      'Pluto-Run-Actor': args.actor,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args.body),
  });
  const text = await response.text();

  return {
    status: response.status,
    body: JSON.parse(text),
  };
}

async function withApi(run: (context: {
  rootUrl: string;
  kernel: ReturnType<typeof createKernel>;
  leaseStore: ReturnType<typeof makeTurnLeaseStore>;
  runDir: string;
}) => Promise<void>) {
  const kernel = createKernel();
  const runDir = await mkdtemp(join(tmpdir(), 'pluto-composite-tools-'));
  const handlers = makePlutoToolHandlers({
    kernel,
    runId: 'run-1',
    schemaVersion: SCHEMA_VERSION,
    clock: () => new Date(FIXED_ISO),
    idProvider: sequentialRequestIds([
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000105',
      '00000000-0000-4000-8000-000000000106',
      '00000000-0000-4000-8000-000000000107',
      '00000000-0000-4000-8000-000000000108',
    ]),
    artifactSidecar: {
      write: vi.fn(async (artifactId: string) => `/tmp/${artifactId}.txt`),
      read: vi.fn(async () => ({ path: '/tmp/artifact.txt', body: 'artifact body' })),
    },
    transcriptSidecar: {
      read: vi.fn(async () => 'transcript text'),
    },
    promptViewer: {
      forActor: vi.fn((actor: ActorRef) => {
        const events = kernel.eventLog.read();
        return {
          run: { runId: 'run-1' },
          forActor: actor,
          tasks: (Object.entries(kernel.state.tasks) as Array<[string, (typeof kernel.state.tasks)[string]]>).map(([id, task]) => ({
            id,
            title: `Task ${id}`,
            ownerActor: task.ownerActor,
            state: task.state,
          })),
          mailbox: events.flatMap((event) => event.kind === 'mailbox_message_appended'
            ? [{
                sequence: event.sequence,
                from: event.payload.fromActor,
                to: event.payload.toActor,
                kind: event.payload.kind,
                body: event.payload.body,
              }]
            : []),
          artifacts: events.flatMap((event) => event.kind === 'artifact_published'
            ? [{
                id: event.payload.artifactId,
                kind: event.payload.kind,
                mediaType: event.payload.mediaType,
                byteSize: event.payload.byteSize,
              }]
            : []),
        };
      }),
    },
  });
  const leaseStore = makeTurnLeaseStore(LEAD);
  const api = await startPlutoLocalApi({
    runDir,
    tokenByActor: TOKEN_BY_ACTOR,
    registeredActorKeys: new Set(['manager', 'role:lead', 'role:generator', 'role:evaluator', 'system']),
    handlers,
    leaseStore,
  });

  try {
    await run({ rootUrl: api.url.slice(0, -'/v1'.length), kernel, leaseStore, runDir });
  } finally {
    await api.shutdown();
    await rm(runDir, { recursive: true, force: true });
  }
}

function createTask(kernel: ReturnType<typeof createKernel>, ownerActor: ActorRef = GENERATOR): string {
  const created = kernel.submit({
    requestId: '00000000-0000-4000-8000-000000000001',
    runId: 'run-1',
    actor: LEAD,
    idempotencyKey: null,
    clientTimestamp: FIXED_ISO,
    schemaVersion: SCHEMA_VERSION,
    intent: 'create_task',
    payload: {
      title: 'Draft',
      ownerActor,
      dependsOn: [],
    },
  }).event;

  if (created.kind !== 'task_created') {
    throw new Error('Expected task_created event');
  }

  return created.payload.taskId;
}

function completeTask(kernel: ReturnType<typeof createKernel>, taskId: string): void {
  const changed = kernel.submit({
    requestId: '00000000-0000-4000-8000-000000000002',
    runId: 'run-1',
    actor: GENERATOR,
    idempotencyKey: null,
    clientTimestamp: FIXED_ISO,
    schemaVersion: SCHEMA_VERSION,
    intent: 'change_task_state',
    payload: {
      taskId,
      to: 'completed',
    },
  }).event;

  if (changed.kind !== 'task_state_changed') {
    throw new Error('Expected task_state_changed event');
  }
}

function appendMailboxMessage(kernel: ReturnType<typeof createKernel>): string {
  const appended = kernel.submit({
    requestId: '00000000-0000-4000-8000-000000000003',
    runId: 'run-1',
    actor: GENERATOR,
    idempotencyKey: null,
    clientTimestamp: FIXED_ISO,
    schemaVersion: SCHEMA_VERSION,
    intent: 'append_mailbox_message',
    payload: {
      fromActor: GENERATOR,
      toActor: LEAD,
      kind: 'completion',
      body: 'done',
    },
  }).event;

  if (appended.kind !== 'mailbox_message_appended') {
    throw new Error('Expected mailbox_message_appended event');
  }

  return String(appended.sequence);
}

function publishArtifact(kernel: ReturnType<typeof createKernel>): string {
  const published = kernel.submit({
    requestId: '00000000-0000-4000-8000-000000000004',
    runId: 'run-1',
    actor: GENERATOR,
    idempotencyKey: null,
    clientTimestamp: FIXED_ISO,
    schemaVersion: SCHEMA_VERSION,
    intent: 'publish_artifact',
    payload: {
      kind: 'final',
      mediaType: 'text/plain',
      byteSize: 4,
    },
  }).event;

  if (published.kind !== 'artifact_published') {
    throw new Error('Expected artifact_published event');
  }

  return published.payload.artifactId;
}

function seedFinalReconciliationState(
  kernel: ReturnType<typeof createKernel>,
  options: { taskState?: 'queued' | 'completed' } = {},
): { taskId: string; messageId: string; artifactId: string } {
  const taskId = createTask(kernel);
  if (options.taskState === 'completed') {
    completeTask(kernel, taskId);
  }

  return {
    taskId,
    messageId: appendMailboxMessage(kernel),
    artifactId: publishArtifact(kernel),
  };
}

describe('composite tools', () => {
  it('worker-complete emits task_state_changed then mailbox_message_appended', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore }) => {
      const created = kernel.submit({
        requestId: '00000000-0000-4000-8000-000000000001',
        runId: 'run-1',
        actor: LEAD,
        idempotencyKey: null,
        clientTimestamp: FIXED_ISO,
        schemaVersion: SCHEMA_VERSION,
        intent: 'create_task',
        payload: {
          title: 'Draft',
          ownerActor: GENERATOR,
          dependsOn: [],
        },
      }).event;

      if (created.kind !== 'task_created') {
        throw new Error('Expected task_created event');
      }

      leaseStore.setCurrent(GENERATOR);
      const response = await requestApi({
        rootUrl,
        actor: 'role:generator',
        path: '/v2/composite/worker-complete',
        body: {
          taskId: created.payload.taskId,
          summary: 'done',
          artifacts: ['artifact-1', 'artifact-2'],
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accepted: true,
        composite: 'worker-complete',
        turnDisposition: 'waiting',
        nextWakeup: 'event',
      });
      expect(kernel.eventLog.read().slice(-2).map((event) => event.kind)).toEqual([
        'task_state_changed',
        'mailbox_message_appended',
      ]);
      const mailbox = kernel.eventLog.read().at(-1);
      expect(mailbox).toMatchObject({
        kind: 'mailbox_message_appended',
        payload: {
          fromActor: GENERATOR,
          toActor: LEAD,
          kind: 'completion',
        },
      });
      expect(JSON.parse(mailbox?.kind === 'mailbox_message_appended' ? mailbox.payload.body : '{}')).toEqual({
        summary: 'done',
        taskId: created.payload.taskId,
        artifacts: ['artifact-1', 'artifact-2'],
      });
    });
  });

  it('evaluator-verdict pass closes the bound task and reports a final mailbox verdict', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore }) => {
      const created = kernel.submit({
        requestId: '00000000-0000-4000-8000-000000000001',
        runId: 'run-1',
        actor: LEAD,
        idempotencyKey: null,
        clientTimestamp: FIXED_ISO,
        schemaVersion: SCHEMA_VERSION,
        intent: 'create_task',
        payload: {
          title: 'Review',
          ownerActor: EVALUATOR,
          dependsOn: [],
        },
      }).event;

      if (created.kind !== 'task_created') {
        throw new Error('Expected task_created event');
      }

      leaseStore.setCurrent(EVALUATOR);
      const response = await requestApi({
        rootUrl,
        actor: 'role:evaluator',
        path: '/v2/composite/evaluator-verdict',
        body: {
          taskId: created.payload.taskId,
          verdict: 'pass',
          summary: 'looks good',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accepted: true,
        composite: 'evaluator-verdict',
        verdict: 'pass',
        turnDisposition: 'waiting',
        nextWakeup: 'event',
      });
      expect(kernel.eventLog.read().slice(-2).map((event) => event.kind)).toEqual([
        'task_state_changed',
        'mailbox_message_appended',
      ]);
      const mailbox = kernel.eventLog.read().at(-1);
      expect(mailbox).toMatchObject({
        kind: 'mailbox_message_appended',
        payload: {
          fromActor: EVALUATOR,
          toActor: LEAD,
          kind: 'final',
        },
      });
    });
  });

  it('evaluator-verdict needs-revision does not close the task', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore }) => {
      const created = kernel.submit({
        requestId: '00000000-0000-4000-8000-000000000001',
        runId: 'run-1',
        actor: LEAD,
        idempotencyKey: null,
        clientTimestamp: FIXED_ISO,
        schemaVersion: SCHEMA_VERSION,
        intent: 'create_task',
        payload: {
          title: 'Review',
          ownerActor: EVALUATOR,
          dependsOn: [],
        },
      }).event;

      if (created.kind !== 'task_created') {
        throw new Error('Expected task_created event');
      }

      leaseStore.setCurrent(EVALUATOR);
      const response = await requestApi({
        rootUrl,
        actor: 'role:evaluator',
        path: '/v2/composite/evaluator-verdict',
        body: {
          taskId: created.payload.taskId,
          verdict: 'needs-revision',
          summary: 'revise section 2',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accepted: true,
        composite: 'evaluator-verdict',
        verdict: 'needs-revision',
        turnDisposition: 'waiting',
        nextWakeup: 'event',
      });
      expect(kernel.eventLog.read().at(-1)).toMatchObject({
        kind: 'mailbox_message_appended',
        payload: {
          kind: 'task',
        },
      });
      expect(kernel.state.tasks[created.payload.taskId]?.state).toBe('queued');
    });
  });

  it('evaluator-verdict fail reports a non-closeout mailbox verdict', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore }) => {
      const created = kernel.submit({
        requestId: '00000000-0000-4000-8000-000000000001',
        runId: 'run-1',
        actor: LEAD,
        idempotencyKey: null,
        clientTimestamp: FIXED_ISO,
        schemaVersion: SCHEMA_VERSION,
        intent: 'create_task',
        payload: {
          title: 'Review',
          ownerActor: EVALUATOR,
          dependsOn: [],
        },
      }).event;

      if (created.kind !== 'task_created') {
        throw new Error('Expected task_created event');
      }

      leaseStore.setCurrent(EVALUATOR);
      const response = await requestApi({
        rootUrl,
        actor: 'role:evaluator',
        path: '/v2/composite/evaluator-verdict',
        body: {
          taskId: created.payload.taskId,
          verdict: 'fail',
          summary: 'blocked by a hard defect',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accepted: true,
        composite: 'evaluator-verdict',
        verdict: 'fail',
        turnDisposition: 'waiting',
        nextWakeup: 'event',
      });
      expect(kernel.eventLog.read().at(-1)).toMatchObject({
        kind: 'mailbox_message_appended',
        payload: {
          kind: 'task',
        },
      });
    });
  });

  it('rejects evaluator-verdict for an unknown task without appending mailbox output', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore }) => {
      leaseStore.setCurrent(EVALUATOR);
      const response = await requestApi({
        rootUrl,
        actor: 'role:evaluator',
        path: '/v2/composite/evaluator-verdict',
        body: {
          taskId: 'missing-task',
          verdict: 'pass',
          summary: 'looks good',
        },
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: {
          code: 'PLUTO_TOOL_BAD_ARGS',
        },
      });
      expect(kernel.eventLog.read()).toEqual([]);
    });
  });

  it('final-reconciliation succeeds when cited tasks, mailbox messages, and artifacts resolve', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore, runDir }) => {
      const refs = seedFinalReconciliationState(kernel, { taskState: 'completed' });

      leaseStore.setCurrent(LEAD);
      const response = await requestApi({
        rootUrl,
        actor: 'role:lead',
        path: '/v2/composite/final-reconciliation',
        body: {
          completedTasks: [refs.taskId],
          citedMessages: [refs.messageId],
          citedArtifactRefs: [refs.artifactId],
          summary: 'all done',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accepted: true,
        composite: 'final-reconciliation',
        runStatus: 'succeeded',
        turnDisposition: 'terminal',
        auditSummary: {
          summary: 'all done',
          completedTaskIds: [refs.taskId],
          citedMessageIds: [refs.messageId],
          citedArtifactRefs: [refs.artifactId],
          unresolvedIssues: [],
          audit: {
            status: 'pass',
            failures: [],
          },
        },
      });
      const runCompleted = kernel.eventLog.read().at(-1);
      expect(runCompleted).toMatchObject({
        kind: 'run_completed',
        payload: {
          status: 'succeeded',
        },
      });
      expect(JSON.parse(runCompleted?.kind === 'run_completed' ? runCompleted.payload.summary ?? '{}' : '{}')).toEqual({
        completedTasks: [refs.taskId],
        citedMessages: [refs.messageId],
        citedArtifactRefs: [refs.artifactId],
        unresolvedIssues: [],
        summary: 'all done',
        audit: {
          status: 'pass',
          failures: [],
        },
      });

      const evidence = JSON.parse(await readFile(join(runDir, 'evidence', 'final-reconciliation.json'), 'utf8'));
      expect(evidence).toEqual({
        summary: 'all done',
        completedTaskIds: [refs.taskId],
        citedMessageIds: [refs.messageId],
        citedArtifactRefs: [refs.artifactId],
        unresolvedIssues: [],
        audit: {
          status: 'pass',
          failures: [],
        },
      });
    });
  });

  it('final-reconciliation records unresolved issues without failing audit', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore, runDir }) => {
      const refs = seedFinalReconciliationState(kernel, { taskState: 'completed' });

      leaseStore.setCurrent(LEAD);
      const response = await requestApi({
        rootUrl,
        actor: 'role:lead',
        path: '/v2/composite/final-reconciliation',
        body: {
          completedTasks: [refs.taskId],
          citedMessages: [refs.messageId],
          unresolvedIssues: ['follow up on deployment notes'],
          summary: 'all done',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accepted: true,
        composite: 'final-reconciliation',
        runStatus: 'succeeded',
        auditSummary: {
          citedArtifactRefs: [],
          unresolvedIssues: ['follow up on deployment notes'],
          audit: {
            status: 'pass',
            failures: [],
          },
        },
      });

      const evidence = JSON.parse(await readFile(join(runDir, 'evidence', 'final-reconciliation.json'), 'utf8'));
      expect(evidence).toMatchObject({
        unresolvedIssues: ['follow up on deployment notes'],
        audit: {
          status: 'pass',
          failures: [],
        },
      });
    });
  });

  it('final-reconciliation fails audit when a cited task is missing', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore, runDir }) => {
      const refs = seedFinalReconciliationState(kernel, { taskState: 'completed' });

      leaseStore.setCurrent(LEAD);
      const response = await requestApi({
        rootUrl,
        actor: 'role:lead',
        path: '/v2/composite/final-reconciliation',
        body: {
          completedTasks: ['missing-task'],
          citedMessages: [refs.messageId],
          citedArtifactRefs: [refs.artifactId],
          summary: 'all done',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accepted: true,
        composite: 'final-reconciliation',
        runStatus: 'failed',
        auditSummary: {
          audit: {
            status: 'failed_audit',
            failures: [{ kind: 'missing_task', ref: 'missing-task' }],
          },
        },
      });

      const runCompleted = kernel.eventLog.read().at(-1);
      expect(runCompleted).toMatchObject({
        kind: 'run_completed',
        payload: {
          status: 'failed',
          summary: expect.stringMatching(/^FAILED_AUDIT: /),
        },
      });

      const evidence = JSON.parse(await readFile(join(runDir, 'evidence', 'final-reconciliation.json'), 'utf8'));
      expect(evidence.audit).toEqual({
        status: 'failed_audit',
        failures: [{ kind: 'missing_task', ref: 'missing-task' }],
      });
    });
  });

  it('final-reconciliation fails audit when a cited task is not terminal', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore, runDir }) => {
      const refs = seedFinalReconciliationState(kernel);

      leaseStore.setCurrent(LEAD);
      const response = await requestApi({
        rootUrl,
        actor: 'role:lead',
        path: '/v2/composite/final-reconciliation',
        body: {
          completedTasks: [refs.taskId],
          citedMessages: [refs.messageId],
          citedArtifactRefs: [refs.artifactId],
          summary: 'all done',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        runStatus: 'failed',
        auditSummary: {
          audit: {
            status: 'failed_audit',
            failures: [{ kind: 'non_terminal_task', ref: refs.taskId }],
          },
        },
      });

      const evidence = JSON.parse(await readFile(join(runDir, 'evidence', 'final-reconciliation.json'), 'utf8'));
      expect(evidence.audit).toEqual({
        status: 'failed_audit',
        failures: [{ kind: 'non_terminal_task', ref: refs.taskId }],
      });
    });
  });

  it('final-reconciliation fails audit when a cited mailbox message is missing', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore, runDir }) => {
      const refs = seedFinalReconciliationState(kernel, { taskState: 'completed' });

      leaseStore.setCurrent(LEAD);
      const response = await requestApi({
        rootUrl,
        actor: 'role:lead',
        path: '/v2/composite/final-reconciliation',
        body: {
          completedTasks: [refs.taskId],
          citedMessages: ['9999'],
          citedArtifactRefs: [refs.artifactId],
          summary: 'all done',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        runStatus: 'failed',
        auditSummary: {
          audit: {
            status: 'failed_audit',
            failures: [{ kind: 'missing_message', ref: '9999' }],
          },
        },
      });

      const evidence = JSON.parse(await readFile(join(runDir, 'evidence', 'final-reconciliation.json'), 'utf8'));
      expect(evidence.audit).toEqual({
        status: 'failed_audit',
        failures: [{ kind: 'missing_message', ref: '9999' }],
      });
    });
  });

  it('final-reconciliation fails audit when a cited artifact is missing', async () => {
    await withApi(async ({ rootUrl, kernel, leaseStore, runDir }) => {
      const refs = seedFinalReconciliationState(kernel, { taskState: 'completed' });

      leaseStore.setCurrent(LEAD);
      const response = await requestApi({
        rootUrl,
        actor: 'role:lead',
        path: '/v2/composite/final-reconciliation',
        body: {
          completedTasks: [refs.taskId],
          citedMessages: [refs.messageId],
          citedArtifactRefs: ['missing-artifact'],
          summary: 'all done',
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        runStatus: 'failed',
        auditSummary: {
          audit: {
            status: 'failed_audit',
            failures: [{ kind: 'missing_artifact', ref: 'missing-artifact' }],
          },
        },
      });

      const evidence = JSON.parse(await readFile(join(runDir, 'evidence', 'final-reconciliation.json'), 'utf8'));
      expect(evidence.audit).toEqual({
        status: 'failed_audit',
        failures: [{ kind: 'missing_artifact', ref: 'missing-artifact' }],
      });
    });
  });
});
