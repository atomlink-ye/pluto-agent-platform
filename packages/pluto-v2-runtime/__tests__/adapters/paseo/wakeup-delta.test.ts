import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, type ActorRef, type RunEvent } from '@pluto/v2-core';

import { buildPromptView, type PromptViewInput } from '../../../src/adapters/paseo/prompt-view.js';
import { computeWakeupDelta } from '../../../src/adapters/paseo/wakeup-delta.js';
import type { LoadedAuthoredSpec } from '../../../src/loader/authored-spec-loader.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };
const EVALUATOR: ActorRef = { kind: 'role', role: 'evaluator' };
const MANAGER: ActorRef = { kind: 'manager' };

const SPEC: LoadedAuthoredSpec = {
  runId: RUN_ID,
  scenarioRef: 'scenario/wakeup-delta',
  runProfileRef: 'paseo-agentic-tool',
  actors: {
    manager: MANAGER,
    lead: LEAD,
    generator: GENERATOR,
    evaluator: EVALUATOR,
  },
  declaredActors: ['manager', 'lead', 'generator', 'evaluator'],
  userTask: 'Ship the first draft.',
  playbookRef: 'playbooks/agentic.md',
  playbook: null,
};

const BUDGETS: PromptViewInput['budgets'] = {
  turnIndex: 4,
  maxTurns: 20,
  parseFailuresThisTurn: 0,
  maxParseFailuresPerTurn: 0,
  kernelRejections: 1,
  maxKernelRejections: 3,
  noProgressTurns: 0,
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

function taskCreated(sequence: number): RunEvent {
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
    entityRef: { kind: 'task', taskId: 'task-1' },
    outcome: 'accepted',
    payload: {
      taskId: 'task-1',
      title: 'Draft the first artifact for the current delegated change',
      ownerActor: GENERATOR,
      dependsOn: [],
    },
  };
}

function taskStateChanged(sequence: number): RunEvent {
  return {
    kind: 'task_state_changed',
    eventId: eventId(sequence),
    runId: RUN_ID,
    sequence,
    timestamp: timestamp(sequence),
    schemaVersion: SCHEMA_VERSION,
    actor: GENERATOR,
    requestId: requestId(sequence),
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'task', taskId: 'task-1' },
    outcome: 'accepted',
    payload: {
      taskId: 'task-1',
      from: 'queued',
      to: 'running',
    },
  };
}

function mailboxMessage(sequence: number, fromActor: ActorRef, toActor: ActorRef, body: string): RunEvent {
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
      kind: 'completion',
      body,
    },
  };
}

function artifactPublished(sequence: number): RunEvent {
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
    entityRef: { kind: 'artifact', artifactId: 'artifact-1' },
    outcome: 'accepted',
    payload: {
      artifactId: 'artifact-1',
      kind: 'intermediate',
      mediaType: 'text/markdown',
      byteSize: 128,
    },
  };
}

describe('computeWakeupDelta', () => {
  it('includes only actor-visible events after the cursor and keeps always-on snapshots', () => {
    const events = [
      runStarted(0),
      taskCreated(1),
      mailboxMessage(2, LEAD, GENERATOR, 'delegate draft'),
      mailboxMessage(3, EVALUATOR, LEAD, 'lead-only review note'),
      taskStateChanged(4),
      artifactPublished(5),
      mailboxMessage(6, GENERATOR, LEAD, 'artifact ready'),
    ];
    const currentPromptView = buildPromptView({
      spec: SPEC,
      events,
      forActor: GENERATOR,
      budgets: BUDGETS,
      activeDelegation: GENERATOR,
      lastRejection: {
        directive: {
          kind: 'append_mailbox_message',
          payload: {
            fromActor: GENERATOR,
            toActor: LEAD,
            kind: 'completion',
            body: 'artifact ready',
          },
        },
        error: 'PLUTO_TOOL_BAD_ARGS: body must be non-empty',
      },
    });

    const delta = computeWakeupDelta({
      events,
      fromSequence: 2,
      forActor: GENERATOR,
      currentPromptView,
    });

    expect(delta.newTasks).toEqual([]);
    expect(delta.updatedTasks).toEqual([
      expect.objectContaining({ id: 'task-1', state: 'running' }),
    ]);
    expect(delta.newMailbox).toEqual([
      expect.objectContaining({ sequence: 6, body: 'artifact ready' }),
    ]);
    expect(delta.newMailbox.map((message) => message.sequence)).not.toContain(3);
    expect(delta.newArtifacts).toEqual([
      expect.objectContaining({ id: 'artifact-1', byteSize: 128 }),
    ]);
    expect(delta.delegation).toEqual(GENERATOR);
    expect(delta.budgets).toEqual(BUDGETS);
    expect(delta.lastRejection?.error).toContain('PLUTO_TOOL_BAD_ARGS');
  });
});
