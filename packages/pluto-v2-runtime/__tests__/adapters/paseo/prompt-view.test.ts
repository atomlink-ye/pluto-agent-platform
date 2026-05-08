import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, type ActorRef, type AuthoredSpec, type RunEvent } from '@pluto/v2-core';

import { buildPromptView, type PromptViewInput } from '../../../src/adapters/paseo/prompt-view.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };
const EVALUATOR: ActorRef = { kind: 'role', role: 'evaluator' };
const MANAGER: ActorRef = { kind: 'manager' };

const SPEC: AuthoredSpec = {
  runId: RUN_ID,
  scenarioRef: 'scenario/prompt-view',
  runProfileRef: 'paseo-agentic',
  actors: {
    manager: MANAGER,
    lead: LEAD,
    generator: GENERATOR,
    evaluator: EVALUATOR,
  },
  declaredActors: ['manager', 'lead', 'generator', 'evaluator'],
  userTask: 'Ship the first draft.',
  playbookRef: 'playbooks/agentic.md',
};

const BUDGETS: PromptViewInput['budgets'] = {
  turnIndex: 3,
  maxTurns: 20,
  parseFailuresThisTurn: 1,
  maxParseFailuresPerTurn: 2,
  kernelRejections: 2,
  maxKernelRejections: 3,
  noProgressTurns: 1,
  maxNoProgressTurns: 3,
};

