import { actorKey, type ActorRef, type RunEvent } from '@pluto/v2-core';

import type { WakeupPromptDelta } from '../adapters/paseo/agentic-tool-prompt-builder.js';
import type { PromptView } from '../adapters/paseo/prompt-view.js';
import { computeWakeupDelta } from '../adapters/paseo/wakeup-delta.js';

export interface WaitTicket {
  readonly actor: ActorRef;
  readonly fromSequence: number;
  readonly armedAt: Date;
  readonly timeoutMs: number;
}

export interface WakeupPayload {
  readonly latestEvent: RunEvent;
  readonly delta: WakeupPromptDelta;
}

export type WaitOutcome =
  | { outcome: 'event'; payload: WakeupPayload }
  | { outcome: 'timeout' }
  | { outcome: 'cancelled'; reason: string };

export interface WaitRegistry {
  arm(input: { actor: ActorRef; fromSequence: number; timeoutMs: number }): Promise<WaitOutcome>;
  notify(event: RunEvent, getPromptViewForActor: (actor: ActorRef) => PromptView): void;
  cancelAll(reason: string): void;
  cancelForActor(actor: ActorRef, reason: string): void;
  hasArmedWait(actor: ActorRef): boolean;
}

export type WaitTraceEvent =
  | {
      readonly kind: 'wait_armed';
      readonly actor: string;
      readonly fromSequence: number;
      readonly armedAt: string;
    }
  | {
      readonly kind: 'wait_unblocked';
      readonly actor: string;
      readonly eventId: string;
      readonly sequence: number;
      readonly latencyMs: number;
    }
  | {
      readonly kind: 'wait_timed_out';
      readonly actor: string;
      readonly timeoutMs: number;
    }
  | {
      readonly kind: 'wait_cancelled';
      readonly actor: string;
      readonly reason: string;
    };

type ParkedWait = {
  readonly ticket: WaitTicket;
  readonly resolve: (outcome: WaitOutcome) => void;
  readonly clearTimer: () => void;
};

type WaitRegistryDeps = {
  readonly events: () => readonly RunEvent[];
  readonly getPromptViewForActor?: (actor: ActorRef) => PromptView;
  readonly now?: () => Date;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
  readonly onTrace?: (event: WaitTraceEvent) => void;
};

function sameActor(left: ActorRef, right: ActorRef): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === 'role' && right.kind === 'role') {
    return left.role === right.role;
  }

  return true;
}

function isLeadActor(actor: ActorRef): boolean {
  return actor.kind === 'role' && actor.role === 'lead';
}

function isVisibleMailboxEvent(
  forActor: ActorRef,
  event: RunEvent,
): event is Extract<RunEvent, { kind: 'mailbox_message_appended'; outcome: 'accepted' }> {
  if (event.kind !== 'mailbox_message_appended' || event.outcome !== 'accepted') {
    return false;
  }

  if (event.payload.toActor.kind === 'broadcast') {
    return false;
  }

  if (isLeadActor(forActor)) {
    return true;
  }

  return sameActor(event.payload.fromActor, forActor) || sameActor(event.payload.toActor, forActor);
}

function isVisibleEvent(forActor: ActorRef, event: RunEvent): boolean {
  if (isLeadActor(forActor)) {
    return event.kind !== 'mailbox_message_appended' || event.outcome !== 'accepted' || event.payload.toActor.kind !== 'broadcast';
  }

  if (event.kind === 'mailbox_message_appended') {
    return isVisibleMailboxEvent(forActor, event);
  }

  return true;
}

function latestVisibleEventSince(events: readonly RunEvent[], actor: ActorRef, fromSequence: number): RunEvent | null {
  let latest: RunEvent | null = null;
  for (const event of events) {
    if (event.sequence <= fromSequence || !isVisibleEvent(actor, event)) {
      continue;
    }

    latest = event;
  }

  return latest;
}

function buildWakeupPayload(args: {
  actor: ActorRef;
  fromSequence: number;
  latestEvent: RunEvent;
  events: readonly RunEvent[];
  getPromptViewForActor: (actor: ActorRef) => PromptView;
}): WakeupPayload {
  return {
    latestEvent: args.latestEvent,
    delta: computeWakeupDelta({
      events: args.events,
      fromSequence: args.fromSequence,
      forActor: args.actor,
      currentPromptView: args.getPromptViewForActor(args.actor),
    }),
  };
}

