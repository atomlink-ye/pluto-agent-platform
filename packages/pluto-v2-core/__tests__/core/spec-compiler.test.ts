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

function createAgenticSpec(overrides: Partial<AuthoredSpec> = {}): AuthoredSpec {
  return {
    ...createBaseSpec(),
    orchestration: {
      mode: 'agentic',
      maxTurns: 20,
      maxParseFailuresPerTurn: 2,
      maxKernelRejections: 3,
      maxNoProgressTurns: 3,
    },
    userTask: 'Coordinate the team to complete the user task.',
    playbookRef: 'playbooks/team-lead.md',
    ...overrides,
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

  it('accepts a valid agentic authored spec while preserving the compiled TeamContext shape', () => {
    const compiled = compile(createAgenticSpec());

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

  it('throws orchestration_invalid when agentic mode omits a declared lead actor', () => {
    expectCompileError(
      createAgenticSpec({
        declaredActors: ['manager', 'planner', 'generator', 'evaluator', 'system'],
      }),
      'orchestration_invalid',
    );

    expect(() =>
      compile(
        createAgenticSpec({
          declaredActors: ['manager', 'planner', 'generator', 'evaluator', 'system'],
        }),
      ),
    ).toThrow(/agentic.*declaredActors.*lead/i);
  });

  it('throws orchestration_invalid when agentic mode maps actors.lead to the wrong actor kind', () => {
    expectCompileError(
      createAgenticSpec({
        actors: {
          ...createBaseSpec().actors,
          lead: { kind: 'system' },
        },
      }),
      'orchestration_invalid',
    );

    expect(() =>
      compile(
        createAgenticSpec({
          actors: {
            ...createBaseSpec().actors,
            lead: { kind: 'system' },
          },
        }),
      ),
    ).toThrow(/agentic.*actors\.lead/i);
  });

  it('throws orchestration_invalid when agentic mode omits the manager actor', () => {
    expectCompileError(
      createAgenticSpec({
        declaredActors: ['lead', 'planner', 'generator', 'evaluator', 'system'],
      }),
      'orchestration_invalid',
    );

    expect(() =>
      compile(
        createAgenticSpec({
          declaredActors: ['lead', 'planner', 'generator', 'evaluator', 'system'],
        }),
      ),
    ).toThrow(/agentic.*declaredActors.*manager/i);
  });

  it('throws orchestration_invalid when agentic mode maps actors.manager to the wrong actor kind', () => {
    expectCompileError(
      createAgenticSpec({
        actors: {
          ...createBaseSpec().actors,
          manager: { kind: 'role', role: 'lead' },
        },
      }),
      'orchestration_invalid',
    );

    expect(() =>
      compile(
        createAgenticSpec({
          actors: {
            ...createBaseSpec().actors,
            manager: { kind: 'role', role: 'lead' },
          },
        }),
      ),
    ).toThrow(/agentic.*actors\.manager/i);
  });

  it('throws orchestration_invalid when agentic mode provides an empty userTask', () => {
    expectCompileError(
      createAgenticSpec({
        userTask: '   ',
      }),
      'orchestration_invalid',
    );

    expect(() =>
      compile(
        createAgenticSpec({
          userTask: '   ',
        }),
      ),
    ).toThrow(/agentic.*userTask/i);
  });

  it('throws orchestration_invalid when agentic mode omits playbookRef', () => {
    expectCompileError(
      createAgenticSpec({
        playbookRef: undefined,
      }),
      'orchestration_invalid',
    );

    expect(() =>
      compile(
        createAgenticSpec({
          playbookRef: undefined,
        }),
      ),
    ).toThrow(/agentic.*playbookRef/i);
  });

  it('throws orchestration_invalid when agentic mode uses a non-markdown playbookRef', () => {
    expectCompileError(
      createAgenticSpec({
        playbookRef: 'playbooks/team-lead.txt',
      }),
      'orchestration_invalid',
    );

    expect(() =>
      compile(
        createAgenticSpec({
          playbookRef: 'playbooks/team-lead.txt',
        }),
      ),
    ).toThrow(/agentic.*playbookRef.*markdown/i);
  });
});
