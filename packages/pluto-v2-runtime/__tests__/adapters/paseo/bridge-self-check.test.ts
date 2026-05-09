import type { SpawnSyncReturns } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { runBridgeSelfCheck } from '../../../src/adapters/paseo/bridge-self-check.js';

type SpawnSync = typeof import('node:child_process').spawnSync;

function spawnResult(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return {
    pid: 123,
    output: [],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    error: undefined,
    ...overrides,
  } as SpawnSyncReturns<string>;
}

describe('runBridgeSelfCheck', () => {
  it('returns ok for a valid read-state response', async () => {
    const result = await runBridgeSelfCheck({
      wrapperPath: '/tmp/pluto-tool',
      spawnSync: ((() => spawnResult({ stdout: JSON.stringify({ run: { runId: 'run-1' } }) })) as unknown as SpawnSync),
    });

    expect(result).toMatchObject({ ok: true });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports wrapper_missing when the wrapper cannot be executed', async () => {
    const result = await runBridgeSelfCheck({
      wrapperPath: '/tmp/missing-pluto-tool',
      spawnSync: ((() => spawnResult({ error: new Error('spawnSync /tmp/missing-pluto-tool ENOENT') })) as unknown as SpawnSync),
    });

    expect(result).toMatchObject({ ok: false, reason: 'wrapper_missing' });
  });

  it('reports nonzero_exit when the wrapper exits unsuccessfully', async () => {
    const result = await runBridgeSelfCheck({
      wrapperPath: '/tmp/pluto-tool',
      spawnSync: ((() => spawnResult({ status: 64, stderr: 'missing handoff' })) as unknown as SpawnSync),
    });

    expect(result).toMatchObject({ ok: false, reason: 'nonzero_exit', stderr: 'missing handoff' });
  });

  it('reports timeout when the wrapper does not finish before the deadline', async () => {
    const result = await runBridgeSelfCheck({
      wrapperPath: '/tmp/pluto-tool',
      timeoutMs: 1,
      spawnSync: ((() => spawnResult({
        status: null,
        signal: 'SIGTERM',
        error: new Error('spawnSync /tmp/pluto-tool ETIMEDOUT'),
      })) as unknown as SpawnSync),
    });

    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('reports other when spawnSync fails with an uncategorized error', async () => {
    const result = await runBridgeSelfCheck({
      wrapperPath: '/tmp/pluto-tool',
      spawnSync: ((() => spawnResult({ error: new Error('spawnSync /tmp/pluto-tool EACCES') })) as unknown as SpawnSync),
    });

    expect(result).toMatchObject({ ok: false, reason: 'other' });
  });

  it('reports invalid_response when stdout is not valid read-state JSON', async () => {
    const result = await runBridgeSelfCheck({
      wrapperPath: '/tmp/pluto-tool',
      spawnSync: ((() => spawnResult({ stdout: 'not json' })) as unknown as SpawnSync),
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
  });
});
