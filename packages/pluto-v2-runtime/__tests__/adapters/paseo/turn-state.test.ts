import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { counterIdProvider, fixedClockProvider, type ActorRef } from '@pluto/v2-core';

import { makePaseoAdapter } from '../../../src/adapters/paseo/paseo-adapter.js';
import {
  runPaseo,
  type PaseoAgentSpec,
  type PaseoCliClient,
  type PaseoUsageEstimate,
  type RuntimeTraceEvent,
  type TurnStateTransitionTraceEvent,
  type WaitRegistryControl,
} from '../../../src/adapters/paseo/run-paseo.js';
import { loadAuthoredSpec, type LoadedAuthoredSpec } from '../../../src/loader/authored-spec-loader.js';

const FIXED_TIME = '2026-05-08T00:00:00.000Z';
const TOOL_SCENARIO_PATH = fileURLToPath(
  new URL('../../../test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml', import.meta.url),
);

const LEAD: ActorRef = { kind: 'role', role: 'lead' };
const GENERATOR: ActorRef = { kind: 'role', role: 'generator' };

type ToolHttpResponse = {
  readonly status: number;
  readonly body: unknown;
};

type ToolTurnContext = {
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
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 1000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]);
}

function createDisconnectHarness(args: {
  actor: ActorRef;
  disconnects: number;
  resolveOn: 'rearms' | 'exhausted';
}) {
  const targetActor = actorKey(args.actor);
  let control: WaitRegistryControl | null = null;
  let scheduledDisconnects = 0;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const scheduleCancel = () => {
    void Promise.resolve().then(() => {
      if (control?.hasArmedWait(args.actor)) {
        control.cancelWaitForActor(args.actor, 'client_idle_disconnect');
      }
    });
  };

  return {
    onWaitRegistryReady(nextControl: WaitRegistryControl) {
      control = nextControl;
    },
    onRuntimeTrace(trace: RuntimeTraceEvent) {
      if (trace.kind === 'wait_armed' && trace.actor === targetActor && scheduledDisconnects < args.disconnects) {
        scheduledDisconnects += 1;
        scheduleCancel();
        return;
      }

      if (trace.actor !== targetActor) {
        return;
      }

      if (args.resolveOn === 'rearms' && trace.kind === 'wait_silent_rearm' && trace.attempt === args.disconnects) {
        resolveReady();
      }

      if (args.resolveOn === 'exhausted' && trace.kind === 'wait_rearm_exhausted' && trace.attempts === args.disconnects) {
        resolveReady();
      }
    },
    ready,
  };
}

