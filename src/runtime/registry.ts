import type { PaseoTeamAdapterFactory } from "../contracts/adapter.js";
import type {
  ProviderProfileV0,
  RuntimeCapabilityDescriptorV0,
  RuntimeRequirementsV0,
} from "../contracts/types.js";
import {
  matchRuntimeCapabilities,
  mergeRuntimeRequirementsWithDiagnostics,
  profileToRequirements,
  type CapabilityMatchResultV0,
} from "./capabilities.js";

export type RuntimeHealthStatusV0 =
  | "unknown"
  | "healthy"
  | "degraded"
  | "unhealthy";

export interface RuntimeStateV0 {
  enabled: boolean;
  health: RuntimeHealthStatusV0;
  note?: string;
  updatedAt?: string;
}

export interface RegisteredAdapterV0 {
  id: string;
  factory: PaseoTeamAdapterFactory;
  state: RuntimeStateV0;
}

export interface RegisteredRuntimeV0 {
  id: string;
  adapterId: string;
  capability: RuntimeCapabilityDescriptorV0;
  state: RuntimeStateV0;
}

export interface RegisteredProviderProfileV0 {
  id: string;
  profile: ProviderProfileV0;
  state: RuntimeStateV0;
}

export interface RuntimeCandidateV0 {
  runtime: RegisteredRuntimeV0;
  adapter: RegisteredAdapterV0;
  providerProfile?: RegisteredProviderProfileV0;
  match: CapabilityMatchResultV0;
}

export interface RuntimeCandidateQueryV0 {
  requirements?: RuntimeRequirementsV0;
  providerProfileId?: string;
  includeDisabled?: boolean;
}

export class RuntimeRegistry {
  private readonly adapters = new Map<string, RegisteredAdapterV0>();
  private readonly runtimes = new Map<string, RegisteredRuntimeV0>();
  private readonly providerProfiles = new Map<string, RegisteredProviderProfileV0>();

  registerAdapter(input: {
    id: string;
    factory: PaseoTeamAdapterFactory;
    state?: Partial<RuntimeStateV0>;
  }): RegisteredAdapterV0 {
    const entry: RegisteredAdapterV0 = {
      id: input.id,
      factory: input.factory,
      state: normalizeState(input.state),
    };
    this.adapters.set(entry.id, entry);
    return entry;
  }

  registerRuntime(input: {
    id: string;
    adapterId: string;
    capability: RuntimeCapabilityDescriptorV0;
    state?: Partial<RuntimeStateV0>;
  }): RegisteredRuntimeV0 {
    const adapter = this.adapters.get(input.adapterId);
    if (!adapter) {
      throw new Error(`runtime_registry_unknown_adapter:${input.adapterId}`);
    }
    if (input.capability.runtimeId !== input.id) {
      throw new Error(
        `runtime_registry_runtime_id_mismatch:${input.id}:${input.capability.runtimeId}`,
      );
    }
    if (input.capability.adapterId !== input.adapterId) {
      throw new Error(
        `runtime_registry_adapter_id_mismatch:${input.adapterId}:${input.capability.adapterId}`,
      );
    }

    const entry: RegisteredRuntimeV0 = {
      id: input.id,
      adapterId: adapter.id,
      capability: input.capability,
      state: normalizeState(input.state),
    };
    this.runtimes.set(entry.id, entry);
    return entry;
  }

  registerProviderProfile(input: {
    profile: ProviderProfileV0;
    state?: Partial<RuntimeStateV0>;
  }): RegisteredProviderProfileV0 {
    const entry: RegisteredProviderProfileV0 = {
      id: input.profile.id,
      profile: input.profile,
      state: normalizeState(input.state),
    };
    this.providerProfiles.set(entry.id, entry);
    return entry;
  }

  getAdapter(id: string): RegisteredAdapterV0 | undefined {
    return this.adapters.get(id);
  }

  getRuntime(id: string): RegisteredRuntimeV0 | undefined {
    return this.runtimes.get(id);
  }

  getProviderProfile(id: string): RegisteredProviderProfileV0 | undefined {
    return this.providerProfiles.get(id);
  }

  listAdapters(): RegisteredAdapterV0[] {
    return Array.from(this.adapters.values());
  }

  listRuntimes(): RegisteredRuntimeV0[] {
    return Array.from(this.runtimes.values());
  }

  listProviderProfiles(): RegisteredProviderProfileV0[] {
    return Array.from(this.providerProfiles.values());
  }

  setAdapterState(id: string, state: Partial<RuntimeStateV0>): RegisteredAdapterV0 {
    const entry = this.adapters.get(id);
    if (!entry) {
      throw new Error(`runtime_registry_unknown_adapter:${id}`);
    }
    entry.state = normalizeState({ ...entry.state, ...state });
    return entry;
  }

  setRuntimeState(id: string, state: Partial<RuntimeStateV0>): RegisteredRuntimeV0 {
    const entry = this.runtimes.get(id);
    if (!entry) {
      throw new Error(`runtime_registry_unknown_runtime:${id}`);
    }
    entry.state = normalizeState({ ...entry.state, ...state });
    return entry;
  }

  setProviderProfileState(
    id: string,
    state: Partial<RuntimeStateV0>,
  ): RegisteredProviderProfileV0 {
    const entry = this.providerProfiles.get(id);
    if (!entry) {
      throw new Error(`runtime_registry_unknown_profile:${id}`);
    }
    entry.state = normalizeState({ ...entry.state, ...state });
    return entry;
  }

  findRuntimeCandidates(query: RuntimeCandidateQueryV0 = {}): RuntimeCandidateV0[] {
    const providerProfile = query.providerProfileId
      ? this.providerProfiles.get(query.providerProfileId)
      : undefined;

    if (query.providerProfileId && !providerProfile) {
      throw new Error(`runtime_registry_unknown_profile:${query.providerProfileId}`);
    }

    const includeDisabled = query.includeDisabled ?? false;
    const { requirements: effectiveRequirements, conflictFields } =
      mergeRuntimeRequirementsWithDiagnostics(
        providerProfile ? profileToRequirements(providerProfile.profile) : undefined,
        query.requirements,
      );

    if (conflictFields.length > 0) {
      return [];
    }

    const candidates: RuntimeCandidateV0[] = [];

    for (const runtime of this.runtimes.values()) {
      const adapter = this.adapters.get(runtime.adapterId);
      if (!adapter) {
        continue;
      }

      if (!includeDisabled && (!runtime.state.enabled || !adapter.state.enabled)) {
        continue;
      }

      if (providerProfile && !includeDisabled && !providerProfile.state.enabled) {
        continue;
      }

      const match = matchRuntimeCapabilities(runtime.capability, effectiveRequirements);
      if (!match.ok) {
        continue;
      }

      candidates.push({
        runtime,
        adapter,
        providerProfile,
        match,
      });
    }

    return candidates;
  }
}

function normalizeState(state?: Partial<RuntimeStateV0>): RuntimeStateV0 {
  return {
    enabled: state?.enabled ?? true,
    health: state?.health ?? "unknown",
    note: state?.note,
    updatedAt: state?.updatedAt,
  };
}
