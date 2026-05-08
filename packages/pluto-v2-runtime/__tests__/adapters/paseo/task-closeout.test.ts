import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { counterIdProvider, fixedClockProvider, type ActorRef, type RunEvent, type RunState } from '@pluto/v2-core';

import type { AgenticMutation } from '../../../src/adapters/paseo/agentic-mutation.js';
import { makePaseoAdapter } from '../../../src/adapters/paseo/paseo-adapter.js';
import { runPaseo, type PaseoAgentSpec, type PaseoCliClient, type PaseoUsageEstimate } from '../../../src/adapters/paseo/run-paseo.js';
import { planDelegatedTaskCloseout } from '../../../src/adapters/paseo/task-closeout.js';
import { loadAuthoredSpec, type LoadedAuthoredSpec } from '../../../src/loader/authored-spec-loader.js';

const FIXED_TIME = '2026-05-08T00:00:00.000Z';
const TOOL_SCENARIO_PATH = fileURLToPath(
  new URL('../../../test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml', import.meta.url),
);

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

type PromptRecord = {
  actorKey: string;
  prompt: string;
};

type ToolHttpResponse = {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
};

type ToolTurnContext = {
  readonly actor: ActorRef;
  readonly prompt: string;
  readonly spec: PaseoAgentSpec;
  callTool(toolName: string, args: unknown): Promise<ToolHttpResponse>;
};

type ToolScriptEntry = {
  readonly actor: ActorRef;
  readonly run: (context: ToolTurnContext) => Promise<{ transcriptText?: string; waitExitCode?: number }>;
  readonly usage?: Required<PaseoUsageEstimate>;
};

function actorKey(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `role:${actor.role}`;
  }

  const exhaustiveActor: never = actor;
  throw new Error(`unsupported actor ${String(exhaustiveActor)}`);
}

function buildSpec(overrides?: Partial<LoadedAuthoredSpec>): LoadedAuthoredSpec {
  const loaded = loadAuthoredSpec(TOOL_SCENARIO_PATH);
  const spec = {
    ...loaded,
    ...overrides,
    orchestration: {
      ...loaded.orchestration,
      ...overrides?.orchestration,
    },
  };

  Object.defineProperty(spec, 'playbook', {
    value: overrides?.playbook ?? loaded.playbook,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return spec as LoadedAuthoredSpec;
}

function taskIdFromPrompt(prompt: string): string {
  const match = prompt.match(/"id":\s*"([^"]+)"/);
  if (match?.[1] == null) {
    throw new Error('task id not found in prompt view');
  }

  return match[1];
}

function readInjectedApi(spec: PaseoAgentSpec): { url: string; token: string; actor: string } {
  const url = spec.env?.PLUTO_RUN_API_URL;
  const token = spec.env?.PLUTO_RUN_TOKEN;
  const actor = spec.env?.PLUTO_RUN_ACTOR;
  if (typeof url !== 'string' || typeof token !== 'string' || typeof actor !== 'string') {
    throw new Error('missing run API env handoff');
  }

  return { url, token, actor };
}

function makeMcpAwareMockClient(script: readonly ToolScriptEntry[], prompts: PromptRecord[]) {
  const grouped = new Map<string, ToolScriptEntry[]>();
  const cursors = new Map<string, number>();
  const cumulativeTranscript = new Map<string, string>();
  const promptByActor = new Map<string, string>();
  const specByActor = new Map<string, PaseoAgentSpec>();

  for (const entry of script) {
    const key = actorKey(entry.actor);
    const entries = grouped.get(key) ?? [];
    entries.push(entry);
    grouped.set(key, entries);
  }

  async function callTool(agentId: string, toolName: string, args: unknown): Promise<ToolHttpResponse> {
    const spec = specByActor.get(agentId);
    if (spec == null) {
      throw new Error(`missing spec for ${agentId}`);
    }

    const { url, token, actor } = readInjectedApi(spec);
    const route = (() => {
      switch (toolName) {
        case 'pluto_create_task':
          return { method: 'POST' as const, path: '/tools/create-task', body: args };
        case 'pluto_change_task_state':
          return { method: 'POST' as const, path: '/tools/change-task-state', body: args };
        case 'pluto_append_mailbox_message':
          return { method: 'POST' as const, path: '/tools/append-mailbox-message', body: args };
        case 'pluto_publish_artifact':
          return { method: 'POST' as const, path: '/tools/publish-artifact', body: args };
        case 'pluto_complete_run':
          return { method: 'POST' as const, path: '/tools/complete-run', body: args };
        case 'pluto_wait_for_event':
          return { method: 'POST' as const, path: '/tools/wait-for-event', body: args };
        default:
          throw new Error(`unsupported tool ${toolName}`);
      }
    })();

    const response = await fetch(`${url}${route.path}`, {
      method: route.method,
      headers: {
        authorization: `Bearer ${token}`,
        'Pluto-Run-Actor': actor,
        ...(route.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(route.method === 'POST' ? { body: JSON.stringify(route.body) } : {}),
    });
    const text = await response.text();

    return {
      status: response.status,
      body: text.length === 0
        ? null
        : (response.headers.get('content-type') ?? '').includes('application/json')
          ? JSON.parse(text)
          : text,
      text,
    };
  }

  const client: PaseoCliClient = {
    spawnAgent: vi.fn(async (spec) => {
      const agentId = `mock-${spec.title}`;
      prompts.push({ actorKey: spec.title, prompt: spec.initialPrompt });
      promptByActor.set(spec.title, spec.initialPrompt);
      specByActor.set(agentId, spec);
      cursors.set(spec.title, (cursors.get(spec.title) ?? -1) + 1);
      return { agentId };
    }),
    sendPrompt: vi.fn(async (agentId: string, prompt: string) => {
      const key = agentId.slice('mock-'.length);
      prompts.push({ actorKey: key, prompt });
      promptByActor.set(key, prompt);
      cursors.set(key, (cursors.get(key) ?? -1) + 1);
    }),
    waitIdle: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      const entry = grouped.get(key)?.[cursors.get(key) ?? -1];
      const spec = specByActor.get(agentId);
      if (entry == null || spec == null) {
        throw new Error(`missing script entry for ${agentId}`);
      }

      const outcome = await entry.run({
        actor: entry.actor,
        prompt: promptByActor.get(key) ?? '',
        spec,
        callTool: (toolName, toolArgs) => callTool(agentId, toolName, toolArgs),
      });
      cumulativeTranscript.set(
        key,
        (cumulativeTranscript.get(key) ?? '') + (outcome.transcriptText ?? ''),
      );
      return { exitCode: outcome.waitExitCode ?? 0 };
    }),
    readTranscript: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      return cumulativeTranscript.get(key) ?? '';
    }),
    usageEstimate: vi.fn(async (agentId: string) => {
      const key = agentId.slice('mock-'.length);
      const entry = grouped.get(key)?.[cursors.get(key) ?? -1];
      return entry?.usage ?? { inputTokens: 1, outputTokens: 1, costUsd: 0.001 };
    }),
    deleteAgent: vi.fn(async () => {}),
  };

  return client;
}

