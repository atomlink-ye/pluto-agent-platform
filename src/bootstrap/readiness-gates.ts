import type { PrincipalRefV0, SecretRefV0 } from "../contracts/index.js";
import type {
  ProviderProfileV0,
  RuntimeRequirementsV0,
} from "../contracts/types.js";
import type { BootstrapFailureV0 } from "./contracts.js";
import {
  selectEligibleRuntime,
  type RuntimeRegistry,
  type RuntimeSelectionFailureV0,
  type RuntimeSelectionSuccessV0,
} from "../runtime/index.js";

export interface LocalReadinessStatusV0 {
  storageVersion: "local-v0" | (string & {});
  state: "ready" | "blocked" | (string & {});
  reason?: string;
  checkedAt?: string;
}

export interface BootstrapReadinessInputV0 {
  workspaceId: string;
  sessionId: string;
  stepId?: string | null;
  actorRefs?: PrincipalRefV0[];
  runtimeRegistry?: RuntimeRegistry;
  runtimeRequirements?: RuntimeRequirementsV0;
  providerProfileId?: string;
  env?: Record<string, string | undefined>;
  secretRefs?: SecretRefV0[];
  budget?: LocalReadinessStatusV0;
  policy?: LocalReadinessStatusV0;
  now?: string;
  failureId?: string;
}

export interface BootstrapReadinessSuccessV0 {
  ok: true;
  runtimeSelection: RuntimeSelectionSuccessV0 | null;
  providerProfile: ProviderProfileV0 | null;
  requiredEnvNames: string[];
  requiredSecretNames: string[];
}

export interface BootstrapReadinessFailureV0 {
  ok: false;
  failure: BootstrapFailureV0;
  runtimeSelection?: RuntimeSelectionFailureV0;
  nextAction: string;
}

type BootstrapReadinessBlockingReasonV0 =
  | "runtime_unavailable"
  | "capability_unsupported"
  | "secret_ref_missing"
  | "policy_blocked"
  | "budget_blocked";

export type BootstrapReadinessResultV0 =
  | BootstrapReadinessSuccessV0
  | BootstrapReadinessFailureV0;

export function evaluateBootstrapReadinessV0(
  input: BootstrapReadinessInputV0,
): BootstrapReadinessResultV0 {
  const now = input.now ?? new Date().toISOString();

  const policyStatus = evaluateLocalFixtureStatus(
    input.policy,
    "policy",
    "policy_blocked",
    input,
    now,
  );
  if (policyStatus) {
    return policyStatus;
  }

  const budgetStatus = evaluateLocalFixtureStatus(
    input.budget,
    "budget",
    "budget_blocked",
    input,
    now,
  );
  if (budgetStatus) {
    return budgetStatus;
  }

  const providerProfile = input.providerProfileId && input.runtimeRegistry
    ? input.runtimeRegistry.getProviderProfile(input.providerProfileId)?.profile ?? null
    : null;

  const runtimeSelection = selectRuntime(input);
  if (runtimeSelection && !runtimeSelection.ok) {
    return failureFromRuntimeSelection(input, runtimeSelection, now);
  }

  const requiredEnvNames = uniq(providerProfile?.envRefs?.required ?? []);
  const requiredSecretNames = uniq(providerProfile?.secretRefs?.required ?? []);
  const presentSecretNames = new Set((input.secretRefs ?? []).map((entry) => entry.name));
  const env = input.env ?? process.env;

  const missingEnvNames = requiredEnvNames.filter((name) => !hasNonEmptyValue(env[name]));
  const missingSecretNames = requiredSecretNames.filter((name) => !presentSecretNames.has(name));

  if (missingEnvNames.length > 0 || missingSecretNames.length > 0) {
    const missing = [
      ...missingSecretNames.map((name) => `secret ref ${name}`),
      ...missingEnvNames.map((name) => `env ${name}`),
    ].join(", ");
    const nextAction = buildCredentialNextAction(missingSecretNames, missingEnvNames);
    return {
      ok: false,
      nextAction,
      failure: buildFailure(input, now, {
        blockingReason: "secret_ref_missing",
        resolutionHint: `${nextAction} Missing: ${missing}.`,
      }),
    };
  }

  return {
    ok: true,
    runtimeSelection: runtimeSelection?.ok ? runtimeSelection : null,
    providerProfile,
    requiredEnvNames,
    requiredSecretNames,
  };
}

