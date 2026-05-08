import { describe, expect, it } from 'vitest';

import { makeTurnLeaseStore } from '../../src/mcp/turn-lease.js';

describe('makeTurnLeaseStore', () => {
  it('starts empty when no initial actor is provided', () => {
    const store = makeTurnLeaseStore();

    expect(store.current()).toBeNull();
    expect(store.matches({ kind: 'role', role: 'lead' })).toBe(false);
  });

  it('matches structurally rather than by object identity', () => {
    const store = makeTurnLeaseStore({ kind: 'role', role: 'generator' });

    expect(store.matches({ kind: 'role', role: 'generator' })).toBe(true);
    expect(store.matches({ kind: 'role', role: 'planner' })).toBe(false);
  });

  it('allows clearing and replacing the current lease holder', () => {
    const store = makeTurnLeaseStore({ kind: 'manager' });

    store.setCurrent(null);
    expect(store.current()).toBeNull();
    expect(store.matches({ kind: 'manager' })).toBe(false);

    store.setCurrent({ kind: 'role', role: 'lead' });
    expect(store.current()).toEqual({ kind: 'role', role: 'lead' });
    expect(store.matches({ kind: 'role', role: 'lead' })).toBe(true);
  });
});
