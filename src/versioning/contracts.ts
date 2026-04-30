import type {
  RuntimeCapabilityDescriptorV0,
  RuntimeRequirementsV0,
} from "../contracts/types.js";

export type SchemaFamilyV0 = string;

export interface SchemaVersionRefV0 {
  family: SchemaFamilyV0;
  version: number;
  writtenAt: string;
}

export interface PackageVersionV0 {
  name: string;
  version: string;
}

export interface CompatibilityImportTargetV0 {
  logicalId?: string;
  name?: string;
}

export interface CompatibilitySupportMatrixV0 {
  schemaFamilies?: string[];
  schemaVersions?: number[];
}

export interface CompatibilityDependencyRefV0 {
  id: string;
  packageName?: string;
  version?: string;
  resolved: boolean;
}

export interface CompatibilityExternalRefV0 {
  ref: string;
  resolved: boolean;
}

export interface CompatibilityAncestryV0 {
  diverged: boolean;
  commonAncestorVersion?: number;
}

export interface CompatibilityCapabilityCheckV0 {
  required?: RuntimeRequirementsV0;
  available?: RuntimeCapabilityDescriptorV0[];
}

export interface CompatibilityPolicyCheckV0 {
  allowed: boolean;
  reason?: string;
}

export interface CompatibilityEvidenceCheckV0 {
  required: boolean;
  present: boolean;
}

export interface CompatibilityApprovalCheckV0 {
  required: boolean;
  granted: boolean;
}

export type CompatibilityOperationV0 =
  | "read"
  | "import"
  | "fork"
  | "run"
  | "publish"
  | "export"
  | "migrate";

export interface CompatibilityContextV0 {
  operation: CompatibilityOperationV0;
  subject: SchemaVersionRefV0;
  against: SchemaVersionRefV0;
  packageVersion?: PackageVersionV0;
  incoming?: CompatibilityImportTargetV0;
  existing?: CompatibilityImportTargetV0;
  supported?: CompatibilitySupportMatrixV0;
  dependencies?: CompatibilityDependencyRefV0[];
  externalRefs?: CompatibilityExternalRefV0[];
  ancestry?: CompatibilityAncestryV0;
  capabilities?: CompatibilityCapabilityCheckV0;
  policy?: CompatibilityPolicyCheckV0;
  evidence?: CompatibilityEvidenceCheckV0;
  approval?: CompatibilityApprovalCheckV0;
  againstPackageVersion?: PackageVersionV0;
}

export interface ImportConflictV0 {
  code: string;
  message: string;
  incoming: SchemaVersionRefV0;
  existing: SchemaVersionRefV0;
}

export interface MigrationPlanV0 {
  id: string;
  from: SchemaVersionRefV0;
  to: SchemaVersionRefV0;
  dryRunOnly: boolean;
  warnings: string[];
  blockers: string[];
  importConflicts: ImportConflictV0[];
}

export type MigrationRecordStatusV0 = "planned" | "dry_run_succeeded" | "dry_run_failed";

export interface MigrationRecordV0 {
  migrationId: string;
  status: MigrationRecordStatusV0;
  startedAt: string;
  finishedAt: string;
  plan: MigrationPlanV0;
  warnings: string[];
  blockers: string[];
}

export type CompatibilityStatusV0 = "compatible" | "requires_migration" | "incompatible";

export interface CompatibilityReportV0 {
  status: CompatibilityStatusV0;
  warnings: string[];
  blockers: string[];
  requiredMigrations: MigrationPlanV0[];
  checkedAgainst: CompatibilityContextV0;
}
