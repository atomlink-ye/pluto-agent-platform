import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type {
  MembershipBindingV0,
  PrincipalRefV0,
  WorkspaceRecordV0,
  WorkspaceScopedRefV0,
} from "@/contracts/identity.js";
import type {
  OutboundTargetRecordV0,
  WebhookSubscriptionRecordV0,
  WorkSourceBindingRecordV0,
  WorkSourceRecordV0,
} from "@/contracts/integration.js";
import { toIntegrationRecordRefV0 } from "@/contracts/integration.js";
import type { ScopedToolPermitV0 } from "@/contracts/security.js";
import type { MetadataRecordV0 } from "@/contracts/storage.js";
import type { RuntimeCapabilityDescriptorV0, RuntimeRequirementsV0 } from "@/contracts/types.js";
import { toStorageStatusV0 } from "@/contracts/storage.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import { IntegrationStore } from "@/integration/integration-store.js";
import { adaptSyntheticInboundWorkItem } from "@/integration/work-source-adapter.js";
import { normalizeSyntheticInboundWorkItem } from "@/integration/inbound-normalizer.js";
import { executeOutboundWrite, prepareOutboundWrite } from "@/integration/outbound-writes.js";
import { prepareWebhookDelivery, recordWebhookAttempt } from "@/integration/webhook-delivery.js";
import { listOutboundInspection, showInboundInspection, showWebhookInspection } from "@/integration/projections.js";
import { bridgeInboundToManualScheduleFire } from "@/schedule/inbound-bridge.js";
import { projectScheduleHistory } from "@/schedule/projections.js";
import type { ScheduleRecordV0 } from "@/schedule/schedule-store.js";
import { ScheduleStore } from "@/schedule/schedule-store.js";

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-schedule-integration-e2e-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("local schedule/integration path", () => {
  it("projects synthetic inbound to manual fire, fake run linkage, outbound write, and webhook attempt", async () => {
    const governanceStore = new GovernanceStore({ dataDir });
    const integrationStore = new IntegrationStore({ dataDir });
    const scheduleStore = new ScheduleStore({ dataDir });
    const runStore = new RunStore({ dataDir });

    const workSource = makeWorkSource();
    const binding = makeBinding(workSource);
    const schedule = makeSchedule();
    const outboundTarget = makeOutboundTarget();
    const webhookSubscription = makeWebhookSubscription();

    await integrationStore.put("work_source", workSource);
    await integrationStore.put("work_source_binding", binding);
    await integrationStore.put("outbound_target", outboundTarget);
    await integrationStore.put("webhook_subscription", webhookSubscription);
    await governanceStore.put("schedule", {
      schemaVersion: 0,
      kind: "schedule",
      id: schedule.id,
      workspaceId: schedule.workspaceId,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      status: schedule.status,
      playbookId: schedule.playbookId,
      scenarioId: schedule.scenarioId,
      ownerId: schedule.ownerId,
      cadence: schedule.cadence,
    });
    await scheduleStore.put("schedule", schedule);
    await scheduleStore.put("subscription", {
      schema: "pluto.schedule.subscription",
      schemaVersion: 0,
      kind: "subscription",
      id: "subscription-e2e-alpha",
      workspaceId: schedule.workspaceId,
      scheduleRef: schedule.id,
      triggerRef: "manual:inbound-e2e-alpha",
      eventRef: "run_queue:local-schedule-integration",
      deliveryRef: null,
      filterRef: null,
      scheduleId: schedule.id,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      status: "active",
      subscriberKind: "run_queue",
      subscriberId: "local-schedule-integration",
    });

    const adapted = await adaptSyntheticInboundWorkItem({
      store: integrationStore,
      envelope: {
        schema: "pluto.integration.synthetic-inbound",
        schemaVersion: 0,
        workspaceId: schedule.workspaceId,
        providerKind: workSource.providerKind,
        bindingId: binding.id,
        receivedAt: "2026-04-30T09:00:00.000Z",
        headers: { "x-local-signature": "sig-123" },
        security: {
          credentialRef: "secret_ref:local-webhook",
          signatureHeader: "x-local-signature",
          expectedSignature: "sig-123",
        },
        item: {
          externalId: "provider-item-1",
          resourceType: "ticket",
          title: "Inbound change request",
          sourceUrl: "file://local/provider-item-1.json",
          workspaceId: schedule.workspaceId,
          documentSeed: null,
        },
        payload: {
          title: "Inbound change request",
          details: "local projection test",
          redacted_field: "present",
        },
      },
    });
    const inbound = await normalizeSyntheticInboundWorkItem({
      store: integrationStore,
      adapted,
      idGen: () => "inbound-e2e-alpha",
    });

    const bridged = await bridgeInboundToManualScheduleFire({
      integrationStore,
      governanceStore,
      scheduleStore,
      inboundWorkItemId: inbound.id,
      scheduleId: schedule.id,
      bridgedAt: "2026-04-30T09:05:00.000Z",
      actorId: "user_01",
      triggerId: "manual:inbound-e2e-alpha",
      compatibility: {
        runtimeCapabilityAvailable: true,
        approvalSatisfied: true,
        policyAllowed: true,
        budgetAllowed: true,
        outboundWritesAllowed: true,
      },
    });

    let seq = 0;
    const nextId = () => `run-seq-${String(seq++).padStart(4, "0")}`;
    const adapter = new FakeAdapter({
      team: DEFAULT_TEAM,
      idGen: nextId,
      clock: () => new Date("2026-04-30T09:06:00.000Z"),
    });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store: runStore,
      idGen: nextId,
      clock: () => new Date("2026-04-30T09:06:00.000Z"),
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });
    const runResult = await service.run({
      id: "local-schedule-integration",
      title: "Local schedule integration",
      prompt: "Summarize inbound work for local schedule integration testing",
      workspacePath: workDir,
      minWorkers: 2,
    });

    await scheduleStore.update("fire_record", bridged.fireRecord.id, {
      runId: runResult.runId,
      status: "succeeded",
      updatedAt: "2026-04-30T09:07:00.000Z",
    });

    const governance = buildGovernanceContext(schedule.workspaceId);
    const preparedWrite = await prepareOutboundWrite({
      store: integrationStore,
      connector: {
        kind: "fake-local",
        async executeWrite() {
          return {
            providerWriteRef: "provider-write-e2e",
            responseSummary: "stored locally",
            completedAt: "2026-04-30T09:08:00.000Z",
          };
        },
      },
      governance,
      outboundTarget,
      writeId: "write-e2e-alpha",
      sourceRecordRefs: [
        `schedule:${schedule.id}`,
        `fire_record:${bridged.fireRecord.id}`,
        `run:${runResult.runId}`,
        ...bridged.manualFireSeed.sourceRecordRefs,
      ],
      payloadBody: JSON.stringify({ runId: runResult.runId, inboundId: inbound.id }),
      payloadContentType: "application/json",
      operation: "sync_document",
      idempotencyKey: "idempotency-write-e2e-alpha",
      policy: { allowed: true, summary: "local allowed", policyRef: null },
      budget: { allowed: true, summary: "local budget", budgetRef: null },
      signingSecret: {
        ref: {
          workspaceId: schedule.workspaceId,
          name: "local-signing-key",
          ref: "secret://local-signing-key",
          displayLabel: "Local signing key",
        },
        keyMaterial: "local-secret-signing-value",
      },
    });
    expect(preparedWrite.record.status).toBe("prepared");

    const executedWrite = await executeOutboundWrite({
      store: integrationStore,
      connector: {
        kind: "fake-local",
        async executeWrite() {
          return {
            providerWriteRef: "provider-write-e2e",
            responseSummary: "stored locally",
            completedAt: "2026-04-30T09:08:00.000Z",
          };
        },
      },
      writeId: preparedWrite.record.id,
      payloadBody: JSON.stringify({ runId: runResult.runId, inboundId: inbound.id }),
      now: "2026-04-30T09:08:00.000Z",
    });
    expect(executedWrite.executed).toBe(true);

    const preparedWebhook = await prepareWebhookDelivery({
      store: integrationStore,
      governance,
      subscription: webhookSubscription,
      eventRef: {
        providerKind: webhookSubscription.providerKind,
        resourceType: "run_event",
        externalId: runResult.runId,
        summary: "Run completed",
      },
      attemptId: "webhook-attempt-e2e-alpha",
      payloadBody: JSON.stringify({ runId: runResult.runId, fireRecordId: bridged.fireRecord.id }),
      payloadContentType: "application/json",
      signingSecret: {
        ref: {
          workspaceId: schedule.workspaceId,
          name: "local-signing-key",
          ref: "secret://local-signing-key",
          displayLabel: "Local signing key",
        },
        keyMaterial: "local-secret-signing-value",
      },
      policy: { allowed: true, summary: "local allowed", policyRef: null },
      budget: { allowed: true, summary: "local budget", budgetRef: null },
      maxAttempts: 3,
      pauseAfterFailures: 2,
      retryBackoffSeconds: 60,
    });
    expect(preparedWebhook.attempt.status).toBe("prepared");

    const recordedWebhook = await recordWebhookAttempt({
      store: integrationStore,
      attemptId: preparedWebhook.attempt.id,
      now: "2026-04-30T09:09:00.000Z",
      delivered: false,
      responseSummary: "local endpoint unavailable",
    });
    expect(recordedWebhook.status).toBe("retrying");

    const inboundProjection = await showInboundInspection(integrationStore, inbound.id);
    expect(inboundProjection?.relatedRecordRefs).toContain(`fire_record:${bridged.fireRecord.id}`);
    expect(inboundProjection?.relatedRecordRefs).toContain(`schedule:${schedule.id}`);

    const scheduleHistory = await projectScheduleHistory({ governanceStore, scheduleStore, scheduleId: schedule.id });
    expect(scheduleHistory?.entries[0]).toMatchObject({ historyKind: "fire_record", runId: runResult.runId });

    const outboundProjection = await listOutboundInspection(integrationStore);
    expect(outboundProjection[0]?.sourceRecordRefs).toContain(`run:${runResult.runId}`);
    expect(outboundProjection[0]?.sourceRecordRefs).toContain(`fire_record:${bridged.fireRecord.id}`);

    const webhookProjection = await showWebhookInspection(integrationStore, webhookSubscription.id);
    expect(webhookProjection?.attempts[0]).toMatchObject({
      status: "retrying",
      eventRef: { externalId: runResult.runId },
    });
  });
});

