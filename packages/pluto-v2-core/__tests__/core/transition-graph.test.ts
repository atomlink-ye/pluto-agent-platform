import { describe, expect, it } from 'vitest';

import { ProtocolRequestSchema } from '../../src/protocol-request.js';
import { TASK_STATE_VALUES, type TaskState } from '../../src/run-event.js';
import {
  CANONICAL_AUTHORITY_POLICY,
  TRANSITION_GRAPH,
  TeamContextSchema,
  initialState,
  transitionLegal,
  validate,
} from '../../src/core/index.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const states: TaskState[] = [...TASK_STATE_VALUES];
const grid = states.flatMap((from) => states.map((to) => ({ from, to })));

describe('TRANSITION_GRAPH', () => {
  it('matches the frozen v2 transition graph verbatim', () => {
    expect(TRANSITION_GRAPH).toEqual({
      queued: ['running', 'blocked', 'completed', 'failed', 'cancelled'],
      running: ['completed', 'blocked', 'failed', 'cancelled'],
      blocked: ['running', 'completed', 'failed', 'cancelled'],
      completed: [],
      failed: [],
      cancelled: [],
    });
  });

  it.each(grid)('$from -> $to', ({ from, to }) => {
    const teamContext = TeamContextSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/hello-team',
      runProfileRef: 'fake-smoke',
      declaredActors: [{ kind: 'manager' }],
      initialTasks: [{ taskId: 'task-1', title: 'Task', ownerActor: null, dependsOn: [] }],
      policy: CANONICAL_AUTHORITY_POLICY,
    });
    const state = initialState(teamContext);
    state.tasks['task-1'] = { state: from, ownerActor: null };

    const request = ProtocolRequestSchema.parse({
      requestId: uuid(`${states.indexOf(from)}${states.indexOf(to)}`),
      runId: 'run-1',
      actor: { kind: 'manager' },
      intent: 'change_task_state',
      payload: { taskId: 'task-1', to },
      idempotencyKey: null,
      clientTimestamp: '2026-05-07T00:00:00.000Z',
      schemaVersion: '1.0',
    });

    const expected = (TRANSITION_GRAPH[from] as readonly TaskState[]).includes(to);

    expect(transitionLegal(from, to)).toBe(expected);

    if (expected) {
      expect(validate(state, request)).toEqual({ ok: true });
      return;
    }

    expect(validate(state, request)).toEqual({
      ok: false,
      reason: 'state_conflict',
      detail: `Transition ${from} -> ${to} is not legal for task task-1.`,
    });
  });
});
