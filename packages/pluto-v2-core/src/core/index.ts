export { compile } from './spec-compiler.js';
export {
  AuthoredSpecSchema,
  CANONICAL_AUTHORITY_POLICY,
  TeamContextSchema,
  type AuthoredSpec,
  type TeamContext,
} from './team-context.js';
export { RunStateSchema, initialState, type RunState } from './run-state.js';
export { reduce } from './run-state-reducer.js';
export {
  InMemoryEventLogStore,
  SequenceGapError,
  DuplicateAppendError,
  type EventLogStore,
} from './run-event-log.js';
export { validate, type ValidationResult } from './protocol-validator.js';
export {
  AUTHORITY_MATRIX,
  TRANSITION_GRAPH,
  actorAuthorizedForIntent,
  transitionLegal,
  composeRequestKey,
} from './authority.js';
export { RunKernel, type KernelDeps } from './run-kernel.js';
export {
  defaultIdProvider,
  defaultClockProvider,
  counterIdProvider,
  fixedClockProvider,
  type IdProvider,
  type ClockProvider,
} from './providers.js';
