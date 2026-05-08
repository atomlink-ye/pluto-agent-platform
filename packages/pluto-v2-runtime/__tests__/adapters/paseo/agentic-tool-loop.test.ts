import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { counterIdProvider, fixedClockProvider, type ActorRef, type RunEvent } from '@pluto/v2-core';

import { makePaseoAdapter } from '../../../src/adapters/paseo/paseo-adapter.js';
import { runPaseo, type PaseoCliClient, type PaseoAgentSpec, type PaseoUsageEstimate } from '../../../src/adapters/paseo/run-paseo.js';
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
  cwd?: string;
};

type ToolRpcResponse = {
  readonly status: number;
  readonly json: {
    readonly result?: unknown;
    readonly error?: {
      readonly code: number;
      readonly message: string;
      readonly data?: unknown;
    };
  };
};

type ToolTurnContext = {
  readonly actor: ActorRef;
  readonly prompt: string;
  readonly spec: PaseoAgentSpec;
  callTool(toolName: string, args: unknown): Promise<ToolRpcResponse>;
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

function readInjectedConfig(spec: PaseoAgentSpec): { url: string; token: string } {
  const configText = spec.cwd != null && existsSync(join(spec.cwd, 'opencode.json'))
    ? readFileSync(join(spec.cwd, 'opencode.json'), 'utf8')
    : spec.env?.OPENCODE_CONFIG_CONTENT;
  if (configText == null) {
    throw new Error('missing MCP config injection');
  }

  const parsed = JSON.parse(configText) as {
    mcp?: {
      pluto?: {
        url?: string;
        headers?: { Authorization?: string };
      };
    };
  };
  const url = parsed.mcp?.pluto?.url;
  const authorization = parsed.mcp?.pluto?.headers?.Authorization;
  if (typeof url !== 'string' || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    throw new Error('invalid MCP config payload');
  }

  return {
    url,
    token: authorization.slice('Bearer '.length),
  };
}

function toolResultJson(result: unknown) {
  const toolResult = result as { content: Array<{ type: string; text: string }> };
  const firstChunk = toolResult.content[0];
  expect(firstChunk?.type).toBe('text');
  return JSON.parse(firstChunk?.text ?? 'null');
}

function makeMcpAwareMockClient(script: readonly ToolScriptEntry[], prompts: PromptRecord[]) {
  const grouped = new Map<string, ToolScriptEntry[]>();
  const cursors = new Map<string, number>();
  const cumulativeTranscript = new Map<string, string>();
  const promptByActor = new Map<string, string>();
  const specByActor = new Map<string, PaseoAgentSpec>();
  const initializedAgents = new Set<string>();
  const spawnSpecs: PaseoAgentSpec[] = [];

  for (const entry of script) {
    const key = actorKey(entry.actor);
    const entries = grouped.get(key) ?? [];
    entries.push(entry);
    grouped.set(key, entries);
  }

  async function postJson(spec: PaseoAgentSpec, actor: ActorRef, body: unknown): Promise<ToolRpcResponse> {
    const { url, token } = readInjectedConfig(spec);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-11-25',
        'Pluto-Run-Actor': JSON.stringify(actor),
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      json: text.length === 0 ? {} : JSON.parse(text) as ToolRpcResponse['json'],
    };
  }

  async function callTool(agentId: string, actor: ActorRef, toolName: string, args: unknown): Promise<ToolRpcResponse> {
    const spec = specByActor.get(agentId);
    if (spec == null) {
      throw new Error(`missing spec for ${agentId}`);
    }

    if (!initializedAgents.has(agentId)) {
      await postJson(spec, actor, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {} },
      });
      await postJson(spec, actor, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
      await postJson(spec, actor, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      initializedAgents.add(agentId);
    }

    return postJson(spec, actor, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    });
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
        callTool: (toolName, args) => callTool(agentId, entry.actor, toolName, args),
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

async function runAgenticTool(script: readonly ToolScriptEntry[], specOverrides?: Partial<LoadedAuthoredSpec>) {
  const prompts: PromptRecord[] = [];
  const spec = buildSpec(specOverrides);
  const mock = makeMcpAwareMockClient(script, prompts);
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
    },
  );

  return { prompts, result, spawnSpecs: mock.spawnSpecs };
}