function buildSpec(): LoadedAuthoredSpec {
  const loaded = loadAuthoredSpec(TOOL_SCENARIO_PATH);
  const spec = {
    ...loaded,
    orchestration: {
      ...loaded.orchestration,
    },
  };

  Object.defineProperty(spec, 'playbook', {
    value: loaded.playbook,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return spec as LoadedAuthoredSpec;
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

function apiUrlForPath(apiUrl: string, path: string): string {
  return path.startsWith('/v2/')
    ? `${apiUrl.replace(/\/v1$/, '')}${path}`
    : `${apiUrl}${path}`;
}

function failedAuditFinalReconciliationArgs(summary: string) {
  return {
    completedTasks: ['missing-task'],
    citedMessages: ['999'],
    summary,
  };
}

function isAutoWaitableMutation(toolName: string, body: unknown): body is { turnDisposition: 'waiting' } {
  return toolName !== 'pluto_complete_run'
    && body != null
    && typeof body === 'object'
    && (body as { turnDisposition?: unknown }).turnDisposition === 'waiting';
}

function makeAutoWaitClient(script: readonly ToolScriptEntry[], options?: { autoWaitMutations?: boolean }): PaseoCliClient {
  const grouped = new Map<string, ToolScriptEntry[]>();
  const cursors = new Map<string, number>();
  const promptByActor = new Map<string, string>();
  const specByActor = new Map<string, PaseoAgentSpec>();
  const transcripts = new Map<string, string>();

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
        case 'pluto_append_mailbox_message':
          return { method: 'POST' as const, path: '/tools/append-mailbox-message', body: args };
        case 'pluto_wait_for_event':
          return { method: 'POST' as const, path: '/tools/wait-for-event', body: args };
        case 'pluto_complete_run':
          return { method: 'POST' as const, path: '/tools/complete-run', body: args };
        case 'pluto_final_reconciliation':
          return { method: 'POST' as const, path: '/v2/composite/final-reconciliation', body: args };
        default:
          throw new Error(`unsupported tool ${toolName}`);
      }
    })();

    const response = await fetch(apiUrlForPath(url, route.path), {
      method: route.method,
      headers: {
        authorization: `Bearer ${token}`,
        'Pluto-Run-Actor': actor,
        'content-type': 'application/json',
      },
      body: JSON.stringify(route.body),
    });
    const text = await response.text();
    const body = text.length === 0 ? null : JSON.parse(text);

    if (options?.autoWaitMutations !== false && response.status === 200 && isAutoWaitableMutation(toolName, body)) {
      const waitResponse = await fetch(`${url}/tools/wait-for-event`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'Pluto-Run-Actor': actor,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ timeoutSec: 300 }),
      });
      const waitText = await waitResponse.text();
      return {
        status: waitResponse.status,
        body: {
          mutation: body,
          wait: waitText.length === 0 ? null : JSON.parse(waitText),
        },
      };
    }

    return {
      status: response.status,
      body,
    };
  }

  return {
    async spawnAgent(spec) {
      const agentId = `mock-${spec.title}`;
      promptByActor.set(spec.title, spec.initialPrompt);
      specByActor.set(agentId, spec);
      cursors.set(spec.title, (cursors.get(spec.title) ?? -1) + 1);
      return { agentId };
    },
    async sendPrompt(agentId, prompt) {
      const key = agentId.slice('mock-'.length);
      promptByActor.set(key, prompt);
      cursors.set(key, (cursors.get(key) ?? -1) + 1);
    },
    async waitIdle(agentId) {
      const key = agentId.slice('mock-'.length);
      const entry = grouped.get(key)?.[cursors.get(key) ?? -1];
      const spec = specByActor.get(agentId);
      if (entry == null || spec == null) {
        throw new Error(`missing script entry for ${agentId}`);
      }

      const outcome = await entry.run({
        spec,
        callTool: (toolName, toolArgs) => callTool(agentId, toolName, toolArgs),
      });
      transcripts.set(key, (transcripts.get(key) ?? '') + (outcome.transcriptText ?? ''));
      return { exitCode: outcome.waitExitCode ?? 0 };
    },
    async readTranscript(agentId) {
      return transcripts.get(agentId.slice('mock-'.length)) ?? '';
    },
    async usageEstimate(agentId) {
      const key = agentId.slice('mock-'.length);
      const entry = grouped.get(key)?.[cursors.get(key) ?? -1];
      return entry?.usage ?? { inputTokens: 1, outputTokens: 1, costUsd: 0.001 };
    },
    async deleteAgent() {},
  };
}

