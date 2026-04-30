import { randomUUID } from "node:crypto";

import type {
  BudgetBehaviorV0,
  BudgetDecisionV0,
  BudgetSnapshotV0,
  BudgetThresholdV0,
  BudgetV0,
  CanonicalAuditEnvelopeV0,
  RecordRefV0,
  UsageMeterV0,
} from "../contracts/observability.js";
import { ObservabilityStore } from "./observability-store.js";

export const DEFAULT_BUDGET_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

const BUDGET_BEHAVIOR_RANK: Record<BudgetBehaviorV0, number> = {
  allow: 0,
  warn: 1,
  require_override: 2,
  block: 3,
};

export interface BudgetGateDecisionItemV0 {
  budgetId: string;
  budgetKey: string;
  scopeRef: RecordRefV0;
  subjectRef: RecordRefV0;
  snapshotId: string | null;
  usageMeterId: string | null;
  behavior: BudgetBehaviorV0;
  overrideRequired: boolean;
  reason: string;
  sourceRefs: RecordRefV0[];
  approximationLabels: string[];
  driftNotes: string[];
  usage: {
    approximate: true;
    billingTruth: false;
    freshness: "fresh" | "missing" | "stale";
    meterKey: string | null;
    observedAt: string | null;
    consumed: number | null;
    remaining: number | null;
  };
}

export interface BudgetGateEvaluationV0 {
  behavior: BudgetBehaviorV0;
  overrideRequired: boolean;
  reason: string;
  decisions: BudgetGateDecisionItemV0[];
}

export interface EvaluateBudgetGateInputV0 {
  scopeRef: RecordRefV0;
  subjectRef: RecordRefV0;
  budgets: readonly BudgetV0[];
  snapshots: readonly BudgetSnapshotV0[];
  usageMeters?: readonly UsageMeterV0[];
  now?: Date | string;
  snapshotMaxAgeMs?: number;
}

export interface RecordBudgetDecisionInputV0 {
  store: ObservabilityStore;
  workspaceId: string;
  correlationId: string;
  decision: BudgetGateDecisionItemV0;
  actorId?: string | null;
  principalId?: string | null;
  reasonCode?: string | null;
  runId?: string | null;
  runAttempt?: number | null;
  idGen?: () => string;
  clock?: () => Date;
}

export function evaluateBudgetGateV0(input: EvaluateBudgetGateInputV0): BudgetGateEvaluationV0 {
  const now = asDate(input.now ?? new Date());
  const snapshotMaxAgeMs = input.snapshotMaxAgeMs ?? DEFAULT_BUDGET_SNAPSHOT_MAX_AGE_MS;
  const usageMeters = new Map((input.usageMeters ?? []).map((meter) => [meter.id, meter]));
  const snapshotsByBudget = latestSnapshotsByBudget(input.snapshots);
  const activeBudgets = input.budgets.filter((budget) => sameRef(budget.scopeRef, input.scopeRef));

  if (activeBudgets.length === 0) {
    return {
      behavior: "allow",
      overrideRequired: false,
      reason: "No active local approximate budgets matched this run scope.",
      decisions: [],
    };
  }

  const decisions = activeBudgets.map((budget) => {
    const snapshot = snapshotsByBudget.get(budget.id) ?? null;
    const usageMeter = snapshot?.usageMeterId ? usageMeters.get(snapshot.usageMeterId) ?? null : null;
    return evaluateBudgetDecisionItem(budget, snapshot, usageMeter, input.subjectRef, now, snapshotMaxAgeMs);
  });

  const behavior = decisions.reduce<BudgetBehaviorV0>(
    (current, decision) => maxBehavior(current, decision.behavior),
    "allow",
  );
  const overrideRequired = behavior === "require_override" || decisions.some((decision) => decision.overrideRequired);
  const reasons = decisions
    .filter((decision) => decision.behavior !== "allow")
    .map((decision) => decision.reason);

  return {
    behavior,
    overrideRequired,
    reason: reasons[0] ?? "All matching local approximate budgets currently allow this run.",
    decisions,
  };
}