function makeWorkSource(): WorkSourceRecordV0 {
  return {
    schema: "pluto.integration.work-source",
    schemaVersion: 0,
    kind: "work_source",
    id: "work-source-e2e",
    workspaceId: "ws-local-alpha",
    providerKind: "fake-local",
    status: "active",
    summary: "Local source",
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    sourceRef: {
      providerKind: "fake-local",
      resourceType: "inbox",
      externalId: "source-1",
      summary: "Local inbox",
    },
    governanceRefs: [],
    capabilityRefs: [],
    lastObservedAt: null,
  };
}

function makeBinding(workSource: WorkSourceRecordV0): WorkSourceBindingRecordV0 {
  return {
    schema: "pluto.integration.work-source-binding",
    schemaVersion: 0,
    kind: "work_source_binding",
    id: "binding-e2e",
    workspaceId: workSource.workspaceId,
    providerKind: workSource.providerKind,
    status: "active",
    summary: "Binding to schedule",
    createdAt: workSource.createdAt,
    updatedAt: workSource.updatedAt,
    workSourceRef: toIntegrationRecordRefV0(workSource),
    targetRef: "schedule-e2e",
    filtersSummary: "all",
    governanceRefs: [],
    cursorRef: null,
    lastSynchronizedAt: null,
  };
}