async function runAgenticTool(script: readonly ToolScriptEntry[], specOverrides?: Partial<LoadedAuthoredSpec>) {
  const prompts: PromptRecord[] = [];
  const workspaceCwd = await mkdtemp(join(tmpdir(), 'pluto-task-closeout-'));

  try {
    const result = await runPaseo(
      buildSpec(specOverrides),
      makePaseoAdapter({
        idProvider: counterIdProvider(100),
        clockProvider: fixedClockProvider(FIXED_TIME),
      }),
      {
        client: makeMcpAwareMockClient(script, prompts),
        idProvider: counterIdProvider(1),
        clockProvider: fixedClockProvider(FIXED_TIME),
        paseoAgentSpec: (actor) => ({
          provider: 'opencode',
          model: 'openai/gpt-5.4',
          mode: 'build',
          title: actorKey(actor),
          initialPrompt: `bootstrap for ${actorKey(actor)}`,
        }),
        workspaceCwd,
      },
    );

    return {
      prompts,
      result,
      cleanup: () => rm(workspaceCwd, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(workspaceCwd, { recursive: true, force: true });
    throw error;
  }
}

function mailboxDirective(kind: 'plan' | 'completion' | 'final'): AgenticMutation {
  return {
    kind: 'append_mailbox_message',
    payload: {
      fromActor: GENERATOR,
      toActor: LEAD,
      kind,
      body: `${kind} body`,
    },
  };
}

function mailboxEvent(kind: 'plan' | 'completion' | 'final'): RunEvent {
  return {
    eventId: 'event-1',
    runId: 'run-1',
    sequence: 1,
    timestamp: FIXED_TIME,
    schemaVersion: '1.0',
    actor: GENERATOR,
    requestId: 'request-1',
    causationId: null,
    correlationId: null,
    entityRef: { kind: 'mailbox_message', messageId: 'message-1' },
    outcome: 'accepted',
    kind: 'mailbox_message_appended',
    payload: {
      messageId: 'message-1',
      fromActor: GENERATOR,
      toActor: LEAD,
      kind,
      body: `${kind} body`,
    },
  };
}

function runStateWithTask(taskState: RunState['tasks'][string]['state']): RunState {
  return {
    runId: 'run-1',
    sequence: 1,
    status: 'running',
    tasks: {
      'task-1': {
        state: taskState,
        ownerActor: GENERATOR,
      },
    },
    acceptedRequestKeys: new Set<string>(),
    declaredActors: new Set(['manager', 'role:lead', 'role:generator']),
  };
}

function taskStates(tasks: Record<string, unknown>): string[] {
  return Object.values(tasks as Record<string, { state: string }>).map((task) => task.state);
}

describe('task close-out synthesis planning', () => {
  it('plans a completed close-out for delegated completion mailbox events', () => {
    expect(planDelegatedTaskCloseout({
      actor: GENERATOR,
      acceptedEvent: mailboxEvent('completion'),
      directive: mailboxDirective('completion'),
      leadActor: LEAD,
      delegationPointer: GENERATOR,
      delegationTaskId: 'task-1',
      runState: runStateWithTask('queued'),
    })).toEqual({ actor: GENERATOR, taskId: 'task-1' });
  });

  it('does not plan close-out for non-terminal mailbox kinds', () => {
    expect(planDelegatedTaskCloseout({
      actor: GENERATOR,
      acceptedEvent: mailboxEvent('plan'),
      directive: mailboxDirective('plan'),
      leadActor: LEAD,
      delegationPointer: GENERATOR,
      delegationTaskId: 'task-1',
      runState: runStateWithTask('queued'),
    })).toBeNull();
  });

  it('does not plan close-out without an open task-backed delegation', () => {
    expect(planDelegatedTaskCloseout({
      actor: GENERATOR,
      acceptedEvent: mailboxEvent('completion'),
      directive: mailboxDirective('completion'),
      leadActor: LEAD,
      delegationPointer: null,
      delegationTaskId: null,
      runState: runStateWithTask('queued'),
    })).toBeNull();
  });

  it('does not plan close-out when the bound task is already terminal', () => {
    expect(planDelegatedTaskCloseout({
      actor: GENERATOR,
      acceptedEvent: mailboxEvent('final'),
      directive: mailboxDirective('final'),
      leadActor: LEAD,
      delegationPointer: GENERATOR,
      delegationTaskId: 'task-1',
      runState: runStateWithTask('completed'),
    })).toBeNull();
  });
});

describe('task close-out synthesis in the Paseo driver', () => {
  it('synthesizes completed close-out before the next lead turn and preserves actor identity', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_create_task', {
            title: 'Implement',
            ownerActor: GENERATOR,
            dependsOn: [],
          });
          return { transcriptText: 'delegated\n' };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          await callTool('pluto_append_mailbox_message', {
            toActor: LEAD,
            kind: 'completion',
            body: 'Handled.',
          });
          return { transcriptText: 'reported\n' };
        },
      },
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'done',
          });
          return { transcriptText: 'closed\n' };
        },
      },
    ]);

    try {
      const taskCreated = execution.result.events[1];
      const synthesized = execution.result.events[3];

      expect(execution.result.events.map((event) => event.kind)).toEqual([
        'run_started',
        'task_created',
        'mailbox_message_appended',
        'task_state_changed',
        'run_completed',
      ]);
      expect(taskCreated?.kind).toBe('task_created');
      expect(synthesized).toMatchObject({
        actor: GENERATOR,
        kind: 'task_state_changed',
        payload: {
          taskId: taskCreated?.kind === 'task_created' ? taskCreated.payload.taskId : undefined,
          from: 'queued',
          to: 'completed',
        },
      });
      expect(execution.prompts[2]?.prompt).toContain('new event: task_state_changed from generator');
      expect(taskStates(execution.result.views.task.tasks)).toEqual(['completed']);
    } finally {
      await execution.cleanup();
    }
  });

  it('bypasses the consumed actor lease for the synthesized task close-out', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_create_task', {
            title: 'Implement',
            ownerActor: GENERATOR,
            dependsOn: [],
          });
          return { transcriptText: 'delegated\n' };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          const response = await callTool('pluto_append_mailbox_message', {
            toActor: LEAD,
            kind: 'completion',
            body: 'Handled.',
          });
          expect(response.status).toBe(200);
          return { transcriptText: 'reported\n' };
        },
      },
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'done',
          });
          return { transcriptText: 'closed\n' };
        },
      },
    ]);

    try {
      expect(execution.prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
      expect(
        execution.result.events
          .filter((event) => event.actor.kind === 'role' && event.actor.role === 'generator')
          .map((event) => event.kind),
      ).toEqual(['mailbox_message_appended', 'task_state_changed']);
      expect(execution.result.events.filter((event) => event.kind === 'request_rejected')).toEqual([]);
    } finally {
      await execution.cleanup();
    }
  });

  it('does not synthesize close-out for mailbox-only delegation without a bound task', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_append_mailbox_message', {
            toActor: GENERATOR,
            kind: 'task',
            body: 'Handle the change.',
          });
          return { transcriptText: 'delegated\n' };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          await callTool('pluto_append_mailbox_message', {
            toActor: LEAD,
            kind: 'completion',
            body: 'Handled.',
          });
          return { transcriptText: 'reported\n' };
        },
      },
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'done',
          });
          return { transcriptText: 'closed\n' };
        },
      },
    ]);

    try {
      expect(execution.result.events.map((event) => event.kind)).toEqual([
        'run_started',
        'mailbox_message_appended',
        'mailbox_message_appended',
        'run_completed',
      ]);
      expect(execution.result.events.some((event) => event.kind === 'task_state_changed')).toBe(false);
    } finally {
      await execution.cleanup();
    }
  });
});
