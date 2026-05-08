import type { ActorRef } from '@pluto/v2-core';

export interface TurnLeaseStore {
  current(): ActorRef | null;
  setCurrent(actor: ActorRef | null): void;
  matches(actor: ActorRef): boolean;
}

function sameActor(left: ActorRef, right: ActorRef): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === 'role' && right.kind === 'role') {
    return left.role === right.role;
  }

  return true;
}

export function makeTurnLeaseStore(initial: ActorRef | null = null): TurnLeaseStore {
  let currentActor = initial;

  return {
    current() {
      return currentActor;
    },

    setCurrent(actor) {
      currentActor = actor;
    },

    matches(actor) {
      return currentActor !== null && sameActor(currentActor, actor);
    },
  };
}
