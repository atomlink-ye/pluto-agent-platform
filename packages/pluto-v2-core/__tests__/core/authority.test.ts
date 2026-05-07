import { describe, expect, it } from 'vitest';

import { ProtocolRequestSchema } from '../../src/protocol-request.js';
import {
  AUTHORITY_MATRIX,
  TeamContextSchema,
  actorAuthorizedForIntent,
  composeRequestKey,
  initialState,
  validate,
} from '../../src/core/index.js';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

const teamContext = TeamContextSchema.parse({
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
    { taskId: 'generator-task', title: 'Generator task', ownerActor: { kind: 'role', role: 'generator' }, dependsOn: [] },
    { taskId: 'evaluator-task', title: 'Evaluator task', ownerActor: { kind: 'role', role: 'evaluator' }, dependsOn: [] },
    { taskId: 'unowned-task', title: 'Unowned task', ownerActor: null, dependsOn: [] },
  ],
  policy: AUTHORITY_MATRIX,
});

const state = initialState(teamContext);

const baseRequest = {
  runId: 'run-1',
  idempotencyKey: null,
  clientTimestamp: '2026-05-07T00:00:00.000Z',
  schemaVersion: '1.0',
} as const;

const allowedCases = [
  {
    name: 'append_mailbox_message manager',
    requestId: '1',
    actor: { kind: 'manager' } as const,
    intent: 'append_mailbox_message' as const,
    payload: { fromActor: { kind: 'manager' } as const, toActor: { kind: 'broadcast' } as const, kind: 'plan' as const, body: 'Plan.' },
  },
  {
    name: 'append_mailbox_message lead',
    requestId: '2',
    actor: { kind: 'role', role: 'lead' } as const,
    intent: 'append_mailbox_message' as const,
    payload: { fromActor: { kind: 'role', role: 'lead' } as const, toActor: { kind: 'broadcast' } as const, kind: 'plan' as const, body: 'Plan.' },
  },
  {
    name: 'append_mailbox_message planner',
    requestId: '3',
    actor: { kind: 'role', role: 'planner' } as const,
    intent: 'append_mailbox_message' as const,
    payload: { fromActor: { kind: 'role', role: 'planner' } as const, toActor: { kind: 'broadcast' } as const, kind: 'task' as const, body: 'Task.' },
  },
  {
    name: 'append_mailbox_message generator',
    requestId: '4',
    actor: { kind: 'role', role: 'generator' } as const,
    intent: 'append_mailbox_message' as const,
    payload: { fromActor: { kind: 'role', role: 'generator' } as const, toActor: { kind: 'broadcast' } as const, kind: 'completion' as const, body: 'Done.' },
  },
  {
    name: 'append_mailbox_message evaluator',
    requestId: '5',
    actor: { kind: 'role', role: 'evaluator' } as const,
    intent: 'append_mailbox_message' as const,
    payload: { fromActor: { kind: 'role', role: 'evaluator' } as const, toActor: { kind: 'broadcast' } as const, kind: 'final' as const, body: 'Final.' },
  },
  {
    name: 'append_mailbox_message system',
    requestId: '6',
    actor: { kind: 'system' } as const,
    intent: 'append_mailbox_message' as const,
    payload: { fromActor: { kind: 'system' } as const, toActor: { kind: 'broadcast' } as const, kind: 'plan' as const, body: 'System plan.' },
  },
  {
    name: 'create_task manager',
    requestId: '7',
    actor: { kind: 'manager' } as const,
    intent: 'create_task' as const,
    payload: { title: 'Create task', ownerActor: null, dependsOn: [] },
  },
  {
    name: 'create_task lead',
    requestId: '8',
    actor: { kind: 'role', role: 'lead' } as const,
    intent: 'create_task' as const,
    payload: { title: 'Create task', ownerActor: null, dependsOn: [] },
  },
  {
    name: 'create_task planner',
    requestId: '9',
    actor: { kind: 'role', role: 'planner' } as const,
    intent: 'create_task' as const,
    payload: { title: 'Create task', ownerActor: null, dependsOn: [] },
  },
  {
    name: 'change_task_state manager',
    requestId: '10',
    actor: { kind: 'manager' } as const,
    intent: 'change_task_state' as const,
    payload: { taskId: 'generator-task', to: 'running' as const },
  },
  {
    name: 'change_task_state lead',
    requestId: '11',
    actor: { kind: 'role', role: 'lead' } as const,
    intent: 'change_task_state' as const,
    payload: { taskId: 'generator-task', to: 'running' as const },
  },
  {
    name: 'change_task_state generator owner match',
    requestId: '12',
    actor: { kind: 'role', role: 'generator' } as const,
    intent: 'change_task_state' as const,
    payload: { taskId: 'generator-task', to: 'running' as const },
  },
  {
    name: 'change_task_state evaluator owner match',
    requestId: '13',
    actor: { kind: 'role', role: 'evaluator' } as const,
    intent: 'change_task_state' as const,
    payload: { taskId: 'evaluator-task', to: 'running' as const },
  },
  {
    name: 'change_task_state planner blocked',
    requestId: '14',
    actor: { kind: 'role', role: 'planner' } as const,
    intent: 'change_task_state' as const,
    payload: { taskId: 'generator-task', to: 'blocked' as const },
  },
  {
    name: 'change_task_state planner cancelled',
    requestId: '15',
    actor: { kind: 'role', role: 'planner' } as const,
    intent: 'change_task_state' as const,
    payload: { taskId: 'generator-task', to: 'cancelled' as const },
  },
  {
    name: 'publish_artifact generator',
    requestId: '16',
    actor: { kind: 'role', role: 'generator' } as const,
    intent: 'publish_artifact' as const,
    payload: { kind: 'final' as const, mediaType: 'text/markdown', byteSize: 10 },
  },
  {
    name: 'publish_artifact lead',
    requestId: '17',
    actor: { kind: 'role', role: 'lead' } as const,
    intent: 'publish_artifact' as const,
    payload: { kind: 'final' as const, mediaType: 'text/markdown', byteSize: 10 },
  },
  {
    name: 'publish_artifact manager',
    requestId: '18',
    actor: { kind: 'manager' } as const,
    intent: 'publish_artifact' as const,
    payload: { kind: 'intermediate' as const, mediaType: 'text/plain', byteSize: 10 },
  },
  {
    name: 'complete_run manager',
    requestId: '19',
    actor: { kind: 'manager' } as const,
    intent: 'complete_run' as const,
    payload: { status: 'succeeded' as const, summary: 'Done.' },
  },
] as const;