describe('agentic_tool turn-state tracing', () => {
  it('traces active, waiting, wakeup, and terminal lifecycle transitions', async () => {
    const workspaceCwd = await mkdtemp(join(tmpdir(), 'pluto-turn-state-'));

    try {
      const result = await runPaseo(
        buildSpec(),
        makePaseoAdapter({
          idProvider: counterIdProvider(100),
          clockProvider: fixedClockProvider(FIXED_TIME),
        }),
        {
          client: makeAutoWaitClient([
            {
              actor: LEAD,
              run: async ({ callTool }) => {
                const delegated = await callTool('pluto_create_task', {
                  title: 'Draft the change',
                  ownerActor: GENERATOR,
                  dependsOn: [],
                });
                expect(delegated.body).toMatchObject({
                  mutation: { turnDisposition: 'waiting' },
                  wait: { outcome: 'event' },
                });
                await callTool('pluto_final_reconciliation', failedAuditFinalReconciliationArgs('done'));
                return { transcriptText: 'lead complete\n' };
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
                return { transcriptText: 'generator complete\n' };
              },
            },
          ]),
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

      const turnTransitions = result.runtimeTraces.filter(
        (trace): trace is TurnStateTransitionTraceEvent => trace.kind === 'turn_state_transition',
      );
      const runCompletedTerminalActors = turnTransitions
        .filter((trace) => trace.reason === 'run_completed' && trace.toState === 'terminal')
        .map((trace) => trace.actor)
        .sort();

      expect(turnTransitions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor: 'role:lead',
          fromState: null,
          toState: 'active',
          reason: 'session_started',
        }),
        expect.objectContaining({
          actor: 'role:lead',
          fromState: 'active',
          toState: 'waiting',
          reason: 'mutation_accepted',
        }),
        expect.objectContaining({
          actor: 'role:lead',
          toState: 'terminal',
        }),
        expect.objectContaining({
          fromState: 'waiting',
          toState: 'active',
          reason: 'wait_delivered',
        }),
      ]));
      expect(runCompletedTerminalActors).toEqual([
        'manager',
        'role:evaluator',
        'role:generator',
        'role:planner',
      ]);
      expect(turnTransitions.length).toBeGreaterThanOrEqual(6);
    } finally {
      await rm(workspaceCwd, { recursive: true, force: true });
    }
  });

  it('emits wait_rearm_exhausted after five client_idle_disconnect cancellations and surfaces the cancellation', async () => {
    const workspaceCwd = await mkdtemp(join(tmpdir(), 'pluto-turn-state-'));
    const disconnectHarness = createDisconnectHarness({
      actor: LEAD,
      disconnects: 5,
      resolveOn: 'exhausted',
    });
    let exhaustedWait: ToolHttpResponse | null = null;

    try {
      const result = await runPaseo(
        buildSpec(),
        makePaseoAdapter({
          idProvider: counterIdProvider(100),
          clockProvider: fixedClockProvider(FIXED_TIME),
        }),
        {
          client: makeAutoWaitClient([
            {
              actor: LEAD,
              run: async ({ callTool }) => {
                await callTool('pluto_create_task', {
                  title: 'Draft the change',
                  ownerActor: LEAD,
                  dependsOn: [],
                });
                exhaustedWait = await callTool('pluto_wait_for_event', { timeoutSec: 300 });
                expect(exhaustedWait.status).toBe(200);
                expect(exhaustedWait.body).toMatchObject({
                  outcome: 'cancelled',
                  reason: 'wait_rearm_exhausted',
                });
                return { transcriptText: 'lead surfaced wait cancellation\n' };
              },
            },
            {
              actor: LEAD,
              run: async ({ callTool }) => {
                await callTool('pluto_final_reconciliation', failedAuditFinalReconciliationArgs('wait rearm exhausted'));
                return { transcriptText: 'lead closed after wait cap\n' };
              },
            },
          ], { autoWaitMutations: false }),
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
          onRuntimeTrace: disconnectHarness.onRuntimeTrace,
          onWaitRegistryReady: disconnectHarness.onWaitRegistryReady,
        },
      );

      await withTimeout(disconnectHarness.ready, 'wait rearm exhaustion');

      expect(result.runtimeTraces).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'wait_rearm_exhausted',
          actor: 'role:lead',
          attempts: 5,
        }),
      ]));
      expect(
        result.runtimeTraces.filter(
          (trace) => trace.kind === 'wait_cancelled' && trace.actor === 'role:lead' && trace.reason === 'client_idle_disconnect',
        ),
      ).toHaveLength(5);
      expect(exhaustedWait).not.toBeNull();
    } finally {
      await rm(workspaceCwd, { recursive: true, force: true });
    }
  });
});
