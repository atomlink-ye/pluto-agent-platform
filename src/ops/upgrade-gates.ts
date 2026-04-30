import type {
  BackupManifestV0,
  HealthSignalV0,
  RollbackPlaybookV0,
  RuntimePairingStateV0,
  UpgradeGateKeyV0,
  UpgradeGateStatusV0,
  UpgradeGateV0,
  UpgradePlanV0,
  UpgradeRunV0,
} from "../contracts/ops.js";
import { normalizeRuntimePairingStatusV0 } from "../contracts/ops.js";
import { completeUpgradeRunV0, transitionUpgradeRunV0 } from "./upgrade-lifecycle.js";
import {
  createUpgradeLocalEventV0,
  toBackupManifestRefV0,
  toHealthSignalRefV0,
  toUpgradePlanRefV0,
  toUpgradeRunRefV0,
  type UpgradeLocalEventV0,
} from "./upgrade-events.js";

export interface EvaluateUpgradeGatesInputV0 {
  plan: UpgradePlanV0;
  run: UpgradeRunV0;
  backupManifestRefs?: readonly string[];
  healthSignals?: readonly HealthSignalV0[];
  rollbackPlaybooks?: readonly RollbackPlaybookV0[];
  runtimePairingStates?: readonly RuntimePairingStateV0[];
  checkedAt: string;
}

export interface AssertUpgradeExecutableInputV0 {
  plan: UpgradePlanV0;
  backupManifest: BackupManifestV0 | null;
  occurredAt: string;
  actorId: string;
}

export interface AssertUpgradeExecutableResultV0 {
  backupManifest: BackupManifestV0;
  events: [UpgradeLocalEventV0, UpgradeLocalEventV0, UpgradeLocalEventV0];
}

export interface AssertHealthCompletionInputV0 {
  run: UpgradeRunV0;
  healthSignals: readonly HealthSignalV0[];
  occurredAt: string;
  actorId: string;
  transitionKey?: string | null;
  observationTimedOut?: boolean;
  evidenceRefs?: readonly string[];
}

export interface AssertHealthCompletionResultV0 {
  run: UpgradeRunV0;
  outcome: "completed" | "failed";
  events: [UpgradeLocalEventV0, UpgradeLocalEventV0];
}

const REQUIRED_GATE_KEYS_V0: readonly UpgradeGateKeyV0[] = [
  "approval",
  "backup",
  "runtime_pairing",
  "health_check",
  "rollback_readiness",
];

export function evaluateUpgradeGatesV0(input: EvaluateUpgradeGatesInputV0): UpgradeGateV0[] {
  const healthSignals = (input.healthSignals ?? []).filter((signal) => signal.upgradeRunId === input.run.id);
  const rollbackPlaybooks = (input.rollbackPlaybooks ?? []).filter((playbook) => playbook.upgradeRunId === input.run.id);
  const runtimePairings = (input.runtimePairingStates ?? []).filter((pairing) => pairing.upgradeRunId === input.run.id);
  const backupRefs = [...new Set([...(input.backupManifestRefs ?? []), ...input.run.backupRefs])];
  const hasRuntimePairing = runtimePairings.some((pairing) => {
    const normalized = normalizeRuntimePairingStatusV0(pairing.status);
    return normalized === "paired" || normalized === "succeeded";
  });
  const hasHealthySignal = healthSignals.some((signal) => signal.status === "healthy");
  const hasRollbackReadiness = input.run.rollbackRefs.length > 0 || rollbackPlaybooks.length > 0;

  const definitions: Array<{ key: UpgradeGateKeyV0; status: UpgradeGateStatusV0; summary: string }> = [
    {
      key: "approval",
      status: input.run.approvalRefs.length > 0 ? "passed" : "blocked",
      summary: input.run.approvalRefs.length > 0
        ? "upgrade run has approval evidence"
        : "upgrade run is missing approval evidence",
    },
    {
      key: "backup",
      status: backupRefs.length > 0 ? "passed" : "blocked",
      summary: backupRefs.length > 0
        ? "upgrade run has backup coverage"
        : "upgrade run is missing backup coverage",
    },
    {
      key: "runtime_pairing",
      status: hasRuntimePairing ? "passed" : "blocked",
      summary: hasRuntimePairing
        ? "runtime pairing completed for the upgrade run"
        : "runtime pairing has not completed for the upgrade run",
    },
    {
      key: "health_check",
      status: hasHealthySignal ? "passed" : "blocked",
      summary: hasHealthySignal
        ? "upgrade run has a healthy post-upgrade signal"
        : "upgrade run is missing a healthy post-upgrade signal",
    },
    {
      key: "rollback_readiness",
      status: hasRollbackReadiness ? "passed" : "blocked",
      summary: hasRollbackReadiness
        ? "rollback readiness evidence is available"
        : "rollback readiness evidence is missing",
    },
  ];

  return definitions.map((definition) => ({
    schema: "pluto.ops.upgrade-gate",
    schemaVersion: 0,
    id: `${input.run.id}:${definition.key}`,
    workspaceId: input.run.workspaceId,
    planId: input.plan.id,
    upgradeRunId: input.run.id,
    sourceRuntimeVersion: input.run.sourceRuntimeVersion,
    targetRuntimeVersion: input.run.targetRuntimeVersion,
    gateKey: definition.key,
    status: definition.status,
    summary: definition.summary,
    approvalRefs: input.run.approvalRefs,
    backupRefs,
    healthRefs: [...new Set(healthSignals.flatMap((signal) => signal.healthRefs))],
    rollbackRefs: [...new Set([...input.run.rollbackRefs, ...rollbackPlaybooks.flatMap((playbook) => playbook.rollbackRefs)])],
    evidenceRefs: [...new Set([
      ...input.run.evidenceRefs,
      ...backupRefs,
      ...healthSignals.flatMap((signal) => signal.evidenceRefs),
      ...rollbackPlaybooks.flatMap((playbook) => playbook.evidenceRefs),
      ...runtimePairings.flatMap((pairing) => pairing.evidenceRefs),
    ])],
    checkedAt: input.checkedAt,
  }));
}

