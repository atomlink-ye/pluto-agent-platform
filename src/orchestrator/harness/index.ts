// Harness barrel — re-export all harness modules
export { finishManagerHarnessFailure, type CommandExecutionResult, type FinishManagerHarnessFailureInput, type ManagerRunHarnessResult } from "./failure.js";
export { buildPlaybookMetadata, materializeRunWorkspace, validateRunProfileRuntimeSupport, verifyRequiredReads } from "./preflight.js";
export {
  buildFallbackSummary,
  buildSummaryRequest,
  ensureArtifactMentions,
  ensureCompletionMessageCitations,
  firstNonEmptyLine,
  renderFinalReport,
  renderStatusDoc,
  renderTaskTree,
  selectFinalArtifactMarkdown,
} from "./reporting.js";
export {
  bestEffortCleanup,
  buildCompletionMessageBody,
  executeAcceptanceCommand,
  extractStructuredWorkerMessage,
  findWorkerCompletedEvent,
  readWorkspaceArtifact,
  resolveDispatchMode,
  resolveRunStatus,
  type CommandExecutionResult as UtilityCommandExecutionResult,
} from "./utilities.js";