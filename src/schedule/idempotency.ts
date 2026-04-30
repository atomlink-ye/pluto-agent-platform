import { createHash } from "node:crypto";

import type { MissedRunRecordV0, ScheduleFireRecordV0, ScheduleStore } from "./schedule-store.js";

export interface ScheduleFireKeyInputV0 {
  scheduleId: string;
  triggerId: string | null;
  triggerKind: string;
  expectedAt: string;
}

export interface ExistingScheduleDecisionV0 {
  fireRecord: ScheduleFireRecordV0;
  missedRun: MissedRunRecordV0 | null;
}

export function deriveScheduleFireKey(input: ScheduleFireKeyInputV0): string {
  const raw = JSON.stringify({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    triggerKind: input.triggerKind,
    expectedAt: input.expectedAt,
  });
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 24);
  return `schedule-fire-${digest}`;
}

export function deriveMissedRunId(fireKey: string): string {
  return `${fireKey}:missed`;
}

export async function findExistingScheduleDecision(
  store: ScheduleStore,
  fireKey: string,
): Promise<ExistingScheduleDecisionV0 | null> {
  const fireRecord = await store.get("fire_record", fireKey);
  if (fireRecord === null) {
    return null;
  }

  return {
    fireRecord,
    missedRun: await store.get("missed_run", deriveMissedRunId(fireKey)),
  };
}
