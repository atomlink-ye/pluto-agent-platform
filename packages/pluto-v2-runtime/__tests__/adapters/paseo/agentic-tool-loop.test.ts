import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { counterIdProvider, fixedClockProvider, type ActorRef, type RunEvent } from '@pluto/v2-core';

import { makePaseoAdapter } from '../../../src/adapters/paseo/paseo-adapter.js';
import { runPaseo, type PaseoCliClient, type PaseoAgentSpec, type PaseoUsageEstimate } from '../../../src/adapters/paseo/run-paseo.js';
import { loadAuthoredSpec, type LoadedAuthoredSpec } from '../../../src/loader/authored-spec-loader.js';
import type { BridgeSelfCheckResult } from '../../../src/adapters/paseo/bridge-self-check.js';

const FIXED_TIME = '2026-05-08T00:00:00.000Z';
const TOOL_SCENARIO_PATH = fileURLToPath(
  new URL('../../../test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml', import.meta.url),
);

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

type PromptRecord = {
  actorKey: string;
  prompt: string;
  cwd?: string;
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

type AgenticToolExecution = {
  readonly prompts: PromptRecord[];
  readonly result: Awaited<ReturnType<typeof runPaseo>>;
  readonly spawnSpecs: PaseoAgentSpec[];
  readonly workspaceCwd: string;
  readonly cleanup: () => Promise<void>;
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

function taskStates(tasks: Record<string, unknown>): string[] {
  return Object.values(tasks as Record<string, { state: string }>).map((task) => task.state);
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

function wakeupDeltaFromPrompt(prompt: string): Record<string, unknown> {
  const match = prompt.match(/\ndelta:\n([\s\S]*)\n\nend your turn with one mutating pluto-tool call\.$/);
  if (match?.[1] == null) {
    throw new Error('wakeup delta not found in prompt');
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
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
  const spawnSpecs: PaseoAgentSpec[] = [];

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
        case 'pluto_read_state':
          return { method: 'GET' as const, path: '/state' };
        case 'pluto_read_artifact':
          return { method: 'GET' as const, path: `/artifacts/${encodeURIComponent(String((args as { artifactId: string }).artifactId))}` };
        case 'pluto_read_transcript':
          return { method: 'GET' as const, path: `/transcripts/${encodeURIComponent(String((args as { actorKey: string }).actorKey))}` };
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
      prompts.push({ actorKey: spec.title, prompt: spec.initialPrompt, cwd: spec.cwd });
      promptByActor.set(spec.title, spec.initialPrompt);
      specByActor.set(agentId, spec);
      cursors.set(spec.title, (cursors.get(spec.title) ?? -1) + 1);
      spawnSpecs.push(spec);
      return { agentId };
    }),
    sendPrompt: vi.fn(async (agentId: string, prompt: string) => {
      const key = agentId.slice('mock-'.length);
      prompts.push({ actorKey: key, prompt, cwd: specByActor.get(agentId)?.cwd });
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

  return { client, spawnSpecs };
}

async function runAgenticTool(
  script: readonly ToolScriptEntry[],
  specOverrides?: Partial<LoadedAuthoredSpec>,
  options?: { bridgeSelfCheck?: () => Promise<BridgeSelfCheckResult> },
): Promise<AgenticToolExecution> {
  const prompts: PromptRecord[] = [];
  const spec = buildSpec(specOverrides);
  const mock = makeMcpAwareMockClient(script, prompts);
  const workspaceCwd = await mkdtemp(join(tmpdir(), 'pluto-agentic-tool-'));

  try {
    const result = await runPaseo(
      spec,
      makePaseoAdapter({
        idProvider: counterIdProvider(100),
        clockProvider: fixedClockProvider(FIXED_TIME),
      }),
      {
        client: mock.client,
        idProvider: counterIdProvider(1),
        clockProvider: fixedClockProvider(FIXED_TIME),
        paseoAgentSpec: (actor) => ({
          provider: 'opencode',
          model: 'openai/gpt-5.4',
          mode: 'build',
          title: actorKey(actor),
          initialPrompt: `bootstrap for ${actorKey(actor)}`,
        }),
        bridgeSelfCheck: options?.bridgeSelfCheck,
        workspaceCwd,
      },
    );

    return {
      prompts,
      result,
      spawnSpecs: mock.spawnSpecs,
      workspaceCwd,
      cleanup: () => rm(workspaceCwd, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(workspaceCwd, { recursive: true, force: true });
    throw error;
  }
}

describe('agentic_tool Paseo loop', () => {
  it('delegates from lead by task creation and uses env handoff in per-actor cwd dirs', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_create_task', {
            title: 'Draft the change',
            ownerActor: GENERATOR,
            dependsOn: [],
          });
          return { transcriptText: 'pluto-tool create-task --owner=generator --title="Draft the change"\n' };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          await callTool('pluto_append_mailbox_message', {
            toActor: LEAD,
            kind: 'completion',
            body: 'Draft is ready.',
          });
          return { transcriptText: 'pluto-tool send-mailbox --to=lead --kind=completion --body="Draft is ready."\n' };
        },
      },
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'done',
          });
          return { transcriptText: 'pluto-tool complete-run --status=succeeded --summary="done"\n' };
        },
      },
    ]);

    try {
      expect(execution.prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
      expect(execution.prompts[0]?.prompt).toContain('## How to call Pluto tools');
      expect(execution.prompts[0]?.prompt).toContain('pluto-tool create-task');
      expect(execution.prompts[0]?.prompt).not.toContain('curl');
      expect(execution.prompts[0]?.prompt).not.toContain('mcporter');
      expect(execution.result.events.map((event) => event.kind)).toEqual([
        'run_started',
        'task_created',
        'mailbox_message_appended',
        'task_state_changed',
        'run_completed',
      ]);
      expect(taskStates(execution.result.views.task.tasks)).toEqual(['completed']);
      expect(execution.spawnSpecs.map((spec) => spec.cwd)).toEqual([
        expect.stringContaining(`${execution.workspaceCwd}/.pluto/runs/run-hello-team-agentic-tool-mock/agents/role:lead`),
        expect.stringContaining(`${execution.workspaceCwd}/.pluto/runs/run-hello-team-agentic-tool-mock/agents/role:generator`),
      ]);
      for (const spec of execution.spawnSpecs) {
        expect(spec.cwd).toBeDefined();
        expect(spec.env).toMatchObject({
          PLUTO_RUN_API_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/v1$/),
          PLUTO_RUN_TOKEN: expect.any(String),
          PLUTO_RUN_ACTOR: expect.stringMatching(/^role:/),
        });
        expect(spec.env?.OPENCODE_CONFIG_CONTENT).toBeUndefined();
        expect(existsSync(spec.cwd ?? '')).toBe(true);
        expect(existsSync(join(spec.cwd ?? '', 'opencode.json'))).toBe(false);
      }
    } finally {
      await execution.cleanup();
    }
  });

  it('fails immediately when the first bridge self-check cannot execute the wrapper', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_create_task', {
            title: 'should never run',
            ownerActor: GENERATOR,
            dependsOn: [],
          });
          return { transcriptText: 'unexpected\n' };
        },
      },
    ], undefined, {
      bridgeSelfCheck: async () => ({
        ok: false,
        reason: 'wrapper_missing',
        stderr: 'spawnSync /tmp/pluto-tool ENOENT',
        latencyMs: 1,
      }),
    });

    try {
      expect(execution.prompts).toEqual([]);
      expect(execution.spawnSpecs).toEqual([]);
      expect(execution.result.events.map((event) => event.kind)).toEqual([
        'run_started',
        'run_completed',
      ]);
      expect(execution.result.events.at(-1)).toMatchObject({
        kind: 'run_completed',
        payload: {
          status: 'failed',
          summary: 'bridge_unavailable: wrapper_missing',
        },
      });
      expect(execution.result.runtimeTraces).toEqual([
        {
          kind: 'bridge_unavailable',
          actor: 'role:lead',
          attemptedAt: FIXED_TIME,
          reason: 'wrapper_missing',
          stderr: 'spawnSync /tmp/pluto-tool ENOENT',
          latencyMs: 1,
        },
      ]);
      expect(execution.result.views.task.tasks).toEqual({});
      expect(execution.result.usage.perTurn).toHaveLength(0);
    } finally {
      await execution.cleanup();
    }
  });

  it('returns to lead when a delegated task is completed by task-state transition', async () => {
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
        run: async ({ prompt, callTool }) => {
          await callTool('pluto_change_task_state', {
            taskId: taskIdFromPrompt(prompt),
            to: 'completed',
          });
          return { transcriptText: 'task done\n' };
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
      expect(execution.result.events.map((event) => event.kind)).toEqual([
        'run_started',
        'task_created',
        'task_state_changed',
        'run_completed',
      ]);
      expect(taskStates(execution.result.views.task.tasks)).toEqual(['completed']);
    } finally {
      await execution.cleanup();
    }
  });

  it('returns to lead when a delegated actor sends a completion mailbox message', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_append_mailbox_message', {
            toActor: GENERATOR,
            kind: 'task',
            body: 'Handle the change.',
          });
          return { transcriptText: 'delegated by mailbox\n' };
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
          return { transcriptText: 'reported back\n' };
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
      expect(execution.result.events.some((event) => event.kind === 'task_state_changed')).toBe(false);
    } finally {
      await execution.cleanup();
    }
  });

  it('lets a lead suspend in wait and resume with synthesized close-out in the wake payload', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_create_task', {
            title: 'Draft the change',
            ownerActor: GENERATOR,
            dependsOn: [],
          });
          const waited = await callTool('pluto_wait_for_event', { timeoutSec: 300 });
          expect(waited.status).toBe(200);
          expect(waited.body).toMatchObject({
            outcome: 'event',
            latestEvent: { kind: 'task_state_changed' },
            delta: {
              newMailbox: [
                {
                  kind: 'completion',
                  from: GENERATOR,
                  to: LEAD,
                  body: 'Handled.',
                },
              ],
              updatedTasks: [
                {
                  ownerActor: GENERATOR,
                  state: 'completed',
                },
              ],
            },
          });
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'done',
          });
          return {
            transcriptText: [
              'pluto-tool create-task --owner=generator --title="Draft the change"',
              'pluto-tool wait --timeout-sec=300',
              'pluto-tool complete-run --status=succeeded --summary="done"',
            ].join('\n'),
          };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          await callTool('pluto_append_mailbox_message', {
            toActor: LEAD,
            kind: 'completion',
            body: 'Draft ready.',
          });
          return { transcriptText: 'reported\n' };
        },
      },
    ]);

    try {
      expect(execution.prompts.map((entry) => entry.actorKey).slice(0, 2)).toEqual(['role:lead', 'role:generator']);
      expect(execution.result.events.map((event) => event.kind)).toEqual([
        'run_started',
        'task_created',
        'mailbox_message_appended',
        'task_state_changed',
        'run_completed',
      ]);
      expect(taskStates(execution.result.views.task.tasks)).toEqual(['completed']);
      expect(execution.result.runtimeTraces.map((trace) => trace.kind)).toEqual([
        'wait_armed',
        'wait_unblocked',
      ]);
    } finally {
      await execution.cleanup();
    }
  });

  it('completes the run when the lead emits pluto_complete_run', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'done',
          });
          return { transcriptText: 'lead closed\n' };
        },
      },
    ]);

    try {
      expect(execution.result.events.at(-1)?.kind).toBe('run_completed');
      expect(execution.result.events.at(-1)?.actor).toEqual({ kind: 'manager' });
      expect(execution.result.events.at(-1)?.payload).toMatchObject({ status: 'succeeded', summary: 'done' });
      expect(execution.result.evidencePacket.initiatingActor).toEqual(LEAD);
    } finally {
      await execution.cleanup();
    }
  });

  it('rejects a second mutating tool call within the same turn even if the first succeeded', async () => {
    let firstResponse: ToolHttpResponse | null = null;
    let secondResponse: ToolHttpResponse | null = null;

    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          firstResponse = await callTool('pluto_create_task', {
            title: 'Only task',
            ownerActor: LEAD,
            dependsOn: [],
          });
          secondResponse = await callTool('pluto_create_task', {
            title: 'Blocked task',
            ownerActor: LEAD,
            dependsOn: [],
          });
          return { transcriptText: 'attempted two writes\n' };
        },
      },
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'closed after single write',
          });
          return { transcriptText: 'closed\n' };
        },
      },
    ]);

    try {
      expect(firstResponse).not.toBeNull();
      expect(secondResponse).not.toBeNull();

      expect(firstResponse!.status).toBe(200);
      expect(firstResponse!.body).toMatchObject({
        accepted: true,
        taskId: expect.any(String),
      });

      expect(secondResponse!.status).toBe(409);
      expect(secondResponse!.body).toMatchObject({
        error: {
          code: 'PLUTO_TURN_CONSUMED',
        },
      });

      expect(execution.result.events.map((event) => event.kind)).toEqual(['run_started', 'task_created', 'run_completed']);
      expect(Object.keys(execution.result.views.task.tasks)).toHaveLength(1);
    } finally {
      await execution.cleanup();
    }
  });

  it('surfaces sub-actor complete_run rejection and returns control to lead', async () => {
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
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'worker should not close the run',
          });
          return { transcriptText: 'generator tried to close\n' };
        },
      },
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'lead closed the run',
          });
          return { transcriptText: 'lead closed\n' };
        },
      },
    ]);

    try {
      expect(execution.prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
      expect(execution.prompts[2]?.prompt).toContain('"lastRejection"');
      expect(execution.prompts[2]?.prompt).toContain('PLUTO_TOOL_LEAD_ONLY');
      expect(execution.result.events.map((event) => event.kind)).toEqual(['run_started', 'mailbox_message_appended', 'run_completed']);
      expect(execution.result.events.at(-1)?.payload).toMatchObject({ status: 'succeeded', summary: 'lead closed the run' });
    } finally {
      await execution.cleanup();
    }
  });

  it('fails after repeated idle turns with no mutating tool call', async () => {
    const execution = await runAgenticTool(
      [
        {
          actor: LEAD,
          run: async () => ({ transcriptText: 'thinking\n' }),
        },
        {
          actor: LEAD,
          run: async () => ({ transcriptText: 'still thinking\n' }),
        },
      ],
      {
        orchestration: {
          ...buildSpec().orchestration,
          mode: 'agentic_tool',
          maxNoProgressTurns: 1,
        },
      },
    );

    try {
      expect(execution.prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:lead']);
      expect(execution.result.events.at(-1)?.actor).toEqual({ kind: 'manager' });
      expect(execution.result.events.at(-1)?.payload).toMatchObject({ status: 'failed', summary: 'maxNoProgressTurns exhausted' });
      expect(execution.result.evidencePacket.initiatingActor).toEqual({ kind: 'manager' });
    } finally {
      await execution.cleanup();
    }
  });

  it('surfaces schema-invalid tool args and returns control to lead', async () => {
    const execution = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_create_task', {
            ownerActor: GENERATOR,
            dependsOn: [],
          });
          return { transcriptText: 'bad args\n' };
        },
      },
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_complete_run', {
            status: 'succeeded',
            summary: 'recovered',
          });
          return { transcriptText: 'recovered\n' };
        },
      },
    ]);

    try {
      expect(execution.prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:lead']);
      expect(execution.prompts[1]?.prompt).toContain('"lastRejection"');
      expect(execution.prompts[1]?.prompt).toContain('PLUTO_TOOL_BAD_ARGS');
      expect(execution.result.events.map((event) => event.kind)).toEqual(['run_started', 'run_completed']);
    } finally {
      await execution.cleanup();
    }
  });

  it('preserves the closed reducer event sequence on the mock fixture', async () => {
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
        run: async ({ prompt, callTool }) => {
          await callTool('pluto_change_task_state', {
            taskId: taskIdFromPrompt(prompt),
            to: 'running',
          });
          return { transcriptText: 'started\n' };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          await callTool('pluto_publish_artifact', {
            kind: 'final',
            mediaType: 'text/markdown',
            byteSize: 128,
            body: 'artifact body',
          });
          return { transcriptText: 'published\n' };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          await callTool('pluto_append_mailbox_message', {
            toActor: LEAD,
            kind: 'completion',
            body: 'artifact ready',
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
      expect(execution.result.events.map((event: RunEvent) => event.kind)).toEqual([
        'run_started',
        'task_created',
        'task_state_changed',
        'artifact_published',
        'mailbox_message_appended',
        'task_state_changed',
        'run_completed',
      ]);
      expect(taskStates(execution.result.views.task.tasks)).toEqual(['completed']);
    } finally {
      await execution.cleanup();
    }
  });

  it('thins repeat prompts to wakeup deltas and does not replay prior actor changes', async () => {
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
        run: async ({ prompt, callTool }) => {
          await callTool('pluto_change_task_state', {
            taskId: taskIdFromPrompt(prompt),
            to: 'running',
          });
          return { transcriptText: 'started\n' };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          await callTool('pluto_publish_artifact', {
            kind: 'intermediate',
            mediaType: 'text/markdown',
            byteSize: 128,
            body: 'artifact body',
          });
          return { transcriptText: 'published\n' };
        },
      },
      {
        actor: GENERATOR,
        run: async ({ callTool }) => {
          await callTool('pluto_append_mailbox_message', {
            toActor: LEAD,
            kind: 'completion',
            body: 'artifact ready',
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
      const generatorPrompts = execution.prompts
        .filter((entry) => entry.actorKey === 'role:generator')
        .map((entry) => entry.prompt);
      const leadWakeupPrompt = execution.prompts.at(-1)?.prompt ?? '';
      const generatorBootstrap = generatorPrompts[0] ?? '';
      const generatorWakeupOne = generatorPrompts[1] ?? '';
      const generatorWakeupTwo = generatorPrompts[2] ?? '';
      const firstWakeupDelta = wakeupDeltaFromPrompt(generatorWakeupOne);
      const secondWakeupDelta = wakeupDeltaFromPrompt(generatorWakeupTwo);
      const firstUpdatedTasks = firstWakeupDelta.updatedTasks as unknown[];
      const secondUpdatedTasks = secondWakeupDelta.updatedTasks as unknown[];
      const secondNewArtifacts = secondWakeupDelta.newArtifacts as unknown[];

      expect(generatorPrompts).toHaveLength(3);
      expect(generatorBootstrap).toContain('Available Pluto tools:');
      expect(generatorWakeupOne).toContain('[wakeup turn');
      expect(generatorWakeupTwo).toContain('[wakeup turn');
      expect(generatorWakeupOne.length).toBeLessThan(generatorBootstrap.length * 0.3);
      expect(generatorWakeupTwo.length).toBeLessThan(generatorBootstrap.length * 0.3);
      for (const prompt of [generatorWakeupOne, generatorWakeupTwo, leadWakeupPrompt]) {
        expect(prompt).not.toContain('Available Pluto tools');
        expect(prompt).not.toContain('## How to call Pluto tools');
        expect(prompt).not.toContain('Never delegate understanding');
      }
      expect(Array.isArray(firstUpdatedTasks)).toBe(true);
      expect(firstUpdatedTasks[0]).toEqual([
        expect.any(String),
        'running',
        'role:generator',
        expect.any(String),
      ]);
      expect(secondUpdatedTasks).toEqual([]);
      expect(secondNewArtifacts[0]).toEqual([
        expect.any(String),
        'intermediate',
        'text/markdown',
        128,
      ]);
    } finally {
      await execution.cleanup();
    }
  });
});
