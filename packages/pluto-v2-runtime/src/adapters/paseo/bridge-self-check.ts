import * as childProcess from 'node:child_process';

export type BridgeSelfCheckFailureReason =
  | 'wrapper_missing'
  | 'nonzero_exit'
  | 'timeout'
  | 'invalid_response'
  | 'other';

export interface BridgeSelfCheckResult {
  readonly ok: boolean;
  readonly reason?: BridgeSelfCheckFailureReason;
  readonly stderr?: string;
  readonly latencyMs: number;
}

function stderrOf(result: { stderr?: string | Buffer | null; error?: Error | null }): string | undefined {
  if (typeof result.stderr === 'string' && result.stderr.length > 0) {
    return result.stderr;
  }

  return result.error?.message;
}

function invalidResponse(latencyMs: number, stderr?: string): BridgeSelfCheckResult {
  return {
    ok: false,
    reason: 'invalid_response',
    stderr,
    latencyMs,
  };
}

export async function runBridgeSelfCheck(input: {
  readonly wrapperPath: string;
  readonly timeoutMs?: number;
  readonly spawnSync?: typeof import('node:child_process').spawnSync;
}): Promise<BridgeSelfCheckResult> {
  const timeoutMs = input.timeoutMs ?? 5000;
  const spawnSync = input.spawnSync ?? childProcess.spawnSync;
  const startedAt = Date.now();
  const result = spawnSync(input.wrapperPath, ['read-state'], {
    env: {},
    timeout: timeoutMs,
    encoding: 'utf8',
  });
  const latencyMs = Date.now() - startedAt;
  const stderr = stderrOf(result);

  if (result.error != null) {
    if (result.error.message.includes('ENOENT')) {
      return {
        ok: false,
        reason: 'wrapper_missing',
        stderr,
        latencyMs,
      };
    }

    if (result.error.message.includes('ETIMEDOUT')) {
      return {
        ok: false,
        reason: 'timeout',
        stderr,
        latencyMs,
      };
    }

    return {
      ok: false,
      reason: 'other',
      stderr,
      latencyMs,
    };
  }

  if (result.signal === 'SIGTERM') {
    return {
      ok: false,
      reason: 'timeout',
      stderr,
      latencyMs,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      reason: 'nonzero_exit',
      stderr,
      latencyMs,
    };
  }

  if (typeof result.stdout !== 'string') {
    return invalidResponse(latencyMs, stderr);
  }

  try {
    const parsed = JSON.parse(result.stdout) as { run?: unknown };
    if (parsed.run == null) {
      return invalidResponse(latencyMs, stderr);
    }

    return {
      ok: true,
      latencyMs,
    };
  } catch {
    return invalidResponse(latencyMs, stderr);
  }
}
