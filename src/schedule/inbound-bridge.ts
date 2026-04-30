import type { GovernanceStore } from "../governance/governance-store.js";
import { linkInboundWorkItem } from "../integration/inbound-claim.js";
import type { IntegrationStore } from "../integration/integration-store.js";
import { dispatchScheduleFire } from "./dispatcher.js";
import type { ScheduleCompatibilitySeamsV0 } from "./evaluator.js";
import type { ScheduleStore, ScheduleFireRecordV0 } from "./schedule-store.js";

export interface ManualFireSeedV0 {
  workspaceId: string;
  scheduleId: string;
  triggerId: string;
  fireRecordId: string;
  sourceRecordRefs: string[];
  auditHistory: string[];
}

export async function bridgeInboundToManualScheduleFire(input: {
  integrationStore: IntegrationStore;
  governanceStore: GovernanceStore;
  scheduleStore: ScheduleStore;
  inboundWorkItemId: string;
  scheduleId: string;
  bridgedAt: string;
  actorId: string;
  triggerId?: string;
  idGen?: () => string;
  dataDir?: string;
  compatibility?: ScheduleCompatibilitySeamsV0;
}): Promise<{ fireRecord: ScheduleFireRecordV0; manualFireSeed: ManualFireSeedV0 }> {
  const inbound = await input.integrationStore.get("inbound_work_item", input.inboundWorkItemId);
  if (inbound === null) {
    throw new Error(`inbound work item not found: ${input.inboundWorkItemId}`);
  }

  if (!["accepted", "claimed", "document_seed_deferred"].includes(inbound.status)) {
    throw new Error("accepted inbound item required");
  }

  let schedule = await input.scheduleStore.get("schedule", input.scheduleId);
  if (schedule === null) {
    const governanceSchedule = await input.governanceStore.get("schedule", input.scheduleId);
    if (governanceSchedule !== null) {
      schedule = await input.scheduleStore.put("schedule", governanceSchedule);
    }
  }

  if (schedule === null) {
    throw new Error(`schedule not found: ${input.scheduleId}`);
  }

  if (schedule.workspaceId !== inbound.workspaceId) {
    throw new Error("workspace mismatch");
  }

  const triggerId = input.triggerId ?? `manual:${inbound.id}`;
  const dispatched = await dispatchScheduleFire({
    store: input.scheduleStore,
    dataDir: input.dataDir,
    scheduleId: schedule.id,
    triggerId,
    triggerKind: "manual",
    expectedAt: input.bridgedAt,
    decidedAt: input.bridgedAt,
    actorId: input.actorId,
    sourceCommand: "schedule.bridgeInboundToManualScheduleFire",
    sourceRef: `inbound_work_item:${inbound.id}`,
    compatibility: input.compatibility,
  });
  const linked = await linkInboundWorkItem({
    store: input.integrationStore,
    inboundWorkItemId: inbound.id,
    actorId: input.actorId,
    linkedAt: input.bridgedAt,
    relatedRecordRef: `fire_record:${dispatched.fireRecord.id}`,
    status: inbound.status === "document_seed_deferred" ? "document_seed_deferred" : "seeded",
    processedAt: input.bridgedAt,
  });
  const bridged = await linkInboundWorkItem({
    store: input.integrationStore,
    inboundWorkItemId: linked.id,
    actorId: input.actorId,
    linkedAt: input.bridgedAt,
    relatedRecordRef: `schedule:${schedule.id}`,
    status: linked.status,
    processedAt: linked.processedAt,
  });

  return {
    fireRecord: dispatched.fireRecord,
    manualFireSeed: {
      workspaceId: inbound.workspaceId,
      scheduleId: schedule.id,
      triggerId,
      fireRecordId: dispatched.fireRecord.id,
      sourceRecordRefs: [
        `inbound_work_item:${inbound.id}`,
        `work_source:${inbound.workSourceRef.recordId}`,
        `binding:${inbound.bindingRef.recordId}`,
        `provider_item:${inbound.providerItemRef.externalId}`,
      ],
      auditHistory: [...bridged.relatedRecordRefs],
    },
  };
}
