export {
  matchRuntimeCapabilities,
  mergeRuntimeRequirements,
  profileToRequirements,
} from "./capabilities.js";
export type {
  CapabilityMatchResultV0,
  CapabilityMismatchV0,
} from "./capabilities.js";

export { RuntimeRegistry } from "./registry.js";
export { selectEligibleRuntime } from "./selector.js";
export {
  buildAdapterCallbackIdentity,
  CallbackNormalizer,
  getCallbackIdentity,
} from "./callback-normalizer.js";
export {
  buildPortableRuntimeResultRefV0,
  buildPortableRuntimeResultValueRefV0,
  collectPortableRuntimeResultRefs,
  readPortableRuntimeResultValueRef,
  readPortableRuntimeResultValueRefs,
} from "./result-contract.js";
export type {
  RegisteredAdapterV0,
  RegisteredProviderProfileV0,
  RegisteredRuntimeV0,
  RuntimeCandidateQueryV0,
  RuntimeCandidateV0,
  RuntimeHealthStatusV0,
  RuntimeStateV0,
} from "./registry.js";
export type {
  RuntimeSelectionBlockerV0,
  RuntimeSelectionFailureV0,
  RuntimeSelectionResultV0,
  RuntimeSelectionSuccessV0,
  RuntimeSelectorQueryV0,
} from "./selector.js";
export type {
  AdapterCallbackIdentity,
  AdapterCallbackStatus,
} from "./callback-normalizer.js";
export type {
  PortableRuntimeResultRefKindV0,
  PortableRuntimeResultRefV0,
  PortableRuntimeResultAnyRefV0,
  PortableRuntimeResultValueKeyV0,
  PortableRuntimeResultValueRefV0,
} from "./result-contract.js";