const disallowedCases = [
  { name: 'create_task generator', requestId: '101', actor: { kind: 'role', role: 'generator' } as const, intent: 'create_task' as const, payload: { title: 'Nope', ownerActor: null, dependsOn: [] } },
  { name: 'create_task evaluator', requestId: '102', actor: { kind: 'role', role: 'evaluator' } as const, intent: 'create_task' as const, payload: { title: 'Nope', ownerActor: null, dependsOn: [] } },
  { name: 'create_task system', requestId: '103', actor: { kind: 'system' } as const, intent: 'create_task' as const, payload: { title: 'Nope', ownerActor: null, dependsOn: [] } },
  { name: 'change_task_state planner running', requestId: '104', actor: { kind: 'role', role: 'planner' } as const, intent: 'change_task_state' as const, payload: { taskId: 'generator-task', to: 'running' as const } },
  { name: 'change_task_state generator wrong owner', requestId: '105', actor: { kind: 'role', role: 'generator' } as const, intent: 'change_task_state' as const, payload: { taskId: 'evaluator-task', to: 'running' as const } },
  { name: 'change_task_state evaluator wrong owner', requestId: '106', actor: { kind: 'role', role: 'evaluator' } as const, intent: 'change_task_state' as const, payload: { taskId: 'generator-task', to: 'running' as const } },
  { name: 'change_task_state generator null owner', requestId: '107', actor: { kind: 'role', role: 'generator' } as const, intent: 'change_task_state' as const, payload: { taskId: 'unowned-task', to: 'running' as const } },
  { name: 'change_task_state evaluator null owner', requestId: '108', actor: { kind: 'role', role: 'evaluator' } as const, intent: 'change_task_state' as const, payload: { taskId: 'unowned-task', to: 'running' as const } },
  { name: 'publish_artifact planner', requestId: '109', actor: { kind: 'role', role: 'planner' } as const, intent: 'publish_artifact' as const, payload: { kind: 'final' as const, mediaType: 'text/markdown', byteSize: 10 } },
  { name: 'publish_artifact evaluator', requestId: '110', actor: { kind: 'role', role: 'evaluator' } as const, intent: 'publish_artifact' as const, payload: { kind: 'final' as const, mediaType: 'text/markdown', byteSize: 10 } },
  { name: 'publish_artifact system', requestId: '111', actor: { kind: 'system' } as const, intent: 'publish_artifact' as const, payload: { kind: 'final' as const, mediaType: 'text/markdown', byteSize: 10 } },
  { name: 'complete_run lead', requestId: '112', actor: { kind: 'role', role: 'lead' } as const, intent: 'complete_run' as const, payload: { status: 'succeeded' as const, summary: 'Done.' } },
  { name: 'complete_run planner', requestId: '113', actor: { kind: 'role', role: 'planner' } as const, intent: 'complete_run' as const, payload: { status: 'succeeded' as const, summary: 'Done.' } },
  { name: 'complete_run generator', requestId: '114', actor: { kind: 'role', role: 'generator' } as const, intent: 'complete_run' as const, payload: { status: 'succeeded' as const, summary: 'Done.' } },
  { name: 'complete_run evaluator', requestId: '115', actor: { kind: 'role', role: 'evaluator' } as const, intent: 'complete_run' as const, payload: { status: 'succeeded' as const, summary: 'Done.' } },
  { name: 'complete_run system', requestId: '116', actor: { kind: 'system' } as const, intent: 'complete_run' as const, payload: { status: 'succeeded' as const, summary: 'Done.' } },
] as const;

