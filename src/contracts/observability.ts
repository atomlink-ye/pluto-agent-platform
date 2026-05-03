// Observability contract barrel - re-exports all public API
export * from "./observability-schema.js";

export {
  parseObservabilityObjectKindV0,
  parseBudgetBehaviorV0,
  parseAlertLifecycleV0,
  parseObservabilitySeverityV0,
  parseRedactionStateV0,
  normalizeRunHealthSummaryStatusV0,
  validateMetricSeriesV0,
  validateRunHealthSummaryV0,
  validateAdapterHealthSummaryV0,
  validateRedactedTraceV0,
  validateAlertV0,
  validateDashboardDefinitionV0,
  validateUsageMeterV0,
  validateBudgetV0,
  validateBudgetSnapshotV0,
  validateBudgetDecisionV0,
} from "./observability-validate.js";

// Re-export validation result types from schema for convenience
export type {
  ObservabilityRecordValidationError,
  ObservabilityRecordValidationSuccess,
  ObservabilityRecordValidationResult,
} from "./observability-schema.js";