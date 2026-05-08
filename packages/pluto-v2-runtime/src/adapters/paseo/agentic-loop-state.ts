import type { ActorRef } from '@pluto/v2-core';

import type { PaseoUsageEstimate } from './paseo-cli-client.js';
import type { PaseoDirective } from './paseo-directive.js';
import {
  createInitialAgenticSchedulerState,
  type PaseoAgenticSchedulerSpec,
  type PaseoAgenticSchedulerState,
} from './agentic-scheduler.js';

export interface PaseoRejectionSummary {
  readonly directive: PaseoDirective;
  readonly error: string;
}

export interface PaseoBufferedTurnResponse {
  readonly actor: ActorRef;
  readonly transcriptText: string;
  readonly usage: PaseoUsageEstimate;
}

export interface PaseoAgenticLoopState extends Omit<PaseoAgenticSchedulerState, 'currentActor'> {
  readonly mode: 'agentic';
  readonly currentActor: ActorRef | null;
  readonly transcriptByActor: Readonly<Record<string, string>>;
  readonly transcriptCursorByActor?: Readonly<Record<string, number>>;
  readonly awaitingResponseFor: ActorRef | null;
  readonly bufferedResponse: PaseoBufferedTurnResponse | null;
  readonly parseFailureCount: number;
  readonly maxParseFailuresPerTurn: number;
  readonly pendingDirective: PaseoDirective | null;
}

export interface CreateInitialAgenticLoopStateArgs {
  readonly spec: PaseoAgenticSchedulerSpec;
  readonly maxTurns?: number;
  readonly maxParseFailuresPerTurn?: number;
  readonly maxKernelRejections?: number;
  readonly maxNoProgressTurns?: number;
}

export const DEFAULT_MAX_PARSE_FAILURES_PER_TURN = 2;

export function createInitialAgenticLoopState(args: CreateInitialAgenticLoopStateArgs): PaseoAgenticLoopState {
  const schedulerState = createInitialAgenticSchedulerState({
    spec: args.spec,
    maxTurns: args.maxTurns,
    maxKernelRejections: args.maxKernelRejections,
    maxNoProgressTurns: args.maxNoProgressTurns,
  });

  return {
    ...schedulerState,
    mode: 'agentic',
    transcriptByActor: {},
    transcriptCursorByActor: {},
    awaitingResponseFor: schedulerState.currentActor,
    bufferedResponse: null,
    parseFailureCount: 0,
    maxParseFailuresPerTurn:
      args.maxParseFailuresPerTurn
      ?? args.spec.orchestration?.maxParseFailuresPerTurn
      ?? DEFAULT_MAX_PARSE_FAILURES_PER_TURN,
    pendingDirective: null,
  };
}