function eventId(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

function requestId(sequence: number): string {
  return `10000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

function timestamp(sequence: number): string {
  return `2026-05-08T00:00:${sequence.toString().padStart(2, '0')}.000Z`;
}

function runStarted(sequence: number): RunEvent {
  return {
    kind: 'run_started',
    eventId: eventId(sequence),
    runId: RUN_ID,
    sequence,
    timestamp: timestamp(sequence),
    schemaVersion: SCHEMA_VERSION,
    actor: { kind: 'system' },
    requestId: null,
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'run', runId: RUN_ID },
    outcome: 'accepted',
    payload: {
      scenarioRef: SPEC.scenarioRef,
      runProfileRef: SPEC.runProfileRef,
      startedAt: timestamp(sequence),
    },
  };
}

function taskCreated(sequence: number, taskId: string, title: string, ownerActor: ActorRef): RunEvent {
  return {
    kind: 'task_created',
    eventId: eventId(sequence),
    runId: RUN_ID,
    sequence,
    timestamp: timestamp(sequence),
    schemaVersion: SCHEMA_VERSION,
    actor: LEAD,
    requestId: requestId(sequence),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'task', taskId },
    outcome: 'accepted',
    payload: {
      taskId,
      title,
      ownerActor,
      dependsOn: [],
    },
  };
}

function taskStateChanged(sequence: number, taskId: string, from: 'queued' | 'running', to: 'running' | 'completed'): RunEvent {
  return {
    kind: 'task_state_changed',
    eventId: eventId(sequence),
    runId: RUN_ID,
    sequence,
    timestamp: timestamp(sequence),
    schemaVersion: SCHEMA_VERSION,
    actor: MANAGER,
    requestId: requestId(sequence),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'task', taskId },
    outcome: 'accepted',
    payload: {
      taskId,
      from,
      to,
    },
  };
}

function mailboxMessage(
  sequence: number,
  fromActor: ActorRef,
  toActor: ActorRef,
  kind: 'plan' | 'task' | 'completion' | 'final',
  body: string,
): RunEvent {
  return {
    kind: 'mailbox_message_appended',
    eventId: eventId(sequence),
    runId: RUN_ID,
    sequence,
    timestamp: timestamp(sequence),
    schemaVersion: SCHEMA_VERSION,
    actor: fromActor,
    requestId: requestId(sequence),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'mailbox_message', messageId: `message-${sequence}` },
    outcome: 'accepted',
    payload: {
      messageId: `message-${sequence}`,
      fromActor,
      toActor,
      kind,
      body,
    },
  };
}

function artifactPublished(sequence: number, artifactId: string, byteSize: number): RunEvent {
  return {
    kind: 'artifact_published',
    eventId: eventId(sequence),
    runId: RUN_ID,
    sequence,
    timestamp: timestamp(sequence),
    schemaVersion: SCHEMA_VERSION,
    actor: GENERATOR,
    requestId: requestId(sequence),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'artifact', artifactId },
    outcome: 'accepted',
    payload: {
      artifactId,
      kind: 'intermediate',
      mediaType: 'text/markdown',
      byteSize,
    },
  };
}

function buildInput(overrides?: Partial<PromptViewInput>): PromptViewInput {
  return {
    spec: SPEC,
    events: [],
    forActor: LEAD,
    budgets: BUDGETS,
    activeDelegation: GENERATOR,
    lastRejection: {
      directive: {
        kind: 'append_mailbox_message',
        payload: {
          fromActor: GENERATOR,
          toActor: LEAD,
          kind: 'completion',
          body: 'draft complete',
        },
      },
      error: 'kernel rejected duplicate idempotency key',
    },
    ...overrides,
  };
}

describe('buildPromptView', () => {
  it('returns the lead mailbox with full visibility', () => {
    const view = buildPromptView(buildInput({
      events: [
        runStarted(0),
        mailboxMessage(1, LEAD, GENERATOR, 'task', 'delegate draft'),
        mailboxMessage(2, GENERATOR, LEAD, 'completion', 'draft ready'),
        mailboxMessage(3, EVALUATOR, LEAD, 'plan', 'review queued'),
      ],
    }));

    expect(view.mailbox.map((message) => message.sequence)).toEqual([1, 2, 3]);
    expect(view.mailbox.map((message) => message.body)).toEqual([
      'delegate draft',
      'draft ready',
      'review queued',
    ]);
  });

  it('filters mailbox entries to the sub-actor conversation surface', () => {
    const view = buildPromptView(buildInput({
      forActor: GENERATOR,
      events: [
        runStarted(0),
        mailboxMessage(1, LEAD, GENERATOR, 'task', 'delegate draft'),
        mailboxMessage(2, GENERATOR, LEAD, 'completion', 'draft ready'),
        mailboxMessage(3, EVALUATOR, LEAD, 'plan', 'review queued'),
      ],
    }));

    expect(view.mailbox.map((message) => message.sequence)).toEqual([1, 2]);
  });

  it('caps the mailbox to the most recent 50 messages and keeps ascending sequence order', () => {
    const events: RunEvent[] = [runStarted(0)];
    for (let sequence = 1; sequence <= 55; sequence += 1) {
      events.push(mailboxMessage(sequence, LEAD, GENERATOR, 'task', `message-${sequence}`));
    }

    const view = buildPromptView(buildInput({ events }));

    expect(view.mailbox).toHaveLength(50);
    expect(view.mailbox[0]?.sequence).toBe(6);
    expect(view.mailbox.at(-1)?.sequence).toBe(55);
    expect(view.mailbox.map((message) => message.sequence)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 6),
    );
  });

  it('sorts tasks by task id ascending and keeps the latest task state', () => {
    const view = buildPromptView(buildInput({
      events: [
        runStarted(0),
        taskCreated(1, 'task-20', 'second', EVALUATOR),
        taskCreated(2, 'task-10', 'first', GENERATOR),
        taskStateChanged(3, 'task-10', 'queued', 'running'),
        taskStateChanged(4, 'task-10', 'running', 'completed'),
      ],
    }));

    expect(view.tasks).toEqual([
      {
        id: 'task-10',
        title: 'first',
        ownerActor: GENERATOR,
        state: 'completed',
      },
      {
        id: 'task-20',
        title: 'second',
        ownerActor: EVALUATOR,
        state: 'queued',
      },
    ]);
  });

  it('surfaces budgets, delegation, rejection, and playbook metadata', () => {
    const specWithSha = {
      ...SPEC,
      playbookSha256: 'abc123sha',
    } as AuthoredSpec;

    const view = buildPromptView(buildInput({
      spec: specWithSha,
      events: [runStarted(0)],
    }));

    expect(view.budgets).toEqual(BUDGETS);
    expect(view.activeDelegation).toEqual(GENERATOR);
    expect(view.lastRejection).toEqual({
      directive: {
        kind: 'append_mailbox_message',
        payload: {
          fromActor: GENERATOR,
          toActor: LEAD,
          kind: 'completion',
          body: 'draft complete',
        },
      },
      error: 'kernel rejected duplicate idempotency key',
    });
    expect(view.playbook).toEqual({
      ref: 'playbooks/agentic.md',
      sha256: 'abc123sha',
    });
  });

  it('summarizes published artifacts without exposing raw events', () => {
    const view = buildPromptView(buildInput({
      events: [
        runStarted(0),
        artifactPublished(2, 'artifact-b', 200),
        artifactPublished(1, 'artifact-a', 100),
      ],
    }));

    expect(view.artifacts).toEqual([
      {
        id: 'artifact-a',
        kind: 'intermediate',
        mediaType: 'text/markdown',
        byteSize: 100,
      },
      {
        id: 'artifact-b',
        kind: 'intermediate',
        mediaType: 'text/markdown',
        byteSize: 200,
      },
    ]);
    expect(Object.keys(view)).not.toContain('events');
  });

  it('is byte-stable for identical input', () => {
    const input = buildInput({
      events: [
        runStarted(0),
        taskCreated(1, 'task-02', 'write', GENERATOR),
        taskCreated(2, 'task-01', 'plan', LEAD),
        mailboxMessage(3, LEAD, GENERATOR, 'task', 'delegate draft'),
        mailboxMessage(4, GENERATOR, LEAD, 'completion', 'draft ready'),
        artifactPublished(5, 'artifact-01', 64),
      ],
    });

    const first = JSON.stringify(buildPromptView(input), null, 2);
    const second = JSON.stringify(buildPromptView(input), null, 2);

    expect(first).toBe(second);
  });
});
