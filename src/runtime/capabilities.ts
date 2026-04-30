import type {
  ProviderProfileV0,
  RuntimeCapabilityDescriptorV0,
  RuntimeRequirementsV0,
  RuntimeToolKindV0,
} from "../contracts/types.js";

export interface CapabilityMismatchV0 {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface CapabilityMatchResultV0 {
  ok: boolean;
  mismatches: CapabilityMismatchV0[];
}

export interface RuntimeRequirementsMergeResultV0 {
  requirements?: RuntimeRequirementsV0;
  conflictFields: string[];
}

export function profileToRequirements(
  profile: ProviderProfileV0,
): RuntimeRequirementsV0 {
  return {
    runtimeIds: profile.selection?.runtimeIds,
    adapterIds: profile.selection?.adapterIds,
    providers: [profile.provider],
    model: {
      ids: profile.selection?.modelIds,
      families: profile.selection?.modelFamilies,
    },
    locality: profile.selection?.localities,
    posture: profile.selection?.postures,
  };
}

export function mergeRuntimeRequirements(
  ...requirements: Array<RuntimeRequirementsV0 | undefined>
): RuntimeRequirementsV0 | undefined {
  return mergeRuntimeRequirementsWithDiagnostics(...requirements).requirements;
}

export function mergeRuntimeRequirementsWithDiagnostics(
  ...requirements: Array<RuntimeRequirementsV0 | undefined>
): RuntimeRequirementsMergeResultV0 {
  const present = requirements.filter(
    (value): value is RuntimeRequirementsV0 => value !== undefined,
  );
  if (present.length === 0) {
    return { requirements: undefined, conflictFields: [] };
  }

  const merged: RuntimeRequirementsV0 = {};
  const conflictFields = new Set<string>();

  for (const requirement of present) {
    merged.runtimeIds = mergeStringArrays(
      merged.runtimeIds,
      requirement.runtimeIds,
      "runtimeId",
      conflictFields,
    );
    merged.adapterIds = mergeStringArrays(
      merged.adapterIds,
      requirement.adapterIds,
      "adapterId",
      conflictFields,
    );
    merged.providers = mergeStringArrays(
      merged.providers,
      requirement.providers,
      "provider",
      conflictFields,
    );
    merged.locality = mergeStringArrays(
      merged.locality,
      requirement.locality,
      "locality",
      conflictFields,
    );
    merged.posture = mergeStringArrays(
      merged.posture,
      requirement.posture,
      "posture",
      conflictFields,
    );

    if (requirement.model) {
      merged.model = {
        ids: mergeStringArrays(
          merged.model?.ids,
          requirement.model.ids,
          "model.id",
          conflictFields,
        ),
        families: mergeStringArrays(
          merged.model?.families,
          requirement.model.families,
          "model.family",
          conflictFields,
        ),
        modes: mergeStringArrays(
          merged.model?.modes,
          requirement.model.modes,
          "model.mode",
          conflictFields,
        ),
        minContextWindowTokens: maxNumber(
          merged.model?.minContextWindowTokens,
          requirement.model.minContextWindowTokens,
        ),
        minMaxOutputTokens: maxNumber(
          merged.model?.minMaxOutputTokens,
          requirement.model.minMaxOutputTokens,
        ),
        structuredOutput: mergeBooleanRequirement(
          merged.model?.structuredOutput,
          requirement.model.structuredOutput,
        ),
      };
    }

    if (requirement.tools) {
      merged.tools = mergeBooleanMap(merged.tools, requirement.tools);
    }

    if (requirement.files) {
      merged.files = {
        read: mergeBooleanRequirement(merged.files?.read, requirement.files.read),
        write: mergeBooleanRequirement(merged.files?.write, requirement.files.write),
        workspaceRootOnly: mergeBooleanRequirement(
          merged.files?.workspaceRootOnly,
          requirement.files.workspaceRootOnly,
        ),
      };
    }

    if (requirement.callbacks) {
      merged.callbacks = {
        followUpMessages: mergeBooleanRequirement(
          merged.callbacks?.followUpMessages,
          requirement.callbacks.followUpMessages,
        ),
        eventStream: mergeBooleanRequirement(
          merged.callbacks?.eventStream,
          requirement.callbacks.eventStream,
        ),
        backgroundSessions: mergeBooleanRequirement(
          merged.callbacks?.backgroundSessions,
          requirement.callbacks.backgroundSessions,
        ),
      };
    }

    if (requirement.limits) {
      merged.limits = {
        minExecutionMs: maxNumber(
          merged.limits?.minExecutionMs,
          requirement.limits.minExecutionMs,
        ),
        minFilesPerRun: maxNumber(
          merged.limits?.minFilesPerRun,
          requirement.limits.minFilesPerRun,
        ),
      };
    }
  }

  return {
    requirements: merged,
    conflictFields: Array.from(conflictFields),
  };
}

export function matchRuntimeCapabilities(
  capability: RuntimeCapabilityDescriptorV0,
  requirements?: RuntimeRequirementsV0,
): CapabilityMatchResultV0 {
  if (!requirements) {
    return { ok: true, mismatches: [] };
  }

  const mismatches: CapabilityMismatchV0[] = [];

  expectOneOf(mismatches, "runtimeId", requirements.runtimeIds, capability.runtimeId);
  expectOneOf(mismatches, "adapterId", requirements.adapterIds, capability.adapterId);
  expectOneOf(mismatches, "provider", requirements.providers, capability.provider);
  expectOneOf(mismatches, "locality", requirements.locality, capability.locality);
  expectOneOf(mismatches, "posture", requirements.posture, capability.posture);

  if (requirements.model) {
    expectOneOf(mismatches, "model.id", requirements.model.ids, capability.model?.id);
    expectOneOf(
      mismatches,
      "model.family",
      requirements.model.families,
      capability.model?.family,
    );
    expectOneOf(
      mismatches,
      "model.mode",
      requirements.model.modes,
      capability.model?.mode,
    );
    expectMinimum(
      mismatches,
      "model.contextWindowTokens",
      requirements.model.minContextWindowTokens,
      capability.model?.contextWindowTokens,
    );
    expectMinimum(
      mismatches,
      "model.maxOutputTokens",
      requirements.model.minMaxOutputTokens,
      capability.model?.maxOutputTokens,
    );
    expectBoolean(
      mismatches,
      "model.structuredOutput",
      requirements.model.structuredOutput,
      capability.model?.structuredOutput,
    );
  }

  for (const tool of TOOL_KINDS) {
    expectBoolean(mismatches, `tools.${tool}`, requirements.tools?.[tool], capability.tools?.[tool]);
  }

  expectBoolean(mismatches, "files.read", requirements.files?.read, capability.files?.read);
  expectBoolean(mismatches, "files.write", requirements.files?.write, capability.files?.write);
  expectBoolean(
    mismatches,
    "files.workspaceRootOnly",
    requirements.files?.workspaceRootOnly,
    capability.files?.workspaceRootOnly,
  );

  expectBoolean(
    mismatches,
    "callbacks.followUpMessages",
    requirements.callbacks?.followUpMessages,
    capability.callbacks?.followUpMessages,
  );
  expectBoolean(
    mismatches,
    "callbacks.eventStream",
    requirements.callbacks?.eventStream,
    capability.callbacks?.eventStream,
  );
  expectBoolean(
    mismatches,
    "callbacks.backgroundSessions",
    requirements.callbacks?.backgroundSessions,
    capability.callbacks?.backgroundSessions,
  );

  expectMinimum(
    mismatches,
    "limits.maxExecutionMs",
    requirements.limits?.minExecutionMs,
    capability.limits?.maxExecutionMs,
  );
  expectMinimum(
    mismatches,
    "limits.maxFilesPerRun",
    requirements.limits?.minFilesPerRun,
    capability.limits?.maxFilesPerRun,
  );

  return {
    ok: mismatches.length === 0,
    mismatches,
  };
}

const TOOL_KINDS: RuntimeToolKindV0[] = [
  "shell",
  "web_fetch",
  "search",
  "image_input",
];

function mergeStringArrays<T extends string>(
  current: T[] | undefined,
  next: T[] | undefined,
  field: string,
  conflictFields: Set<string>,
): T[] | undefined {
  if (conflictFields.has(field)) {
    return [];
  }
  if (!current?.length) {
    return next?.length ? [...next] : undefined;
  }
  if (!next?.length) {
    return [...current];
  }

  const intersection = current.filter((value) => next.includes(value));
  if (intersection.length === 0) {
    conflictFields.add(field);
    return [];
  }

  return Array.from(new Set(intersection));
}

function maxNumber(
  current: number | undefined,
  next: number | undefined,
): number | undefined {
  if (current === undefined) {
    return next;
  }
  if (next === undefined) {
    return current;
  }
  return Math.max(current, next);
}

function mergeBooleanRequirement(
  current: boolean | undefined,
  next: boolean | undefined,
): boolean | undefined {
  return current === true || next === true ? true : current ?? next;
}

function mergeBooleanMap<T extends string>(
  current: Partial<Record<T, boolean>> | undefined,
  next: Partial<Record<T, boolean>> | undefined,
): Partial<Record<T, boolean>> | undefined {
  if (!current && !next) {
    return undefined;
  }

  const merged: Partial<Record<T, boolean>> = { ...(current ?? {}) };
  for (const key of Object.keys(next ?? {}) as T[]) {
    merged[key] = mergeBooleanRequirement(merged[key], next?.[key]);
  }
  return merged;
}

function expectOneOf(
  mismatches: CapabilityMismatchV0[],
  field: string,
  expected: string[] | undefined,
  actual: string | undefined,
): void {
  if (!expected?.length) {
    return;
  }
  if (actual !== undefined && expected.includes(actual)) {
    return;
  }
  mismatches.push({ field, expected, actual });
}

function expectMinimum(
  mismatches: CapabilityMismatchV0[],
  field: string,
  minimum: number | undefined,
  actual: number | undefined,
): void {
  if (minimum === undefined) {
    return;
  }
  if (actual !== undefined && actual >= minimum) {
    return;
  }
  mismatches.push({ field, expected: minimum, actual });
}

function expectBoolean(
  mismatches: CapabilityMismatchV0[],
  field: string,
  expected: boolean | undefined,
  actual: boolean | undefined,
): void {
  if (expected !== true) {
    return;
  }
  if (actual === true) {
    return;
  }
  mismatches.push({ field, expected: true, actual });
}
