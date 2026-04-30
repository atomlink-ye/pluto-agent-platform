import type { UpgradeRunStatusV0, UpgradeRunV0 } from "../contracts/ops.js";
import { parseUpgradeRunStatusV0 } from "../contracts/ops.js";
import { assertUpgradeExecutionReadyV0, assertUpgradeRollbackReadyV0 } from "./upgrade-gates.js";

export interface UpgradeLifecycleTransitionInputV0 {
  run: UpgradeRunV0;
  toStatus: UpgradeRunStatusV0;
  transitionedAt: string;
  transitionKey?: string | null;
  failureReason?: string | null;
  approvalRefs?: readonly string[];
  backupRefs?: readonly string[];
  healthRefs?: readonly string[];
  rollbackRefs?: readonly string[];
  evidenceRefs?: readonly string[];
}

const TERMINAL_UPGRADE_STATUSES_V0 = new Set<UpgradeRunStatusV0>(["completed", "rolledBack", "failed"]);

const ALLOWED_TRANSITIONS_V0: Record<UpgradeRunStatusV0, ReadonlySet<UpgradeRunStatusV0>> = {
  planned: new Set(["approved", "failed"]),
  approved: new Set(["backingUp", "failed"]),
  backingUp: new Set(["running", "rolledBack", "failed"]),
  running: new Set(["validating", "rolledBack", "failed"]),
  validating: new Set(["healthCheck", "rolledBack", "failed"]),
  healthCheck: new Set(["completed", "rolledBack", "failed"]),
  completed: new Set(),
  rolledBack: new Set(),
  failed: new Set(),
};

export function transitionUpgradeRunV0(input: UpgradeLifecycleTransitionInputV0): UpgradeRunV0 {
  const currentStatus = parseKnownStatus(input.run.status, "run.status");
  const nextStatus = parseKnownStatus(input.toStatus, "toStatus");
  const replayKey = input.transitionKey ?? null;

  if (replayKey !== null && input.run.lastTransitionKey === replayKey) {
    if (currentStatus !== nextStatus) {
      throw new Error(`Replay key ${replayKey} already applied to ${currentStatus}`);
    }

    if (nextStatus === "failed" && input.failureReason !== undefined && input.failureReason !== input.run.failureReason) {
      throw new Error(`Replay key ${replayKey} conflicts with existing failure reason`);
    }

    return input.run;
  }

  if (currentStatus === nextStatus) {
    throw new Error(`Upgrade run ${input.run.id} is already ${currentStatus}`);
  }

  if (TERMINAL_UPGRADE_STATUSES_V0.has(currentStatus)) {
    throw new Error(`Upgrade run ${input.run.id} is already terminal at ${currentStatus}`);
  }

  if (!ALLOWED_TRANSITIONS_V0[currentStatus].has(nextStatus)) {
    throw new Error(`Invalid upgrade transition from ${currentStatus} to ${nextStatus}`);
  }

  if (nextStatus === "failed" && typeof input.failureReason !== "string") {
    throw new Error("failureReason is required when transitioning to failed");
  }

  const startedAt = currentStatus === "planned" && nextStatus === "approved"
    ? input.run.startedAt ?? input.transitionedAt
    : input.run.startedAt;
  const finishedAt = TERMINAL_UPGRADE_STATUSES_V0.has(nextStatus) ? input.transitionedAt : null;

  return {
    ...input.run,
    status: nextStatus,
    approvalRefs: mergeRefs(input.run.approvalRefs, input.approvalRefs),
    backupRefs: mergeRefs(input.run.backupRefs, input.backupRefs),
    healthRefs: mergeRefs(input.run.healthRefs, input.healthRefs),
    rollbackRefs: mergeRefs(input.run.rollbackRefs, input.rollbackRefs),
    evidenceRefs: mergeRefs(input.run.evidenceRefs, input.evidenceRefs),
    lastTransitionAt: input.transitionedAt,
    lastTransitionKey: replayKey,
    startedAt,
    finishedAt,
    failureReason: nextStatus === "failed" ? input.failureReason ?? null : null,
    updatedAt: input.transitionedAt,
  };
}

export function approveUpgradeRunV0(
  run: UpgradeRunV0,
  transitionedAt: string,
  transitionKey?: string | null,
): UpgradeRunV0 {
  return transitionUpgradeRunV0({ run, toStatus: "approved", transitionedAt, transitionKey });
}

export function startUpgradeBackupV0(
  run: UpgradeRunV0,
  transitionedAt: string,
  transitionKey?: string | null,
  backupRefs?: readonly string[],
): UpgradeRunV0 {
  return transitionUpgradeRunV0({
    run,
    toStatus: "backingUp",
    transitionedAt,
    transitionKey,
    backupRefs,
  });
}

export function startUpgradeExecutionV0(
  run: UpgradeRunV0,
  transitionedAt: string,
  transitionKey?: string | null,
): UpgradeRunV0 {
  const next = transitionUpgradeRunV0({ run, toStatus: "running", transitionedAt, transitionKey });
  assertUpgradeExecutionReadyV0(run);
  return next;
}

export function startUpgradeValidationV0(
  run: UpgradeRunV0,
  transitionedAt: string,
  transitionKey?: string | null,
): UpgradeRunV0 {
  return transitionUpgradeRunV0({ run, toStatus: "validating", transitionedAt, transitionKey });
}

export function startUpgradeHealthCheckV0(
  run: UpgradeRunV0,
  transitionedAt: string,
  transitionKey?: string | null,
  healthRefs?: readonly string[],
): UpgradeRunV0 {
  return transitionUpgradeRunV0({
    run,
    toStatus: "healthCheck",
    transitionedAt,
    transitionKey,
    healthRefs,
  });
}

export function completeUpgradeRunV0(
  run: UpgradeRunV0,
  transitionedAt: string,
  transitionKey?: string | null,
  evidenceRefs?: readonly string[],
): UpgradeRunV0 {
  return transitionUpgradeRunV0({
    run,
    toStatus: "completed",
    transitionedAt,
    transitionKey,
    evidenceRefs,
  });
}

export function rollbackUpgradeRunV0(
  run: UpgradeRunV0,
  transitionedAt: string,
  transitionKey?: string | null,
  rollbackRefs?: readonly string[],
): UpgradeRunV0 {
  const next = transitionUpgradeRunV0({
    run,
    toStatus: "rolledBack",
    transitionedAt,
    transitionKey,
    rollbackRefs,
  });
  assertUpgradeRollbackReadyV0({
    ...run,
    rollbackRefs: mergeRefs(run.rollbackRefs, rollbackRefs),
  });
  return next;
}

export function failUpgradeRunV0(
  run: UpgradeRunV0,
  transitionedAt: string,
  failureReason: string,
  transitionKey?: string | null,
): UpgradeRunV0 {
  return transitionUpgradeRunV0({
    run,
    toStatus: "failed",
    transitionedAt,
    transitionKey,
    failureReason,
  });
}

function parseKnownStatus(value: unknown, label: string): UpgradeRunStatusV0 {
  const parsed = parseUpgradeRunStatusV0(value);
  if (parsed === null) {
    throw new Error(`${label} must be a string`);
  }

  if (!ALLOWED_TRANSITIONS_V0[parsed as UpgradeRunStatusV0]) {
    throw new Error(`${label} must be one of: planned, approved, backingUp, running, validating, healthCheck, completed, rolledBack, failed`);
  }

  return parsed as UpgradeRunStatusV0;
}

function mergeRefs(existing: readonly string[], additional?: readonly string[]): string[] {
  return [...new Set([...(existing ?? []), ...(additional ?? [])])];
}