function makeSchedule(): ScheduleRecordV0 {
  return {
    schema: "pluto.schedule",
    schemaVersion: 0,
    kind: "schedule",
    id: "schedule-e2e",
    workspaceId: "ws-local-alpha",
    playbookRef: "playbook:playbook-e2e",
    scenarioRef: "scenario:scenario-e2e",
    ownerRef: "user:owner-e2e",
    triggerRefs: [],
    subscriptionRefs: [],
    nextDueAt: null,
    lastTriggeredAt: null,
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    status: "active",
    playbookId: "playbook-e2e",
    scenarioId: "scenario-e2e",
    ownerId: "owner-e2e",
    cadence: "manual/local",
  };
}

function makeOutboundTarget(): OutboundTargetRecordV0 {
  return {
    schema: "pluto.integration.outbound-target",
    schemaVersion: 0,
    kind: "outbound_target",
    id: "target-e2e",
    workspaceId: "ws-local-alpha",
    providerKind: "fake-local",
    status: "active",
    summary: "Local projection sink",
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    targetRef: {
      providerKind: "fake-local",
      resourceType: "document",
      externalId: "doc-e2e",
      summary: "Local document",
    },
    governanceRefs: [],
    deliveryMode: "local_write",
    readinessRef: "local-ready",
  };
}

