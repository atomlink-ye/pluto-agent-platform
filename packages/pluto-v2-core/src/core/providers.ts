export interface IdProvider {
  next(): string;
}

export interface ClockProvider {
  nowIso(): string;
}

export const defaultIdProvider: IdProvider = {
  next: () => crypto.randomUUID(),
};

export const defaultClockProvider: ClockProvider = {
  nowIso: () => new Date().toISOString(),
};

export function counterIdProvider(seed = 0): IdProvider {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new RangeError('counterIdProvider seed must be a non-negative integer');
  }

  let counter = seed;

  return {
    next() {
      const suffix = counter.toString(16).padStart(12, '0').slice(-12);
      counter += 1;
      return `00000000-0000-4000-8000-${suffix}`;
    },
  };
}

export function fixedClockProvider(iso: string): ClockProvider {
  return {
    nowIso: () => iso,
  };
}