export async function recordBudgetDecisionV0(input: RecordBudgetDecisionInputV0): Promise<BudgetDecisionV0> {
  const clock = input.clock ?? (() => new Date());
  const idGen = input.idGen ?? (() => randomUUID());
  const now = clock().toISOString();
  const id = `budget-decision-${idGen()}`;

  const audit: CanonicalAuditEnvelopeV0 = {
    eventId: `audit-${id}`,
    eventType: "budget_decision.recorded",
    recordedAt: now,
    correlationId: input.correlationId,
    actorId: input.actorId ?? null,
    principalId: input.principalId ?? "pluto.orchestrator",
    action: "run.budget.check",
    target: `${input.decision.subjectRef.kind}:${input.decision.subjectRef.id}`,
    outcome: input.decision.behavior,
    reasonCode: input.reasonCode ?? reasonCodeForBehavior(input.decision.behavior),
    redaction: clearRedaction(),
  };

  const record = {
    schema: "pluto.observability.budget-decision",
    schemaVersion: 0,
    kind: "budget_decision",
    id,
    workspaceId: input.workspaceId,
    createdAt: now,
    updatedAt: now,
    audit,
    budgetId: input.decision.budgetId,
    snapshotId: input.decision.snapshotId,
    subjectRef: input.decision.subjectRef,
    behavior: input.decision.behavior,
    overrideRequired: input.decision.overrideRequired,
    reason: input.decision.reason,
    decidedAt: now,
    sourceRefs: input.decision.sourceRefs,
    scopeRef: input.decision.scopeRef,
    budgetKey: input.decision.budgetKey,
    usageApproximation: input.decision.usage,
    approximateUsageLabels: [...input.decision.approximationLabels],
    driftNotes: [...input.decision.driftNotes],
    runCorrelation: {
      runId: input.runId ?? null,
      runAttempt: input.runAttempt ?? 1,
    },
  } as BudgetDecisionV0;

  return input.store.put(record);
}

function evaluateBudgetDecisionItem(
  budget: BudgetV0,
  snapshot: BudgetSnapshotV0 | null,
  usageMeter: UsageMeterV0 | null,
  subjectRef: RecordRefV0,
  now: Date,
  snapshotMaxAgeMs: number,
): BudgetGateDecisionItemV0 {
  const freshness = evaluateSnapshotFreshness(snapshot, now, snapshotMaxAgeMs);
  const approximationLabels = [
    "local_approximation",
    "not_billing_truth",
    `usage_snapshot_${freshness}`,
  ];
  const driftNotes = [
    "Budget and usage records are local approximation signals, not billing truth.",
  ];

  const strictFallback = strictFallbackBehavior(budget);
  const sourceRefs = [{ kind: "budget", id: budget.id }];
  if (snapshot) {
    sourceRefs.push({ kind: "budget_snapshot", id: snapshot.id });
  }
  if (usageMeter) {
    sourceRefs.push({ kind: "usage_meter", id: usageMeter.id });
    approximationLabels.push(`meter_${slugify(usageMeter.meterKey)}`);
  }

  let behavior: BudgetBehaviorV0 = "allow";
  let reason = `Budget ${budget.budgetKey} currently allows this run based on local approximate usage.`;

  if (!snapshot) {
    driftNotes.push("No approximate usage snapshot was available for this budget.");
    if (strictFallback) {
      behavior = strictFallback;
      reason = `Budget ${budget.budgetKey} requires a conservative ${strictFallback} because no local approximate usage snapshot was available.`;
    }
    return buildDecisionItem();
  }

  if (freshness === "stale") {
    driftNotes.push(`Approximate usage snapshot ${snapshot.id} is stale.`);
    if (strictFallback) {
      behavior = strictFallback;
      reason = `Budget ${budget.budgetKey} requires a conservative ${strictFallback} because the local approximate usage snapshot is stale.`;
      return buildDecisionItem();
    }
  }

  const thresholdBehavior = evaluateThresholdBehavior(budget.thresholds, usageMeter, snapshot.consumed);
  const snapshotBehavior = normalizeBehavior(snapshot.behavior);
  behavior = maxBehavior(behavior, maxBehavior(thresholdBehavior, snapshotBehavior));

  if (behavior === "allow" && freshness !== "fresh") {
    reason = `Budget ${budget.budgetKey} allows this run, but the decision relied on incomplete local approximate usage evidence.`;
  } else if (behavior !== "allow") {
    const meterLabel = usageMeter?.meterKey ?? "snapshot";
    reason = `Budget ${budget.budgetKey} returned ${behavior} from local approximate ${meterLabel} usage.`;
  }

  return buildDecisionItem();

  function buildDecisionItem(): BudgetGateDecisionItemV0 {
    return {
      budgetId: budget.id,
      budgetKey: budget.budgetKey,
      scopeRef: budget.scopeRef,
      subjectRef,
      snapshotId: snapshot?.id ?? null,
      usageMeterId: usageMeter?.id ?? snapshot?.usageMeterId ?? null,
      behavior,
      overrideRequired: behavior === "require_override",
      reason,
      sourceRefs,
      approximationLabels,
      driftNotes,
      usage: {
        approximate: true,
        billingTruth: false,
        freshness,
        meterKey: usageMeter?.meterKey ?? null,
        observedAt: snapshot?.observedAt ?? null,
        consumed: snapshot?.consumed ?? null,
        remaining: snapshot?.remaining ?? null,
      },
    };
  }
}

