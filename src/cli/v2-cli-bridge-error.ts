export type PaseoErrorClass =
  | 'capability_unavailable'
  | 'spec_invalid'
  | 'run_not_completed'
  | 'agent_failed_to_start'
  | 'unknown';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hasErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === code;
}

function isCapabilityUnavailable(message: string): boolean {
  const lower = message.toLowerCase();
  const isPostSpawnMissingBinary = lower.includes('paseo run failed with exit code')
    && (lower.includes('command not found') || lower.includes('enoent') || lower.includes('not executable'));

  return (
    (lower.includes('spawn') && lower.includes('enoent'))
    || isPostSpawnMissingBinary
    || lower.includes('failed to spawn paseo cli')
    || lower.includes('eacces')
  );
}

export function classifyPaseoError(err: unknown): PaseoErrorClass {
  if (hasErrnoCode(err, 'ENOENT') || hasErrnoCode(err, 'EACCES')) {
    return 'capability_unavailable';
  }

  const message = errorMessage(err);
  if (isCapabilityUnavailable(message)) {
    return 'capability_unavailable';
  }

  if (err instanceof Error && err.name === 'ZodError') {
    return 'spec_invalid';
  }

  if (err instanceof Error && err.name === 'RunNotCompletedError') {
    return 'run_not_completed';
  }

  if (message.includes('Agent ') && message.includes(' failed to start')) {
    return 'agent_failed_to_start';
  }

  return 'unknown';
}