export function makeWaitRegistry(deps: WaitRegistryDeps): WaitRegistry {
  const now = deps.now ?? (() => new Date());
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const parkedByActorKey = new Map<string, ParkedWait>();
  let critical = Promise.resolve();

  const emitTrace = (event: WaitTraceEvent) => {
    deps.onTrace?.(event);
  };

  const withCriticalSection = <T>(work: () => T | Promise<T>): Promise<T> => {
    const next = critical.then(work, work);
    critical = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const releaseParkedWait = (parked: ParkedWait, outcome: WaitOutcome) => {
    parked.clearTimer();
    parkedByActorKey.delete(actorKey(parked.ticket.actor));
    parked.resolve(outcome);
  };

  return {
    async arm(input) {
      const result = await withCriticalSection<WaitOutcome | { parked: Promise<WaitOutcome> }>(() => {
        const key = actorKey(input.actor);
        const existing = parkedByActorKey.get(key);
        if (existing != null) {
          releaseParkedWait(existing, { outcome: 'cancelled', reason: 'replaced' });
          emitTrace({
            kind: 'wait_cancelled',
            actor: key,
            reason: 'replaced',
          });
        }

        const events = deps.events();
        const latestEvent = latestVisibleEventSince(events, input.actor, input.fromSequence);
        if (latestEvent != null) {
          const getPromptViewForActor = deps.getPromptViewForActor;
          if (getPromptViewForActor == null) {
            throw new Error('WaitRegistry immediate delivery requires getPromptViewForActor.');
          }

          return {
            outcome: 'event',
            payload: buildWakeupPayload({
              actor: input.actor,
              fromSequence: input.fromSequence,
              latestEvent,
              events,
              getPromptViewForActor,
            }),
          } satisfies WaitOutcome;
        }

        const armedAt = now();
        let parkedPromise!: Promise<WaitOutcome>;

        parkedPromise = new Promise<WaitOutcome>((resolve) => {
          const timer = setTimeoutFn(() => {
            void withCriticalSection(() => {
              const parked = parkedByActorKey.get(key);
              if (parked == null || parked.ticket.armedAt !== armedAt) {
                return;
              }

              releaseParkedWait(parked, { outcome: 'timeout' });
              emitTrace({
                kind: 'wait_timed_out',
                actor: key,
                timeoutMs: parked.ticket.timeoutMs,
              });
            });
          }, input.timeoutMs);

          const parked: ParkedWait = {
            ticket: {
              actor: input.actor,
              fromSequence: input.fromSequence,
              armedAt,
              timeoutMs: input.timeoutMs,
            },
            resolve,
            clearTimer: () => {
              clearTimeoutFn(timer);
            },
          };

          parkedByActorKey.set(key, parked);
          emitTrace({
            kind: 'wait_armed',
            actor: key,
            fromSequence: input.fromSequence,
            armedAt: armedAt.toISOString(),
          });
        });

        return { parked: parkedPromise };
      });

      return 'parked' in result ? await result.parked : result;
    },

    notify(event, getPromptViewForActor) {
      void withCriticalSection(() => {
        for (const [key, parked] of parkedByActorKey) {
          if (event.sequence <= parked.ticket.fromSequence || !isVisibleEvent(parked.ticket.actor, event)) {
            continue;
          }

          releaseParkedWait(parked, {
            outcome: 'event',
            payload: buildWakeupPayload({
              actor: parked.ticket.actor,
              fromSequence: parked.ticket.fromSequence,
              latestEvent: event,
              events: deps.events(),
              getPromptViewForActor,
            }),
          });
          emitTrace({
            kind: 'wait_unblocked',
            actor: key,
            eventId: event.eventId,
            sequence: event.sequence,
            latencyMs: Math.max(0, now().getTime() - parked.ticket.armedAt.getTime()),
          });
        }
      });
    },

    cancelAll(reason) {
      void withCriticalSection(() => {
        for (const [key, parked] of parkedByActorKey) {
          releaseParkedWait(parked, { outcome: 'cancelled', reason });
          emitTrace({
            kind: 'wait_cancelled',
            actor: key,
            reason,
          });
        }
      });
    },

    cancelForActor(actor, reason) {
      void withCriticalSection(() => {
        const key = actorKey(actor);
        const parked = parkedByActorKey.get(key);
        if (parked == null) {
          return;
        }

        releaseParkedWait(parked, { outcome: 'cancelled', reason });
        emitTrace({
          kind: 'wait_cancelled',
          actor: key,
          reason,
        });
      });
    },

    hasArmedWait(actor) {
      return parkedByActorKey.has(actorKey(actor));
    },
  };
}