function evaluateThresholdBehavior(
  thresholds: readonly BudgetThresholdV0[],
  usageMeter: UsageMeterV0 | null,
  consumed: number,
): BudgetBehaviorV0 {
  if (!usageMeter) {
    return "allow";
  }

  return thresholds.reduce<BudgetBehaviorV0>((current, threshold) => {
    if (threshold.metricKey !== usageMeter.meterKey) {
      return current;
    }
    if (consumed < threshold.limit) {
      return current;
    }
    return maxBehavior(current, normalizeBehavior(threshold.behavior));
  }, "allow");
}

function strictFallbackBehavior(budget: BudgetV0): BudgetBehaviorV0 | null {
  const behaviors = [budget.defaultBehavior, ...budget.thresholds.map((threshold) => threshold.behavior)]
    .map((behavior) => normalizeBehavior(behavior))
    .filter((behavior) => behavior === "block" || behavior === "require_override");

  if (behaviors.length === 0) {
    return null;
  }

  return behaviors.reduce<BudgetBehaviorV0>((current, behavior) => maxBehavior(current, behavior), "allow");
}

function latestSnapshotsByBudget(snapshots: readonly BudgetSnapshotV0[]): Map<string, BudgetSnapshotV0> {
  const latest = new Map<string, BudgetSnapshotV0>();
  for (const snapshot of snapshots) {
    const current = latest.get(snapshot.budgetId);
    if (!current || snapshot.observedAt > current.observedAt) {
      latest.set(snapshot.budgetId, snapshot);
    }
  }
  return latest;
}

function evaluateSnapshotFreshness(
  snapshot: BudgetSnapshotV0 | null,
  now: Date,
  snapshotMaxAgeMs: number,
): "fresh" | "missing" | "stale" {
  if (!snapshot) {
    return "missing";
  }

  const observedAt = asDate(snapshot.observedAt);
  if (Number.isNaN(observedAt.getTime())) {
    return "stale";
  }

  return now.getTime() - observedAt.getTime() > snapshotMaxAgeMs ? "stale" : "fresh";
}

function sameRef(left: RecordRefV0, right: RecordRefV0): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function maxBehavior(left: BudgetBehaviorV0, right: BudgetBehaviorV0): BudgetBehaviorV0 {
  return BUDGET_BEHAVIOR_RANK[left] >= BUDGET_BEHAVIOR_RANK[right] ? left : right;
}

function normalizeBehavior(value: string): BudgetBehaviorV0 {
  switch (value) {
    case "warn":
    case "block":
    case "require_override":
      return value;
    default:
      return "allow";
  }
}

function reasonCodeForBehavior(behavior: BudgetBehaviorV0): string {
  return `budget_${behavior}`;
}

function clearRedaction() {
  return {
    containsSensitiveData: false,
    state: "clear",
    redactionCount: 0,
    redactedPaths: [],
  };
}

function slugify(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "unknown";
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
