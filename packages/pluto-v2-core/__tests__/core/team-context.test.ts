import { describe, expect, it } from 'vitest';

import { AuthoredSpecSchema, FakeScriptStepSchema } from '../../src/index.js';

describe('FakeScriptStepSchema', () => {
  it('accepts fakeScript steps with event payload refs', () => {
    const parsed = FakeScriptStepSchema.parse({
      actor: { kind: 'role', role: 'planner' },
      intent: 'change_task_state',
      payload: {
        taskId: { $ref: 'events[0].payload.taskId' },
        to: 'running',
      },
      idempotencyKey: 'idem-task-1',
    });

    if (parsed.intent !== 'change_task_state') {
      throw new Error(`Expected change_task_state, received ${parsed.intent}`);
    }

    expect(parsed.payload.taskId).toEqual({ $ref: 'events[0].payload.taskId' });
  });

  it('rejects fakeScript refs outside the closed grammar', () => {
    expect(() =>
      FakeScriptStepSchema.parse({
        actor: { kind: 'role', role: 'planner' },
        intent: 'change_task_state',
        payload: {
          taskId: { $ref: 'events[-1].payload.taskId' },
          to: 'running',
        },
      }),
    ).toThrow(/Invalid/);
  });
});

describe('AuthoredSpecSchema fakeScript', () => {
  it('accepts authored specs without fakeScript', () => {
    const parsed = AuthoredSpecSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/hello-team',
      runProfileRef: 'fake-smoke',
      actors: {
        manager: { kind: 'manager' },
        planner: { kind: 'role', role: 'planner' },
      },
      declaredActors: ['manager', 'planner'],
    });

    expect(parsed.fakeScript).toBeUndefined();
  });

  it('accepts complete_run fakeScript steps on authored specs', () => {
    const parsed = AuthoredSpecSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/hello-team',
      runProfileRef: 'fake-smoke',
      actors: {
        manager: { kind: 'manager' },
      },
      declaredActors: ['manager'],
      fakeScript: [
        {
          actor: { kind: 'manager' },
          intent: 'complete_run',
          payload: {
            status: 'succeeded',
            summary: 'Done.',
          },
        },
      ],
    });

    expect(parsed.fakeScript).toHaveLength(1);
  });

  it('accepts strict agentic orchestration fields on authored specs', () => {
    const parsed = AuthoredSpecSchema.parse({
      runId: 'run-1',
      scenarioRef: 'scenario/hello-team',
      runProfileRef: 'fake-smoke',
      actors: {
        manager: { kind: 'manager' },
        lead: { kind: 'role', role: 'lead' },
      },
      declaredActors: ['manager', 'lead'],
      orchestration: {
        mode: 'agentic',
        maxTurns: 20,
        maxParseFailuresPerTurn: 2,
        maxKernelRejections: 3,
        maxNoProgressTurns: 3,
      },
      userTask: 'Ship the T1 lane 1 schema changes.',
      playbookRef: 'playbooks/team-lead.md',
    });

    expect(parsed.orchestration).toEqual({
      mode: 'agentic',
      maxTurns: 20,
      maxParseFailuresPerTurn: 2,
      maxKernelRejections: 3,
      maxNoProgressTurns: 3,
    });
    expect(parsed.userTask).toBe('Ship the T1 lane 1 schema changes.');
    expect(parsed.playbookRef).toBe('playbooks/team-lead.md');
  });

  it('rejects unknown orchestration fields while keeping AuthoredSpecSchema strict', () => {
    expect(() =>
      AuthoredSpecSchema.parse({
        runId: 'run-1',
        scenarioRef: 'scenario/hello-team',
        runProfileRef: 'fake-smoke',
        actors: {
          manager: { kind: 'manager' },
          lead: { kind: 'role', role: 'lead' },
        },
        declaredActors: ['manager', 'lead'],
        orchestration: {
          mode: 'agentic',
          extra: true,
        },
      }),
    ).toThrow(/unrecognized key/i);
  });
});