export function assertUpgradeCompletionGatesV0(gates: readonly UpgradeGateV0[]): void {
  const byKey = new Map(gates.map((gate) => [gate.gateKey, gate]));
  const blocked = REQUIRED_GATE_KEYS_V0
    .map((key) => byKey.get(key))
    .filter((gate): gate is UpgradeGateV0 => gate !== undefined && gate.status !== "passed");

  if (blocked.length > 0) {
    throw new Error(`Upgrade gates blocked completion: ${blocked.map((gate) => `${gate.gateKey}:${gate.status}`).join(", ")}`);
  }
}

export function assertUpgradeExecutionReadyV0(run: UpgradeRunV0): void {
  if (run.approvalRefs.length === 0) {
    throw new Error("Upgrade execution requires at least one approval ref");
  }

  if (run.rollbackRefs.length === 0) {
    throw new Error("Upgrade execution requires at least one rollback ref");
  }
}

export function assertUpgradeRollbackReadyV0(run: UpgradeRunV0): void {
  if (run.rollbackRefs.length === 0) {
    throw new Error("Upgrade rollback requires at least one rollback ref");
  }
}

export function assertUpgradeExecutableV0(input: AssertUpgradeExecutableInputV0): AssertUpgradeExecutableResultV0 {
  if (input.plan.approvalRefs.length === 0) {
    throw new Error(`Upgrade plan ${input.plan.id} is missing approval refs`);
  }

  if (input.plan.backupRefs.length === 0) {
    throw new Error(`Upgrade plan ${input.plan.id} is missing required backup refs`);
  }

  if (input.backupManifest === null) {
    throw new Error(`Upgrade plan ${input.plan.id} is missing a verified backup manifest`);
  }

  if (input.backupManifest.planId !== input.plan.id) {
    throw new Error(`Backup manifest ${input.backupManifest.id} does not belong to plan ${input.plan.id}`);
  }

  if (!input.plan.backupRefs.includes(input.backupManifest.manifestRef) || input.backupManifest.evidenceRefs.length === 0) {
    throw new Error(`Backup manifest ${input.backupManifest.id} is not verified for plan ${input.plan.id}`);
  }

  return {
    backupManifest: input.backupManifest,
    events: [
      createUpgradeLocalEventV0({
        eventType: "approval_recorded",
        workspaceId: input.plan.workspaceId,
        planId: input.plan.id,
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        subjectRef: toUpgradePlanRefV0(input.plan),
        objectRef: toUpgradePlanRefV0(input.plan),
        evidenceRefs: input.plan.approvalRefs,
        details: {
          approvalRefCount: String(input.plan.approvalRefs.length),
        },
      }),
      createUpgradeLocalEventV0({
        eventType: "backup_verification_recorded",
        workspaceId: input.plan.workspaceId,
        planId: input.plan.id,
        upgradeRunId: input.backupManifest.upgradeRunId,
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        subjectRef: toUpgradePlanRefV0(input.plan),
        objectRef: toBackupManifestRefV0(input.backupManifest),
        evidenceRefs: input.backupManifest.evidenceRefs,
        details: {
          manifestRef: input.backupManifest.manifestRef,
        },
      }),
      createUpgradeLocalEventV0({
        eventType: "decision_recorded",
        workspaceId: input.plan.workspaceId,
        planId: input.plan.id,
        upgradeRunId: input.backupManifest.upgradeRunId,
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        subjectRef: toUpgradePlanRefV0(input.plan),
        objectRef: toBackupManifestRefV0(input.backupManifest),
        evidenceRefs: [...input.plan.approvalRefs, ...input.backupManifest.evidenceRefs],
        details: {
          decision: "executable",
          manifestRef: input.backupManifest.manifestRef,
        },
      }),
    ],
  };
}

