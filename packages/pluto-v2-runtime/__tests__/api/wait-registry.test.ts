import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_VERSION, type ActorRef, type RunEvent } from '@pluto/v2-core';

import type { PromptView } from '../../src/adapters/paseo/prompt-view.js';
import { makeWaitRegistry, type WaitTraceEvent } from '../../src/api/wait-registry.js';

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const PLANNER: ActorRef = { kind: 'role', role: 'planner' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

function promptViewFor(actor: ActorRef, overrides?: Partial<PromptView>): PromptView {
  return {
    run: {
      runId: 'run-1',
      scenarioRef: 'scenario/wait-registry',
      runProfileRef: 'unit-test',
    },
    userTask: actor.kind === 'role' && actor.role === 'lead' ? 'Ship it.' : null,
    forActor: actor,
    playbook: null,
    budgets: {
      turnIndex: 1,
      maxTurns: 10,
      parseFailuresThisTurn: 0,
      maxParseFailuresPerTurn: 0,
      kernelRejections: 0,
      maxKernelRejections: 3,
      noProgressTurns: 0,
      maxNoProgressTurns: 3,
    },
    tasks: [],
    mailbox: [],
    artifacts: [],
    activeDelegation: null,
    lastRejection: null,
    ...overrides,
  };
}

function baseEvent(sequence: number, actor: ActorRef) {
  return {
    eventId: `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`,
    requestId: `00000000-0000-4000-8000-${String(sequence + 101).padStart(12, '0')}`,
    runId: 'run-1',
    actor,
    timestamp: `2026-05-08T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    sequence,
    schemaVersion: SCHEMA_VERSION,
  };
}

function taskCreated(sequence: number, actor: ActorRef, ownerActor: ActorRef = GENERATOR): RunEvent {
  return {
    ...baseEvent(sequence, actor),
    kind: 'task_created',
    outcome: 'accepted',
    payload: {
      taskId: 'task-1',
      title: 'Draft artifact',
      ownerActor,
      dependsOn: [],
    },
  } as unknown as RunEvent;
}

function taskStateChanged(sequence: number, actor: ActorRef, to: 'running' | 'completed'): RunEvent {
  return {
    ...baseEvent(sequence, actor),
    kind: 'task_state_changed',
    outcome: 'accepted',
    payload: {
      taskId: 'task-1',
      to,
    },
  } as unknown as RunEvent;
}

function mailboxAppended(sequence: number, fromActor: ActorRef, toActor: ActorRef): RunEvent {
  return {
    ...baseEvent(sequence, fromActor),
    kind: 'mailbox_message_appended',
    outcome: 'accepted',
    payload: {
      messageId: `message-${sequence}`,
      fromActor,
      toActor,
      kind: 'completion',
      body: 'done',
    },
  } as unknown as RunEvent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('makeWaitRegistry', () => {
  it('returns immediately when a visible event already exists past the cursor', async () => {
    const events = [taskCreated(0, LEAD)];
    const traces: WaitTraceEvent[] = [];
    const registry = makeWaitRegistry({
      events: () => events,
      getPromptViewForActor: (actor) => promptViewFor(actor, {
        tasks: [{ id: 'task-1', title: 'Draft artifact', ownerActor: GENERATOR, state: 'queued' }],
      }),
      onTrace: (event) => traces.push(event),
    });

    const result = await registry.arm({ actor: GENERATOR, fromSequence: -1, timeoutMs: 5_000 });

    expect(result).toMatchObject({
      outcome: 'event',
      payload: {
        latestEvent: { kind: 'task_created', sequence: 0 },
      },
    });
    if (result.outcome === 'event') {
      expect(result.payload.delta.newTasks).toHaveLength(1);
    }
    expect(traces).toEqual([]);
  });

  it('parks and unblocks when notify delivers a visible event', async () => {
    const events: RunEvent[] = [];
    const traces: WaitTraceEvent[] = [];
    const registry = makeWaitRegistry({
      events: () => events,
      getPromptViewForActor: (actor) => promptViewFor(actor, {
        tasks: [{ id: 'task-1', title: 'Draft artifact', ownerActor: GENERATOR, state: 'running' }],
      }),
      onTrace: (event) => traces.push(event),
    });

    const parked = registry.arm({ actor: GENERATOR, fromSequence: -1, timeoutMs: 5_000 });
    await vi.waitFor(() => {
      expect(registry.hasArmedWait(GENERATOR)).toBe(true);
    });
    const event = taskStateChanged(0, GENERATOR, 'running');
    events.push(event);
    registry.notify(event, (actor) => promptViewFor(actor, {
      tasks: [{ id: 'task-1', title: 'Draft artifact', ownerActor: GENERATOR, state: 'running' }],
    }));

    await expect(parked).resolves.toMatchObject({
      outcome: 'event',
      payload: {
        latestEvent: { kind: 'task_state_changed', sequence: 0 },
      },
    });
    await vi.waitFor(() => {
      expect(traces.map((trace) => trace.kind)).toEqual(['wait_armed', 'wait_unblocked']);
    });
  });

  it('does not lose a wakeup when arm and notify happen back-to-back', async () => {
    const events: RunEvent[] = [];
    const registry = makeWaitRegistry({
      events: () => events,
      getPromptViewForActor: (actor) => promptViewFor(actor, {
        mailbox: [{ sequence: 0, from: GENERATOR, to: LEAD, kind: 'completion', body: 'done' }],
      }),
    });

    const parked = registry.arm({ actor: LEAD, fromSequence: -1, timeoutMs: 5_000 });
    const event = mailboxAppended(0, GENERATOR, LEAD);
    events.push(event);
    registry.notify(event, (actor) => promptViewFor(actor, {
      mailbox: [{ sequence: 0, from: GENERATOR, to: LEAD, kind: 'completion', body: 'done' }],
    }));

    await expect(parked).resolves.toMatchObject({
      outcome: 'event',
      payload: {
        latestEvent: { kind: 'mailbox_message_appended', sequence: 0 },
      },
    });
  });

  it('cancels the prior parked wait when the same actor arms again', async () => {
    const events: RunEvent[] = [];
    const registry = makeWaitRegistry({
      events: () => events,
      getPromptViewForActor: (actor) => promptViewFor(actor),
    });

    const first = registry.arm({ actor: LEAD, fromSequence: -1, timeoutMs: 5_000 });
    const second = registry.arm({ actor: LEAD, fromSequence: -1, timeoutMs: 5_000 });

    await expect(first).resolves.toEqual({ outcome: 'cancelled', reason: 'replaced' });
    registry.cancelForActor(LEAD, 'cleanup');
    await expect(second).resolves.toEqual({ outcome: 'cancelled', reason: 'cleanup' });
  });

  it('keeps waits isolated across actors', async () => {
    const events: RunEvent[] = [];
    const registry = makeWaitRegistry({
      events: () => events,
      getPromptViewForActor: (actor) => promptViewFor(actor, {
        mailbox: actor.kind === 'role' && actor.role === 'generator'
          ? [{ sequence: 0, from: LEAD, to: GENERATOR, kind: 'completion', body: 'done' }]
          : [],
      }),
    });

    const plannerWait = registry.arm({ actor: PLANNER, fromSequence: -1, timeoutMs: 5_000 });
    const generatorWait = registry.arm({ actor: GENERATOR, fromSequence: -1, timeoutMs: 5_000 });
    const event = mailboxAppended(0, LEAD, GENERATOR);
    events.push(event);
    registry.notify(event, (actor) => promptViewFor(actor, {
      mailbox: actor.kind === 'role' && actor.role === 'generator'
        ? [{ sequence: 0, from: LEAD, to: GENERATOR, kind: 'completion', body: 'done' }]
        : [],
    }));

    await expect(generatorWait).resolves.toMatchObject({
      outcome: 'event',
      payload: { latestEvent: { sequence: 0 } },
    });
    expect(registry.hasArmedWait(PLANNER)).toBe(true);
    registry.cancelForActor(PLANNER, 'cleanup');
    await expect(plannerWait).resolves.toEqual({ outcome: 'cancelled', reason: 'cleanup' });
  });

  it('cancels a single actor on demand', async () => {
    const events: RunEvent[] = [];
    const traces: WaitTraceEvent[] = [];
    const registry = makeWaitRegistry({
      events: () => events,
      getPromptViewForActor: (actor) => promptViewFor(actor),
      onTrace: (event) => traces.push(event),
    });

    const parked = registry.arm({ actor: GENERATOR, fromSequence: -1, timeoutMs: 5_000 });
    registry.cancelForActor(GENERATOR, 'actor_deleted');

    await expect(parked).resolves.toEqual({ outcome: 'cancelled', reason: 'actor_deleted' });
    await vi.waitFor(() => {
      expect(traces.map((trace) => trace.kind)).toEqual(['wait_armed', 'wait_cancelled']);
    });
  });

  it('cancels all parked waits', async () => {
    const events: RunEvent[] = [];
    const registry = makeWaitRegistry({
      events: () => events,
      getPromptViewForActor: (actor) => promptViewFor(actor),
    });

    const leadWait = registry.arm({ actor: LEAD, fromSequence: -1, timeoutMs: 5_000 });
    const generatorWait = registry.arm({ actor: GENERATOR, fromSequence: -1, timeoutMs: 5_000 });
    registry.cancelAll('run_complete');

    await expect(leadWait).resolves.toEqual({ outcome: 'cancelled', reason: 'run_complete' });
    await expect(generatorWait).resolves.toEqual({ outcome: 'cancelled', reason: 'run_complete' });
  });

  it('times out a parked wait', async () => {
    vi.useFakeTimers();
    const events: RunEvent[] = [];
    const traces: WaitTraceEvent[] = [];
    const registry = makeWaitRegistry({
      events: () => events,
      getPromptViewForActor: (actor) => promptViewFor(actor),
      onTrace: (event) => traces.push(event),
    });

    const parked = registry.arm({ actor: LEAD, fromSequence: -1, timeoutMs: 250 });
    await vi.advanceTimersByTimeAsync(250);

    await expect(parked).resolves.toEqual({ outcome: 'timeout' });
    await vi.waitFor(() => {
      expect(traces.map((trace) => trace.kind)).toEqual(['wait_armed', 'wait_timed_out']);
    });
  });
});