function makeWebhookSubscription(): WebhookSubscriptionRecordV0 {
  return {
    schema: "pluto.integration.webhook-subscription",
    schemaVersion: 0,
    kind: "webhook_subscription",
    id: "webhook-e2e",
    workspaceId: "ws-local-alpha",
    providerKind: "fake-local",
    status: "active",
    summary: "Local webhook subscription",
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    topic: "run.completed",
    endpointRef: "https://local.example.test/hooks/run-completed",
    deliveryPolicyRef: "delivery-policy-local",
    providerSubscriptionRef: null,
    verifiedAt: "2026-04-30T08:01:00.000Z",
  };
}

function buildGovernanceContext(workspaceId: string) {
  const actorRef: PrincipalRefV0 = { workspaceId, kind: "user", principalId: "user_01" };
  const principalRef: PrincipalRefV0 = { workspaceId, kind: "service_account", principalId: "sa_01" };
  const resourceRef: WorkspaceScopedRefV0 = { workspaceId, kind: "publish_package", id: "pkg_local_01" };
  const approvalRef: WorkspaceScopedRefV0 = { workspaceId, kind: "approval", id: "approval_local_01" };
  const workspace: WorkspaceRecordV0 = {
    schemaVersion: 0,
    kind: "workspace",
    id: workspaceId,
    orgId: "org_01",
    slug: "local-alpha",
    displayName: "Local Alpha",
    ownerRef: actorRef,
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    status: "active",
  };
  const binding: MembershipBindingV0 = {
    schemaVersion: 0,
    kind: "membership_binding",
    id: "binding_local_01",
    orgId: "org_01",
    workspaceId,
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    status: "active",
    principal: principalRef,
    role: "publisher",
    permissions: ["governance.publish"],
  };
  const permit: ScopedToolPermitV0 = {
    schemaVersion: 0,
    kind: "scoped_tool_permit",
    workspaceId,
    permitId: "permit_http_01",
    actionFamily: "http",
    targetSummary: { allow: ["doc-e2e", "https://local.example.test/*"], deny: [] },
    sensitivityCeiling: "restricted",
    sandboxPosture: "local_v0",
    trustBoundary: "operator_approved",
    grantedAt: "2026-04-30T08:00:00.000Z",
    expiresAt: null,
    approvalRefs: [approvalRef.id],
  };
  const runtimeCapability: RuntimeCapabilityDescriptorV0 = {
    schemaVersion: 0,
    runtimeId: "runtime_local_v0",
    adapterId: "adapter_fake",
    provider: "opencode",
    tools: { web_fetch: true },
    files: { read: true, write: true, workspaceRootOnly: true },
    locality: "local",
    posture: "workspace_write",
  };
  const runtimeRequirements: RuntimeRequirementsV0 = {
    tools: { web_fetch: true },
    files: { write: true },
  };
  const metadata: MetadataRecordV0 = {
    schemaVersion: 0,
    storageVersion: "local-v0",
    kind: "metadata",
    id: "metadata_local_01",
    workspaceId,
    objectType: "publish_package",
    status: "active",
    actorRefs: [{ actorId: actorRef.principalId, actorType: actorRef.kind }],
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    retentionClass: "durable",
    sensitivityClass: "restricted",
    summary: "Local governed metadata",
    metadata: { publishPackageId: resourceRef.id },
    checksum: { algorithm: "sha256", digest: "checksum-local-01" },
  };

  return {
    now: "2026-04-30T09:07:00.000Z",
    workspaceId,
    actorRef,
    principalRef,
    resourceRef,
    action: "governance.publish" as const,
    workspace,
    bindings: [binding],
    permit,
    permitRef: { workspaceId, kind: "permit", id: permit.permitId },
    approvalRefs: [approvalRef.id],
    approvalObjectRefs: [approvalRef],
    runtimeCapability,
    runtimeRequirements,
    storageStatus: toStorageStatusV0(metadata),
    storageEventStatus: "done",
    requestedSensitivity: "restricted",
    sandboxPosture: "local_v0",
    trustBoundary: "operator_approved",
    correlationId: "corr-local-schedule-integration",
  };
}
