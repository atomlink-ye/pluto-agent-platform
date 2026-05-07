import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { makePaseoCliClient } from '../../../src/adapters/paseo/paseo-cli-client.js';

type SpawnMock = typeof import('node:child_process').spawn;

type SpawnCall = {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
};

type SpawnPlan = {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error;
};

class MockChildProcess extends EventEmitter {
  readonly stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  readonly stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });

  kill(): boolean {
    return true;
  }
}

const createSpawnStub = (plans: SpawnPlan[]) => {
  const calls: SpawnCall[] = [];
  const processSpawn = ((command: string, args: readonly string[], options?: { cwd?: string }) => {
    const plan = plans.shift();
    if (!plan) {
      throw new Error(`unexpected spawn: ${command} ${args.join(' ')}`);
    }

    calls.push({
      command,
      args: [...args],
      cwd: options?.cwd ?? '',
    });

    const child = new MockChildProcess();
    queueMicrotask(() => {
      if (plan.error) {
        child.emit('error', plan.error);
        return;
      }
      if (plan.stdout) {
        child.stdout.emit('data', plan.stdout);
      }
      if (plan.stderr) {
        child.stderr.emit('data', plan.stderr);
      }
      child.emit('close', plan.exitCode ?? 0);
    });
    return child;
  }) as unknown as SpawnMock;

  return { processSpawn, calls };
};

const TEST_CWD = '/repo';

describe('makePaseoCliClient', () => {
  it('spawns an agent with host and optional args', async () => {
    const { processSpawn, calls } = createSpawnStub([
      { stdout: '{"agentId":"agent-123"}' },
    ]);
    const client = makePaseoCliClient({
      cwd: TEST_CWD,
      host: '127.0.0.1:6767',
      processSpawn,
    });

    await expect(client.spawnAgent({
      provider: 'opencode',
      model: 'openai/gpt-5.4',
      mode: 'build',
      thinking: 'high',
      title: 'Planner',
      initialPrompt: 'Wait for the next prompt.',
      labels: ['role=planner', 'team=alpha'],
      cwd: '/workspace/task',
    })).resolves.toEqual({ agentId: 'agent-123' });

    expect(calls).toEqual([
      {
        command: 'paseo',
        args: [
          'run',
          '--detach',
          '--json',
          '--provider',
          'opencode',
          '--model',
          'openai/gpt-5.4',
          '--mode',
          'build',
          '--thinking',
          'high',
          '--title',
          'Planner',
          '--label',
          'role=planner',
          '--label',
          'team=alpha',
          '--cwd',
          '/workspace/task',
          '--host',
          '127.0.0.1:6767',
          'Wait for the next prompt.',
        ],
        cwd: TEST_CWD,
      },
    ]);
  });

  it('sends prompts through a temp file', async () => {
    let capturedPrompt = '';
    const { processSpawn, calls } = createSpawnStub([{ stdout: '' }]);
    const wrappedSpawn = ((command: string, args: readonly string[], options?: { cwd?: string }) => {
      if (args[0] === 'send' && args[3] === '--prompt-file' && typeof args[4] === 'string') {
        capturedPrompt = readFileSync(args[4], 'utf8');
      }
      return processSpawn(command, args, options);
    }) as unknown as SpawnMock;
    const prompt = 'x'.repeat(12_000);

    const clientWithCapture = makePaseoCliClient({ cwd: TEST_CWD, processSpawn: wrappedSpawn });

    await clientWithCapture.sendPrompt('agent-456', prompt);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toBe('send');
    expect(calls[0]?.args[1]).toBe('agent-456');
    expect(calls[0]?.args[2]).toBe('--no-wait');
    expect(calls[0]?.args[3]).toBe('--prompt-file');
    expect(calls[0]?.args[4]).toBeTruthy();
    expect(capturedPrompt).toBe(prompt);
  });

  it('returns agent exit code from wait json without throwing on non-zero', async () => {
    const { processSpawn, calls } = createSpawnStub([
      { exitCode: 0, stdout: '{"exitCode":17}' },
    ]);
    const client = makePaseoCliClient({ cwd: TEST_CWD, processSpawn });

    await expect(client.waitIdle('agent-789', 42)).resolves.toEqual({ exitCode: 17 });
    expect(calls[0]?.args).toEqual(['wait', 'agent-789', '--timeout', '42', '--json']);
  });

  it('parses usage from inspect json defensively', async () => {
    const { processSpawn } = createSpawnStub([
      {
        stdout: JSON.stringify({
          usage: {
            prompt_tokens: 321,
            completionTokens: 123,
            cost: { usd: '0.045' },
          },
        }),
      },
    ]);
    const client = makePaseoCliClient({ cwd: TEST_CWD, processSpawn });

    await expect(client.usageEstimate('agent-usage')).resolves.toEqual({
      inputTokens: 321,
      outputTokens: 123,
      costUsd: 0.045,
    });
  });

  it('returns an empty usage object when inspect data has no common fields', async () => {
    const { processSpawn } = createSpawnStub([
      { stdout: '{"status":"idle"}' },
    ]);
    const client = makePaseoCliClient({ cwd: TEST_CWD, processSpawn });

    await expect(client.usageEstimate('agent-empty')).resolves.toEqual({});
  });

  it('swallows delete failures', async () => {
    const { processSpawn, calls } = createSpawnStub([
      { exitCode: 2, stderr: 'not found' },
    ]);
    const client = makePaseoCliClient({ cwd: TEST_CWD, processSpawn });

    await expect(client.deleteAgent('agent-gone')).resolves.toBeUndefined();
    expect(calls[0]?.args).toEqual(['delete', 'agent-gone']);
  });

  it('reads transcript text logs', async () => {
    const { processSpawn, calls } = createSpawnStub([
      { stdout: 'line 1\nline 2\n' },
    ]);
    const client = makePaseoCliClient({ cwd: TEST_CWD, processSpawn });

    await expect(client.readTranscript('agent-log', 200)).resolves.toBe('line 1\nline 2\n');
    expect(calls[0]?.args).toEqual(['logs', 'agent-log', '--filter', 'text', '--tail', '200']);
  });
});