function requestFor(caseDef: (typeof allowedCases)[number] | (typeof disallowedCases)[number]) {
  return ProtocolRequestSchema.parse({
    ...baseRequest,
    requestId: uuid(caseDef.requestId),
    actor: caseDef.actor,
    intent: caseDef.intent,
    payload: caseDef.payload,
  });
}

describe('AUTHORITY_MATRIX', () => {
  it('matches the frozen v2 authority matrix verbatim', () => {
    expect(AUTHORITY_MATRIX).toEqual({
      append_mailbox_message: [
        { kind: 'manager' },
        { kind: 'role', role: 'lead' },
        { kind: 'role', role: 'planner' },
        { kind: 'role', role: 'generator' },
        { kind: 'role', role: 'evaluator' },
        { kind: 'system' },
      ],
      create_task: [{ kind: 'manager' }, { kind: 'role', role: 'lead' }, { kind: 'role', role: 'planner' }],
      change_task_state: [
        { kind: 'manager' },
        { kind: 'role', role: 'lead' },
        { kind: 'role-owns-task', role: 'generator' },
        { kind: 'role-owns-task', role: 'evaluator' },
        { kind: 'role-bounded-transitions', role: 'planner', transitions: ['blocked', 'cancelled'] },
      ],
      publish_artifact: [{ kind: 'role', role: 'generator' }, { kind: 'role', role: 'lead' }, { kind: 'manager' }],
      complete_run: [{ kind: 'manager' }],
    });
  });

  it('returns null request keys when idempotencyKey is null', () => {
    expect(composeRequestKey('run-1', { kind: 'manager' }, 'complete_run', null)).toBeNull();
  });

  it('serializes request keys canonically for manager, role, and system actors', () => {
    expect(composeRequestKey('run-1', { kind: 'manager' }, 'complete_run', 'a')).toBe('run-1|manager|complete_run|a');
    expect(composeRequestKey('run-1', { kind: 'role', role: 'generator' }, 'publish_artifact', 'b')).toBe(
      'run-1|role:generator|publish_artifact|b',
    );
    expect(composeRequestKey('run-1', { kind: 'system' }, 'append_mailbox_message', 'c')).toBe(
      'run-1|system|append_mailbox_message|c',
    );
  });

  it.each(allowedCases)('accepts matrix member $name', (caseDef) => {
    const request = requestFor(caseDef);

    expect(actorAuthorizedForIntent(state, request)).toBe(true);
    expect(validate(state, request)).toEqual({ ok: true });
  });

  it.each(disallowedCases)('rejects non-member $name with actor_not_authorized', (caseDef) => {
    const request = requestFor(caseDef);

    expect(actorAuthorizedForIntent(state, request)).toBe(false);
    expect(validate(state, request)).toEqual({
      ok: false,
      reason: 'actor_not_authorized',
      detail: `Actor is not authorized for ${caseDef.intent}.`,
    });
  });
});