function selectRuntime(
  input: BootstrapReadinessInputV0,
): RuntimeSelectionSuccessV0 | RuntimeSelectionFailureV0 | null {
  if (!input.runtimeRequirements && !input.providerProfileId) {
    return null;
  }

  if (!input.runtimeRegistry) {
    return {
      ok: false,
      blocker: {
        reason: "provider_unavailable",
        classifierVersion: 0,
        message: "runtime_selector_unconfigured",
        providerProfileId: input.providerProfileId,
      },
    };
  }

  return selectEligibleRuntime(input.runtimeRegistry, {
    requirements: input.runtimeRequirements,
    providerProfileId: input.providerProfileId,
  });
}

function failureFromRuntimeSelection(
  input: BootstrapReadinessInputV0,
  selection: RuntimeSelectionFailureV0,
  now: string,
): BootstrapReadinessFailureV0 {
  const mapped = mapRuntimeBlocker(selection.blocker.message);
  return {
    ok: false,
    runtimeSelection: selection,
    nextAction: mapped.nextAction,
    failure: buildFailure(input, now, {
      blockingReason: mapped.reason,
      resolutionHint: `${mapped.nextAction} ${selection.blocker.message}`,
    }),
  };
}

function evaluateLocalFixtureStatus(
  status: LocalReadinessStatusV0 | undefined,
  label: "budget" | "policy",
  blockingReason: "budget_blocked" | "policy_blocked",
  input: BootstrapReadinessInputV0,
  now: string,
): BootstrapReadinessFailureV0 | null {
  const nextAction = `Update the local-v0 ${label} readiness fixture to a checked ready state before dispatch.`;
  if (!status) {
    return {
      ok: false,
      nextAction,
      failure: buildFailure(input, now, {
        blockingReason,
        resolutionHint: `${nextAction} Missing ${label} status.`,
      }),
    };
  }

  if (status.storageVersion !== "local-v0") {
    return {
      ok: false,
      nextAction,
      failure: buildFailure(input, now, {
        blockingReason,
        resolutionHint: `${nextAction} Unsupported ${label} fixture source: ${status.storageVersion}.`,
      }),
    };
  }

  if (status.state !== "ready") {
    return {
      ok: false,
      nextAction,
      failure: buildFailure(input, now, {
        blockingReason,
        resolutionHint: `${nextAction}${status.reason ? ` ${status.reason}` : ""}`,
      }),
    };
  }

  return null;
}

function mapRuntimeBlocker(message: string): {
  reason: BootstrapReadinessBlockingReasonV0;
  nextAction: string;
} {
  if (message.startsWith("runtime_selector_adapter_unreachable:") || message === "runtime_selector_unconfigured") {
    return {
      reason: "runtime_unavailable",
      nextAction: "Restore runtime connectivity or register a healthy adapter before dispatch.",
    };
  }

  if (message.startsWith("runtime_selector_no_match:") || message.startsWith("runtime_selector_unknown_profile:")) {
    return {
      reason: "capability_unsupported",
      nextAction: "Choose a runtime/profile whose capabilities satisfy the required selection before dispatch.",
    };
  }

  if (message.startsWith("runtime_selector_profile_disabled:")) {
    return {
      reason: "runtime_unavailable",
      nextAction: "Enable the selected provider profile or pick a healthy alternative before dispatch.",
    };
  }

  return {
    reason: "runtime_unavailable",
    nextAction: "Restore runtime readiness before dispatch.",
  };
}

function buildCredentialNextAction(missingSecretNames: string[], missingEnvNames: string[]): string {
  const actions: string[] = [];
  if (missingSecretNames.length > 0) {
    actions.push(`Create local-v0 SecretRef records for ${missingSecretNames.join(", ")}`);
  }
  if (missingEnvNames.length > 0) {
    actions.push(`Set env names ${missingEnvNames.join(", ")}`);
  }
  return `${actions.join(" and ")} before dispatch.`;
}

function buildFailure(
  input: BootstrapReadinessInputV0,
  now: string,
  values: { blockingReason: BootstrapReadinessBlockingReasonV0; resolutionHint: string },
): BootstrapFailureV0 {
  return {
    schema: "pluto.bootstrap.failure",
    schemaVersion: 0,
    id: input.failureId ?? `${input.sessionId}:readiness:${values.blockingReason}`,
    sessionId: input.sessionId,
    stepId: input.stepId ?? null,
    workspaceRef: {
      workspaceId: input.workspaceId,
      kind: "workspace",
      id: input.workspaceId,
    },
    actorRefs: input.actorRefs ?? [],
    status: "active",
    blockingReason: values.blockingReason,
    resolutionHint: values.resolutionHint,
    createdObjectRefs: [],
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };
}

function hasNonEmptyValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}
