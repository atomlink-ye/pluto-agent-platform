import type { ActorRef } from '@pluto/v2-core';

import type { LoadedAuthoredSpec } from '../../loader/authored-spec-loader.js';
import {
  DEFAULT_MAX_KERNEL_REJECTIONS,
  DEFAULT_MAX_NO_PROGRESS_TURNS,
  DEFAULT_MAX_TURNS,
  HARD_MAX_TURNS,
  LEAD_ACTOR,
} from './agentic-scheduler.js';
import type { PaseoDirective } from './paseo-directive.js';
import type { PaseoUsageEstimate } from './paseo-cli-client.js';

export interface PaseoRejectionSummary {
  readonly directive: PaseoDirective;
  readonly error: string;
}

export interface PaseoBufferedTurnResponse {
  readonly actor: ActorRef;
  readonly transcriptText: string;
  readonly usage: PaseoUsageEstimate;
}

export interface CreateInitialAgenticLoopStateArgs {
  readonly spec: LoadedAuthoredSpec;
  readonly maxTurns?: number;
  readonly maxParseFailuresPerTurn?: number;
  readonly maxKernelRejections?: number;
  readonly maxNoProgressTurns?: number;
}

export interface AgenticLoopStateDefaults {
  readonly mode: 'agentic';
  readonly agenticSpec: LoadedAuthoredSpec;
  readonly delegationPointer: ActorRef | null;
  readonly delegationTaskId: string | null;
  readonly kernelRejections: number;
  readonly noProgressTurns: number;
  readonly lastRejection: PaseoRejectionSummary | null;
  readonly maxKernelRejections: number;
  readonly maxNoProgressTurns: number;
  readonly pendingDirective: PaseoDirective | null;
  readonly pendingRepairPrompt: string | null;
  readonly currentActor: ActorRef;
  readonly awaitingResponseFor: ActorRef;
  readonly bufferedResponse: PaseoBufferedTurnResponse | null;
  readonly parseFailureCount: number;
  readonly maxParseFailuresPerTurn: number;
  readonly transcriptByActor: Readonly<Record<string, string>>;
  readonly transcriptCursorByActor: Readonly<Record<string, number>>;
  readonly turnIndex: number;
  readonly maxTurns: number;
}

export const DEFAULT_MAX_PARSE_FAILURES_PER_TURN = 2;

function normalizeMax(value: number | undefined, fallback: number, hardCap?: number): number {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.max(0, Math.trunc(value));
  if (hardCap == null) {
    return normalized;
  }

  return Math.min(normalized, hardCap);
}

export function createInitialAgenticLoopState(args: CreateInitialAgenticLoopStateArgs): AgenticLoopStateDefaults {
  return {
    mode: 'agentic',
    agenticSpec: args.spec,
    delegationPointer: null,
    delegationTaskId: null,
    kernelRejections: 0,
    noProgressTurns: 0,
    lastRejection: null,
    maxKernelRejections: normalizeMax(
      args.maxKernelRejections ?? args.spec.orchestration?.maxKernelRejections,
      DEFAULT_MAX_KERNEL_REJECTIONS,
    ),
    maxNoProgressTurns: normalizeMax(
      args.maxNoProgressTurns ?? args.spec.orchestration?.maxNoProgressTurns,
      DEFAULT_MAX_NO_PROGRESS_TURNS,
    ),
    pendingDirective: null,
    pendingRepairPrompt: null,
    currentActor: LEAD_ACTOR,
    awaitingResponseFor: LEAD_ACTOR,
    bufferedResponse: null,
    parseFailureCount: 0,
    maxParseFailuresPerTurn:
      args.maxParseFailuresPerTurn
      ?? args.spec.orchestration?.maxParseFailuresPerTurn
      ?? DEFAULT_MAX_PARSE_FAILURES_PER_TURN,
    transcriptByActor: {},
    transcriptCursorByActor: {},
    turnIndex: 0,
    maxTurns: normalizeMax(args.maxTurns ?? args.spec.orchestration?.maxTurns, DEFAULT_MAX_TURNS, HARD_MAX_TURNS),
  };
}
