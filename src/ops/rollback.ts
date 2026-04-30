import type { RollbackPlaybookV0, UpgradeRunV0 } from "../contracts/ops.js";
import type { UpgradeStore } from "./upgrade-store.js";
import { transitionUpgradeRunV0 } from "./upgrade-lifecycle.js";
import {
  createUpgradeLocalEventV0,
  toRollbackPlaybookRefV0,
  toUpgradeRunRefV0,
  type UpgradeLocalEventV0,
} from "./upgrade-events.js";

export interface RecordManualRollbackInputV0 {
  store: UpgradeStore;
  run: UpgradeRunV0;
  playbook: RollbackPlaybookV0;
  occurredAt: string;
  actorId: string;
  status: "invoked" | "completed" | "failed";
  transitionKey?: string | null;
  reason?: string | null;
  evidenceRefs?: readonly string[];
}

export interface RecordManualRollbackResultV0 {
  run: UpgradeRunV0;
  event: UpgradeLocalEventV0;
}

export async function recordManualRollbackV0(input: RecordManualRollbackInputV0): Promise<RecordManualRollbackResultV0> {
  const rollbackRefs = uniqueStrings([
    ...input.run.rollbackRefs,
    ...input.playbook.rollbackRefs,
  ]);
  const evidenceRefs = uniqueStrings([
    ...input.run.evidenceRefs,
    ...input.playbook.evidenceRefs,
    ...(input.evidenceRefs ?? []),
  ]);

  const run = input.status === "completed"
    ? transitionUpgradeRunV0({
      run: input.run,
      toStatus: "rolledBack",
      transitionedAt: input.occurredAt,
      transitionKey: input.transitionKey,
      rollbackRefs,
      evidenceRefs,
    })
    : {
      ...input.run,
      rollbackRefs,
      evidenceRefs,
      updatedAt: input.occurredAt,
    };
  await input.store.put(run);

  const event = createUpgradeLocalEventV0({
    eventType: "rollback_recorded",
    workspaceId: run.workspaceId,
    planId: run.planId,
    upgradeRunId: run.id,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    subjectRef: toUpgradeRunRefV0(run),
    objectRef: toRollbackPlaybookRefV0(input.playbook),
    evidenceRefs,
    details: {
      status: input.status,
      reason: input.reason ?? null,
    },
  });
  await input.store.appendEvent(event);

  return { run, event };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
