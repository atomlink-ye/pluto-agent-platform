import { describe, expect, it } from 'vitest';

import * as packageRoot from '../../src/index.js';
import { AUTHORITY_MATRIX, compile, type AuthoredSpec } from '../../src/core/index.js';
import { SpecCompileError, type SpecCompileErrorCode } from '../../src/core/spec-compiler.js';

function createBaseSpec(): AuthoredSpec {
  return {
    runId: 'run-1',
    scenarioRef: 'scenario/hello-team',
    runProfileRef: 'fake-smoke',
    actors: {
      manager: { kind: 'manager' },
      lead: { kind: 'role', role: 'lead' },
      planner: { kind: 'role', role: 'planner' },
      generator: { kind: 'role', role: 'generator' },
      evaluator: { kind: 'role', role: 'evaluator' },
      system: { kind: 'system' },
    },
    declaredActors: ['manager', 'lead', 'planner', 'generator', 'evaluator', 'system'],
    initialTasks: [
      {
        taskId: 'task-1',
        title: 'Implement Lane E',
        ownerActor: 'generator',
        dependsOn: [],
      },
    ],
  };
}

function createAuthoredCanonicalPolicy() {
  return {
    append_mailbox_message: [
      { kind: 'manager' },
      { kind: 'role', role: 'lead' },
      { kind: 'role', role: 'planner' },
      { kind: 'role', role: 'generator' },
      { kind: 'role', role: 'evaluator' },
      { kind: 'system' },
    ],
    create_task: [
      { kind: 'manager' },
      { kind: 'role', role: 'lead' },
      { kind: 'role', role: 'planner' },
    ],
    change_task_state: [
      { kind: 'manager' },
      { kind: 'role', role: 'lead' },
      { kind: 'role-owns-task', role: 'generator' },
      { kind: 'role-owns-task', role: 'evaluator' },
      { kind: 'role-bounded-transitions', role: 'planner', transitions: ['blocked', 'cancelled'] },
    ],
    publish_artifact: [
      { kind: 'role', role: 'generator' },
      { kind: 'role', role: 'lead' },
      { kind: 'manager' },
    ],
    complete_run: [{ kind: 'manager' }],
  } as const;
}

function expectCompileError(spec: unknown, code: SpecCompileErrorCode) {
  expect(() => compile(spec as never)).toThrowError(SpecCompileError);

  try {
    compile(spec as never);
    throw new Error('Expected compile() to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(SpecCompileError);
    expect((error as SpecCompileError).code).toBe(code);
  }
}

describe('compile', () => {
  it('compiles a well-formed authored spec into TeamContext', () => {
    const compiled = compile(createBaseSpec());

    expect(compiled).toEqual({
      runId: 'run-1',
      scenarioRef: 'scenario/hello-team',
      runProfileRef: 'fake-smoke',
      declaredActors: [
        { kind: 'manager' },
        { kind: 'role', role: 'lead' },
        { kind: 'role', role: 'planner' },
        { kind: 'role', role: 'generator' },
        { kind: 'role', role: 'evaluator' },
        { kind: 'system' },
      ],
      initialTasks: [
        {
          taskId: 'task-1',
          title: 'Implement Lane E',
          ownerActor: { kind: 'role', role: 'generator' },
          dependsOn: [],
        },
      ],
      policy: AUTHORITY_MATRIX,
    });
  });

  it('re-exports the core surface from the package root index', () => {
    expect(packageRoot.compile).toBe(compile);
    expect(packageRoot.AUTHORITY_MATRIX).toBe(AUTHORITY_MATRIX);
    expect(packageRoot.RunKernel).toBeTypeOf('function');
    expect(packageRoot.reduce).toBeTypeOf('function');
    expect(packageRoot.composeRequestKey).toBeTypeOf('function');
  });

  it('throws unknown_actor for undeclared actor references', () => {
    expectCompileError(
      {
        ...createBaseSpec(),
        declaredActors: ['manager', 'missing-actor'],
      },
      'unknown_actor',
    );
  });

  it('throws duplicate_task for duplicate initial task ids', () => {
    expectCompileError(
      {
        ...createBaseSpec(),
        initialTasks: [
          {
            taskId: 'task-1',
            title: 'Implement Lane E',
            ownerActor: 'generator',
            dependsOn: [],
          },
          {
            taskId: 'task-1',
            title: 'Duplicate Lane E task',
            ownerActor: 'generator',
            dependsOn: [],
          },
        ],
      },
      'duplicate_task',
    );
  });

  it('throws policy_invalid when policy does not define the full closed matrix', () => {
    const { complete_run: _completeRun, ...partialPolicy } = createAuthoredCanonicalPolicy();

    expectCompileError(
      {
        ...createBaseSpec(),
        policy: partialPolicy,
      },
      'policy_invalid',
    );
  });

  it('throws intent_payload_mismatch for intent-incompatible policy matchers', () => {
    expectCompileError(
      {
        ...createBaseSpec(),
        policy: {
          ...createAuthoredCanonicalPolicy(),
          publish_artifact: [
            { kind: 'role-bounded-transitions', role: 'planner', transitions: ['blocked', 'cancelled'] },
          ],
        },
      },
      'intent_payload_mismatch',
    );
  });

  it('throws actor_role_unknown for authored role names outside the closed set', () => {
    expectCompileError(
      {
        ...createBaseSpec(),
        actors: {
          ...createBaseSpec().actors,
          reviewer: { kind: 'role', role: 'reviewer' },
        },
        declaredActors: ['reviewer'],
      },
      'actor_role_unknown',
    );
  });
});