export function assertHealthCompletionV0(input: AssertHealthCompletionInputV0): AssertHealthCompletionResultV0 {
  const healthRefs = uniqueStrings([
    ...input.run.healthRefs,
    ...input.healthSignals.flatMap((signal) => signal.healthRefs),
  ]);
  const evidenceRefs = uniqueStrings([
    ...(input.evidenceRefs ?? []),
    ...input.healthSignals.flatMap((signal) => signal.evidenceRefs),
  ]);
  const primarySignal = input.healthSignals[0] ?? null;
  const validationEvent = createUpgradeLocalEventV0({
    eventType: "health_validation_recorded",
    workspaceId: input.run.workspaceId,
    planId: input.run.planId,
    upgradeRunId: input.run.id,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    subjectRef: toUpgradeRunRefV0(input.run),
    objectRef: primarySignal === null ? toUpgradeRunRefV0(input.run) : toHealthSignalRefV0(primarySignal),
    evidenceRefs,
    details: {
      observationTimedOut: input.observationTimedOut ? "true" : "false",
      signalCount: String(input.healthSignals.length),
    },
  });

  if (input.observationTimedOut) {
    const run = transitionUpgradeRunV0({
      run: input.run,
      toStatus: "failed",
      transitionedAt: input.occurredAt,
      transitionKey: input.transitionKey,
      failureReason: "Health observation timed out",
      healthRefs,
      evidenceRefs,
    });
    return {
      run,
      outcome: "failed",
      events: [
        validationEvent,
        createUpgradeLocalEventV0({
          eventType: "failure_recorded",
          workspaceId: run.workspaceId,
          planId: run.planId,
          upgradeRunId: run.id,
          occurredAt: input.occurredAt,
          actorId: input.actorId,
          subjectRef: toUpgradeRunRefV0(run),
          objectRef: toUpgradeRunRefV0(run),
          evidenceRefs,
          details: {
            reason: run.failureReason,
          },
        }),
      ],
    };
  }

  const degradedSignal = input.healthSignals.find((signal) => signal.status !== "healthy") ?? null;
  if (degradedSignal !== null) {
    const run = transitionUpgradeRunV0({
      run: input.run,
      toStatus: "failed",
      transitionedAt: input.occurredAt,
      transitionKey: input.transitionKey,
      failureReason: `Health validation failed: ${degradedSignal.signalKey} is ${degradedSignal.status}`,
      healthRefs,
      evidenceRefs,
    });
    return {
      run,
      outcome: "failed",
      events: [
        validationEvent,
        createUpgradeLocalEventV0({
          eventType: "failure_recorded",
          workspaceId: run.workspaceId,
          planId: run.planId,
          upgradeRunId: run.id,
          occurredAt: input.occurredAt,
          actorId: input.actorId,
          subjectRef: toUpgradeRunRefV0(run),
          objectRef: toHealthSignalRefV0(degradedSignal),
          evidenceRefs,
          details: {
            reason: run.failureReason,
            healthStatus: degradedSignal.status,
          },
        }),
      ],
    };
  }

  const run = completeUpgradeRunV0(input.run, input.occurredAt, input.transitionKey, evidenceRefs);
  return {
    run,
    outcome: "completed",
    events: [
      validationEvent,
      createUpgradeLocalEventV0({
        eventType: "completion_recorded",
        workspaceId: run.workspaceId,
        planId: run.planId,
        upgradeRunId: run.id,
        occurredAt: input.occurredAt,
        actorId: input.actorId,
        subjectRef: toUpgradeRunRefV0(run),
        objectRef: toUpgradeRunRefV0(run),
        evidenceRefs,
        details: {
          outcome: "completed",
        },
      }),
    ],
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
