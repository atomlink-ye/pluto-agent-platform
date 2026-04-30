import type { BlockerReasonV0, RuntimeRequirementsV0 } from "../contracts/types.js";
import {
  RuntimeRegistry,
  type RuntimeCandidateV0,
} from "./registry.js";
import {
  matchRuntimeCapabilities,
  mergeRuntimeRequirementsWithDiagnostics,
  profileToRequirements,
} from "./capabilities.js";

export interface RuntimeSelectorQueryV0 {
  requirements?: RuntimeRequirementsV0;
  providerProfileId?: string;
}

export interface RuntimeSelectionBlockerV0 {
  reason: BlockerReasonV0;
  message: string;
  classifierVersion: 0;
  providerProfileId?: string;
  runtimeIds?: string[];
  mismatchFields?: string[];
}

export interface RuntimeSelectionSuccessV0 {
  ok: true;
  candidate: RuntimeCandidateV0;
  effectiveRequirements?: RuntimeRequirementsV0;
}

export interface RuntimeSelectionFailureV0 {
  ok: false;
  blocker: RuntimeSelectionBlockerV0;
  effectiveRequirements?: RuntimeRequirementsV0;
}

export type RuntimeSelectionResultV0 =
  | RuntimeSelectionSuccessV0
  | RuntimeSelectionFailureV0;

export function selectEligibleRuntime(
  registry: RuntimeRegistry,
  query: RuntimeSelectorQueryV0 = {},
): RuntimeSelectionResultV0 {
  const providerProfile = query.providerProfileId
    ? registry.getProviderProfile(query.providerProfileId)
    : undefined;

  if (query.providerProfileId && !providerProfile) {
    return {
      ok: false,
      blocker: {
        reason: "capability_unavailable",
        message: `runtime_selector_unknown_profile:${query.providerProfileId}`,
        classifierVersion: 0,
        providerProfileId: query.providerProfileId,
      },
    };
  }

  const { requirements: effectiveRequirements, conflictFields } =
    mergeRuntimeRequirementsWithDiagnostics(
      providerProfile ? profileToRequirements(providerProfile.profile) : undefined,
      query.requirements,
    );

  if (providerProfile && !providerProfile.state.enabled) {
    return {
      ok: false,
      effectiveRequirements,
      blocker: {
        reason: "provider_unavailable",
        message: `runtime_selector_profile_disabled:${providerProfile.id}`,
        classifierVersion: 0,
        providerProfileId: providerProfile.id,
      },
    };
  }

  if (conflictFields.length > 0) {
    return {
      ok: false,
      effectiveRequirements,
      blocker: {
        reason: "capability_unavailable",
        message: `runtime_selector_no_match:${conflictFields.join(",")}`,
        classifierVersion: 0,
        providerProfileId: providerProfile?.id,
        runtimeIds: effectiveRequirements?.runtimeIds,
        mismatchFields: conflictFields,
      },
    };
  }

  const matchingCandidates = registry.findRuntimeCandidates({
    providerProfileId: query.providerProfileId,
    requirements: query.requirements,
    includeDisabled: true,
  });

  const eligibleCandidates = matchingCandidates
    .filter((candidate) => candidate.runtime.state.enabled)
    .filter((candidate) => candidate.adapter.state.enabled)
    .filter((candidate) => candidate.adapter.state.health !== "unhealthy")
    .sort(compareCandidates);

  if (eligibleCandidates.length > 0) {
    return {
      ok: true,
      candidate: eligibleCandidates[0]!,
      effectiveRequirements,
    };
  }

  if (matchingCandidates.length > 0) {
    const blockedByAvailability = matchingCandidates.filter(
      (candidate) =>
        !candidate.runtime.state.enabled ||
        !candidate.adapter.state.enabled ||
        candidate.adapter.state.health === "unhealthy",
    );
    if (blockedByAvailability.length > 0) {
      const runtimeIds = blockedByAvailability.map((candidate) => candidate.runtime.id);
      const adapterIds = Array.from(
        new Set(blockedByAvailability.map((candidate) => candidate.adapter.id)),
      );
      return {
        ok: false,
        effectiveRequirements,
        blocker: {
          reason: "provider_unavailable",
          message: `runtime_selector_adapter_unreachable:${adapterIds.join(",")}`,
          classifierVersion: 0,
          providerProfileId: providerProfile?.id,
          runtimeIds,
        },
      };
    }
  }

  const mismatchFields = collectMismatchFields(registry, effectiveRequirements);
  return {
    ok: false,
    effectiveRequirements,
    blocker: {
      reason: "capability_unavailable",
      message:
        mismatchFields.length > 0
          ? `runtime_selector_no_match:${mismatchFields.join(",")}`
          : "runtime_selector_no_match",
      classifierVersion: 0,
      providerProfileId: providerProfile?.id,
      runtimeIds: effectiveRequirements?.runtimeIds,
      mismatchFields,
    },
  };
}

function compareCandidates(left: RuntimeCandidateV0, right: RuntimeCandidateV0): number {
  return availabilityScore(left) - availabilityScore(right);
}

function availabilityScore(candidate: RuntimeCandidateV0): number {
  return healthScore(candidate.adapter.state.health) + healthScore(candidate.runtime.state.health);
}

function healthScore(health: RuntimeCandidateV0["runtime"]["state"]["health"]): number {
  switch (health) {
    case "healthy":
      return 0;
    case "degraded":
      return 1;
    case "unknown":
      return 2;
    case "unhealthy":
      return 3;
  }
}

function collectMismatchFields(
  registry: RuntimeRegistry,
  requirements: RuntimeRequirementsV0 | undefined,
): string[] {
  if (!requirements) {
    return [];
  }

  let best: string[] | undefined;
  for (const runtime of registry.listRuntimes()) {
    const result = mergeMismatchFields(runtime.capability, requirements);
    if (!best || result.length < best.length) {
      best = result;
    }
  }

  return best ?? [];
}

function mergeMismatchFields(
  capability: RuntimeCandidateV0["runtime"]["capability"],
  requirements: RuntimeRequirementsV0,
): string[] {
  return matchRuntimeCapabilities(capability, requirements).mismatches.map(
    (mismatch) => mismatch.field,
  );
}
