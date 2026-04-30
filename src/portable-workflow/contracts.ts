import type { AgentRoleId, RuntimeRequirementsV0, TeamConfig } from "../contracts/types.js";
import type { CompatibilityReportV0, ImportConflictV0 } from "../versioning/contracts.js";

export interface PortableNameRefSetV0 {
  required: string[];
  optional?: string[];
}

export interface PortableWorkflowArtifactExpectationV0 {
  format: "markdown";
  required: true;
  workspaceRelativeArtifactPathOnly: true;
  leadSummaryRequired: true;
  contributionRoleOrder: AgentRoleId[];
}

export interface PortableWorkflowLogicalRefsV0 {
  teamId: string;
  leadRoleId: AgentRoleId;
  roleIds: AgentRoleId[];
  runtimeIds: string[];
  adapterIds: string[];
  providers: string[];
  artifactRefs: string[];
}

export interface PortableWorkflowRuntimeV0 {
  requirements: RuntimeRequirementsV0;
  envRefs?: PortableNameRefSetV0;
  secretRefs?: PortableNameRefSetV0;
}

export interface PortableWorkflowManifestV0 {
  kind: "pluto-portable-workflow";
  schemaVersion: 0;
  exportedAt: string;
  workflowId: string;
  workflowName: string;
  executableSurface: "team-config";
  logicalRefs: PortableWorkflowLogicalRefsV0;
  runtime: PortableWorkflowRuntimeV0;
  artifact: PortableWorkflowArtifactExpectationV0;
}

export interface PortableWorkflowBundleV0 {
  schemaVersion: 0;
  manifest: PortableWorkflowManifestV0;
  team: TeamConfig;
}

export interface PortableWorkflowExportInputV0 {
  team?: TeamConfig;
  exportedAt?: string;
}

export type PortableWorkflowImportModeV0 = "draft" | "fork";

export type PortableWorkflowDraftStatusV0 = "ready" | "blocked";

export interface PortableWorkflowImportRequestV0 {
  bundle: unknown;
  mode?: PortableWorkflowImportModeV0;
  source?: {
    path?: string;
  };
}

export interface PortableWorkflowImportResultV0 {
  schemaVersion: 0;
  draftId: string;
  importedAt: string;
  mode: PortableWorkflowImportModeV0;
  status: PortableWorkflowDraftStatusV0;
  importable: boolean;
  publishedStateMaterialized: false;
  runtimeStateMaterialized: false;
  errors: string[];
  compatibility: CompatibilityReportV0;
  conflicts: ImportConflictV0[];
  bundle: PortableWorkflowBundleV0 | null;
  source?: {
    path?: string;
  };
}

export interface PortableWorkflowDraftSummaryV0 {
  schemaVersion: 0;
  draftId: string;
  workflowId: string | null;
  workflowName: string | null;
  mode: PortableWorkflowImportModeV0;
  status: PortableWorkflowDraftStatusV0;
  importedAt: string;
  importable: boolean;
  conflictCount: number;
}
