import type { ActorRef, AuthoredSpec } from '@pluto/v2-core';

import type { EvidencePacket } from './evidence-packet.js';

export type UsageStatus = 'available' | 'unavailable' | 'partial';

type UsageMetric = number | null;

export type ActorUsageTotals = {
  readonly turns: number;
  readonly inputTokens: UsageMetric;
  readonly outputTokens: UsageMetric;
  readonly totalTokens: UsageMetric;
  readonly costUsd: UsageMetric;
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
  readonly inputTokens: UsageMetric;
  readonly outputTokens: UsageMetric;
  readonly totalTokens: UsageMetric;
  readonly costUsd: UsageMetric;
  readonly actors: ReadonlyArray<string>;
};

type MutableModelUsageTotals = {
  provider: string;
  model: string;
  mode: string | null;
  thinking: string | null;
  turns: number;
  inputTokens: UsageMetric;
  outputTokens: UsageMetric;
  totalTokens: UsageMetric;
  costUsd: UsageMetric;
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
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
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
  readonly usageStatus?: string;
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
  readonly totalInputTokens: UsageMetric;
  readonly totalOutputTokens: UsageMetric;
  readonly totalTokens: UsageMetric;
  readonly totalCostUsd: UsageMetric;
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
    readonly inputTokens: UsageMetric;
    readonly outputTokens: UsageMetric;
    readonly totalTokens: UsageMetric;
    readonly costUsd: UsageMetric;
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

  return 'unknown';
}

function normalizeMetric(value: number | null | undefined): UsageMetric {
  return typeof value === 'number' ? value : null;
}

function hasReportedUsage(entry: Pick<UsagePerTurn, 'inputTokens' | 'outputTokens' | 'costUsd'>): boolean {
  return (entry.inputTokens ?? 0) > 0 || (entry.outputTokens ?? 0) > 0 || (entry.costUsd ?? 0) > 0;
}

function totalTokensOf(inputTokens: UsageMetric, outputTokens: UsageMetric): UsageMetric {
  return inputTokens == null || outputTokens == null ? null : inputTokens + outputTokens;
}

function sumMetric(values: ReadonlyArray<UsageMetric>): UsageMetric {
  if (values.length === 0) {
    return null;
  }

  if (values.some((value) => value == null)) {
    return null;
  }

  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function usageStatusOf(perTurn: ReadonlyArray<UsagePerTurn>): UsageStatus {
  const reportedTurnCount = perTurn.filter((entry) => hasReportedUsage(entry)).length;

  if (reportedTurnCount === 0) {
    return 'unavailable';
  }

  return reportedTurnCount === perTurn.length ? 'available' : 'partial';
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
    const reportedUsage = hasReportedUsage(entry);
    const inputTokens = reportedUsage ? normalizeMetric(entry.inputTokens) : null;
    const outputTokens = reportedUsage ? normalizeMetric(entry.outputTokens) : null;
    return {
      turnIndex: entry.turnIndex,
      actor: entry.actor,
      actorKey: key,
      provider: spec?.provider ?? null,
      model: spec?.model ?? null,
      mode: spec?.mode ?? null,
      thinking: spec?.thinking ?? null,
      inputTokens,
      outputTokens,
      totalTokens: totalTokensOf(inputTokens, outputTokens),
      costUsd: reportedUsage ? normalizeMetric(entry.costUsd) : null,
      waitExitCode: entry.waitExitCode,
    };
  });

  const usageStatus = usageStatusOf(args.usage.perTurn);
  const byActorAccumulator = new Map<string, typeof perTurn>();
  for (const turn of perTurn) {
    const current = byActorAccumulator.get(turn.actorKey) ?? [];
    current.push(turn);
    byActorAccumulator.set(turn.actorKey, current);
  }

  const byActor = Object.fromEntries(
    [...byActorAccumulator.entries()].map(([key, turns]) => {
      const spec = args.actorSpecByKey?.get(key);
      const normalized: ActorUsageTotals = {
        turns: turns.length,
        inputTokens: sumMetric(turns.map((turn) => turn.inputTokens)),
        outputTokens: sumMetric(turns.map((turn) => turn.outputTokens)),
        totalTokens: sumMetric(turns.map((turn) => turn.totalTokens)),
        costUsd: sumMetric(turns.map((turn) => turn.costUsd)),
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
    current.inputTokens = current.inputTokens == null || turn.inputTokens == null
      ? null
      : current.inputTokens + turn.inputTokens;
    current.outputTokens = current.outputTokens == null || turn.outputTokens == null
      ? null
      : current.outputTokens + turn.outputTokens;
    current.totalTokens = current.totalTokens == null || turn.totalTokens == null
      ? null
      : current.totalTokens + turn.totalTokens;
    current.costUsd = current.costUsd == null || turn.costUsd == null
      ? null
      : current.costUsd + turn.costUsd;
    if (!current.actors.includes(turn.actorKey)) {
      current.actors.push(turn.actorKey);
    }
    byModelAccumulator.set(breakdownKey, current);
  }

  const totalInputTokens = sumMetric(perTurn.map((turn) => turn.inputTokens));
  const totalOutputTokens = sumMetric(perTurn.map((turn) => turn.outputTokens));

  return {
    runId: args.authored.runId,
    scenarioRef: args.authored.scenarioRef,
    runProfileRef: args.authored.runProfileRef,
    status: args.evidencePacket.status,
    finalSummary: args.evidencePacket.summary,
    totalTurns: perTurn.length,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalTokensOf(totalInputTokens, totalOutputTokens),
    totalCostUsd: sumMetric(perTurn.map((turn) => turn.costUsd)),
    usageStatus,
    reportedBy: 'paseo.usageEstimate',
    estimated: args.usage.estimated ?? usageStatus !== 'unavailable',
    byActor,
    perTurn,
    byModel: Object.fromEntries(byModelAccumulator.entries()),
    evidencePacketPath: args.evidencePacketPath,
  };
}

export function shouldTreatTotalCostUsdAsHardCap(summary: Pick<BuiltUsageSummary, 'usageStatus'>): boolean {
  return summary.usageStatus === 'available';
}