describe('agentic_tool Paseo loop', () => {
  it('delegates from lead by task creation and cleans up per-actor cwd injection', async () => {
    const { prompts, result, spawnSpecs } = await runAgenticTool([
      {
        actor: LEAD,
        run: async ({ callTool }) => {
          await callTool('pluto_create_task', {
            title: 'Draft the change',
            ownerActor: GENERATOR,
            dependsOn: [],
          });
          return { transcriptText: 'lead delegated\n' };
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
          return { transcriptText: 'generator completed\n' };
        },
      },
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

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
    expect(result.events.map((event) => event.kind)).toEqual([
      'run_started',
      'task_created',
      'mailbox_message_appended',
      'run_completed',
    ]);
    expect(spawnSpecs.map((spec) => spec.cwd)).toEqual([
      expect.stringContaining('.pluto/runs/run-hello-team-agentic-tool-mock/agents/role:lead'),
      expect.stringContaining('.pluto/runs/run-hello-team-agentic-tool-mock/agents/role:generator'),
    ]);
    for (const spec of spawnSpecs) {
      expect(spec.cwd).toBeDefined();
      expect(existsSync(spec.cwd ?? '')).toBe(false);
    }
  });

  it('returns to lead when a delegated task is completed by task-state transition', async () => {
    const { prompts } = await runAgenticTool([
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

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
  });

  it('returns to lead when a delegated actor sends a completion mailbox message', async () => {
    const { prompts } = await runAgenticTool([
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

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
  });

  it('completes the run when the lead emits pluto_complete_run', async () => {
    const { result } = await runAgenticTool([
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

    expect(result.events.at(-1)?.kind).toBe('run_completed');
    expect(result.events.at(-1)?.payload).toMatchObject({ status: 'succeeded', summary: 'done' });
  });

  it('rejects a second mutating tool call within the same turn even if the first succeeded', async () => {
    let firstResponse: ToolRpcResponse | null = null;
    let secondResponse: ToolRpcResponse | null = null;

    const { result } = await runAgenticTool([
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

    expect(firstResponse).not.toBeNull();
    expect(secondResponse).not.toBeNull();

    expect(firstResponse!.status).toBe(200);
    expect(firstResponse!.json.error).toBeUndefined();
    expect(toolResultJson(firstResponse!.json.result)).toMatchObject({
      accepted: true,
      taskId: expect.any(String),
    });

    expect(secondResponse!.status).toBe(200);
    expect(secondResponse!.json.error).toMatchObject({
      code: -32004,
      message: expect.stringContaining('PLUTO_TURN_CONSUMED'),
    });

    expect(result.events.map((event) => event.kind)).toEqual(['run_started', 'task_created', 'run_completed']);
    expect(Object.keys(result.views.task.tasks)).toHaveLength(1);
  });

  it('surfaces sub-actor complete_run rejection and returns control to lead', async () => {
    const { prompts, result } = await runAgenticTool([
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

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:generator', 'role:lead']);
    expect(prompts[2]?.prompt).toContain('"lastRejection"');
    expect(prompts[2]?.prompt).toContain('PLUTO_TOOL_LEAD_ONLY');
    expect(result.events.map((event) => event.kind)).toEqual(['run_started', 'mailbox_message_appended', 'run_completed']);
    expect(result.events.at(-1)?.payload).toMatchObject({ status: 'succeeded', summary: 'lead closed the run' });
  });

  it('fails after repeated idle turns with no mutating tool call', async () => {
    const { prompts, result } = await runAgenticTool(
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

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:lead']);
    expect(result.events.at(-1)?.payload).toMatchObject({ status: 'failed', summary: 'maxNoProgressTurns exhausted' });
  });

  it('surfaces schema-invalid tool args and returns control to lead', async () => {
    const { prompts, result } = await runAgenticTool([
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

    expect(prompts.map((entry) => entry.actorKey)).toEqual(['role:lead', 'role:lead']);
    expect(prompts[1]?.prompt).toContain('"lastRejection"');
    expect(prompts[1]?.prompt).toContain('PLUTO_TOOL_BAD_ARGS');
    expect(result.events.map((event) => event.kind)).toEqual(['run_started', 'run_completed']);
  });

  it('preserves the closed reducer event sequence on the mock fixture', async () => {
    const { result } = await runAgenticTool([
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

    expect(result.events.map((event: RunEvent) => event.kind)).toEqual([
      'run_started',
      'task_created',
      'task_state_changed',
      'artifact_published',
      'mailbox_message_appended',
      'run_completed',
    ]);
  });
});
