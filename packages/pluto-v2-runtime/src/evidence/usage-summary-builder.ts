import type { ActorRef, AuthoredSpec } from '@pluto/v2-core';

import type { EvidencePacket } from './evidence-packet.js';

export type UsageStatus = 'reported' | 'unavailable';

export type ActorUsageTotals = {
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly provider: string | null;
  readonly model: string | null;
  readonly mode: string | null;
  readonly thinking: string | null;
};

export type ModelUsageTotals = {
  readonly provider: string;
  readonly model: string;
  readonly mode: string | null;
  readonly thinking: string | null;
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly actors: ReadonlyArray<string>;
};

type MutableModelUsageTotals = {
  provider: string;
  model: string;
  mode: string | null;
  thinking: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  actors: string[];
};

export type UsageSummaryActorSpec = {
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly thinking?: string;
};

export type UsagePerTurn = {
  readonly turnIndex: number;
  readonly actor: ActorRef;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly waitExitCode: number;
};

export type UsageSummaryInput = {
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCostUsd: number;
  readonly byActor: ReadonlyMap<string, {
    readonly turns: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  }>;
  readonly perTurn: ReadonlyArray<UsagePerTurn>;
  readonly usageStatus?: UsageStatus;
  readonly reportedBy?: string;
  readonly estimated?: boolean;
};

export type BuiltUsageSummary = {
  readonly runId: string;
  readonly scenarioRef: string;
  readonly runProfileRef: string;
  readonly status: EvidencePacket['status'];
  readonly finalSummary: string | null;
  readonly totalTurns: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly usageStatus: UsageStatus;
  readonly reportedBy: 'paseo.usageEstimate';
  readonly estimated: boolean;
  readonly byActor: Readonly<Record<string, ActorUsageTotals>>;
  readonly perTurn: ReadonlyArray<{
    readonly turnIndex: number;
    readonly actor: ActorRef;
    readonly actorKey: string;
    readonly provider: string | null;
    readonly model: string | null;
    readonly mode: string | null;
    readonly thinking: string | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly costUsd: number;
    readonly waitExitCode: number;
  }>;
  readonly byModel: Readonly<Record<string, ModelUsageTotals>>;
  readonly evidencePacketPath: string;
};

function actorKey(actor: ActorRef): string {
  switch (actor.kind) {
    case 'manager':
      return 'manager';
    case 'system':
      return 'system';
    case 'role':
      return `role:${actor.role}`;
  }
}

function usageStatusOf(perTurn: ReadonlyArray<UsagePerTurn>): UsageStatus {
  return perTurn.some((entry) => entry.inputTokens > 0 || entry.outputTokens > 0 || entry.costUsd > 0)
    ? 'reported'
    : 'unavailable';
}

export function buildUsageSummary(args: {
  readonly authored: AuthoredSpec;
  readonly evidencePacket: EvidencePacket;
  readonly usage: UsageSummaryInput;
  readonly actorSpecByKey?: ReadonlyMap<string, UsageSummaryActorSpec>;
  readonly evidencePacketPath: string;
}): BuiltUsageSummary {
  const perTurn = args.usage.perTurn.map((entry) => {
    const key = actorKey(entry.actor);
    const spec = args.actorSpecByKey?.get(key);
    return {
      turnIndex: entry.turnIndex,
      actor: entry.actor,
      actorKey: key,
      provider: spec?.provider ?? null,
      model: spec?.model ?? null,
      mode: spec?.mode ?? null,
      thinking: spec?.thinking ?? null,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.inputTokens + entry.outputTokens,
      costUsd: entry.costUsd,
      waitExitCode: entry.waitExitCode,
    };
  });

  const usageStatus = args.usage.usageStatus ?? usageStatusOf(args.usage.perTurn);
  const byActor = Object.fromEntries(
    [...args.usage.byActor.entries()].map(([key, usage]) => {
      const spec = args.actorSpecByKey?.get(key);
      const normalized: ActorUsageTotals = {
        turns: usage.turns,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        costUsd: usage.costUsd,
        provider: spec?.provider ?? null,
        model: spec?.model ?? null,
        mode: spec?.mode ?? null,
        thinking: spec?.thinking ?? null,
      };
      return [key, normalized];
    }),
  );

  const byModelAccumulator = new Map<string, MutableModelUsageTotals>();
  for (const turn of perTurn) {
    const providerKey = turn.provider ?? 'unknown-provider';
    const modelKey = turn.model ?? 'unknown-model';
    const breakdownKey = `${providerKey}:${modelKey}`;
    const current = byModelAccumulator.get(breakdownKey) ?? {
      provider: providerKey,
      model: modelKey,
      mode: turn.mode,
      thinking: turn.thinking,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      actors: [],
    };
    current.turns += 1;
    current.inputTokens += turn.inputTokens;
    current.outputTokens += turn.outputTokens;
    current.totalTokens += turn.totalTokens;
    current.costUsd += turn.costUsd;
    if (!current.actors.includes(turn.actorKey)) {
      current.actors.push(turn.actorKey);
    }
    byModelAccumulator.set(breakdownKey, current);
  }

  return {
    runId: args.authored.runId,
    scenarioRef: args.authored.scenarioRef,
    runProfileRef: args.authored.runProfileRef,
    status: args.evidencePacket.status,
    finalSummary: args.evidencePacket.summary,
    totalTurns: perTurn.length,
    totalInputTokens: args.usage.totalInputTokens,
    totalOutputTokens: args.usage.totalOutputTokens,
    totalTokens: args.usage.totalInputTokens + args.usage.totalOutputTokens,
    totalCostUsd: args.usage.totalCostUsd,
    usageStatus,
    reportedBy: 'paseo.usageEstimate',
    estimated: args.usage.estimated ?? usageStatus === 'reported',
    byActor,
    perTurn,
    byModel: Object.fromEntries(byModelAccumulator.entries()),
    evidencePacketPath: args.evidencePacketPath,
  };
}

export function shouldTreatTotalCostUsdAsHardCap(summary: Pick<BuiltUsageSummary, 'usageStatus'>): boolean {
  return summary.usageStatus === 'reported';
}
