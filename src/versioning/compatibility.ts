import { matchRuntimeCapabilities } from "../runtime/index.js";
import type {
  CompatibilityContextV0,
  CompatibilityReportV0,
  ImportConflictV0,
  MigrationPlanV0,
} from "./contracts.js";

const IMPORT_CONFLICT_MESSAGES = {
  logical_id_collision: "Import target logical ID collides with an existing object.",
  name_collision: "Import target name collides with an existing object.",
  unsupported_schema: "Target does not support the incoming schema family or version.",
  missing_dependency: "A required dependency is missing from the target environment.",
  capability_unavailable: "Required runtime capabilities are unavailable in the target environment.",
  policy_denied: "Policy denies this compatibility operation.",
  package_version_conflict: "Package versions conflict between incoming and existing artifacts.",
  ancestry_diverged: "Incoming and existing ancestry have diverged.",
  external_ref_unresolved: "An external reference could not be resolved.",
} as const;

const SILENT_DOWNGRADE_BLOCKERS = {
  capability: "Silent downgrade blocked: required runtime capabilities are not available.",
  policy: "Silent downgrade blocked: policy would be weakened or bypassed.",
  evidence: "Silent downgrade blocked: required evidence would be missing.",
  approval: "Silent downgrade blocked: required approval would be missing.",
} as const;

export function evaluateCompatibility(
  context: CompatibilityContextV0,
): CompatibilityReportV0 {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const requiredMigrations: MigrationPlanV0[] = [];

  if (context.subject.family !== context.against.family) {
    blockers.push(
      `Schema family mismatch: ${context.subject.family} cannot be checked against ${context.against.family}.`,
    );
  } else if (context.subject.version < context.against.version) {
    requiredMigrations.push({
      id: `${context.subject.family}-v${context.subject.version}-to-v${context.against.version}`,
      from: context.subject,
      to: context.against,
      dryRunOnly: true,
      warnings: [
        `Dry-run migration required before ${context.operation} can proceed against schema v${context.against.version}.`,
      ],
      blockers: [],
      importConflicts: [],
    });
  } else if (context.subject.version > context.against.version) {
    blockers.push(
      `Schema version ${context.subject.version} is newer than supported target version ${context.against.version}.`,
    );
  }

  const importConflicts = detectImportConflicts(context);
  blockers.push(...importConflicts.map((conflict) => `${conflict.code}: ${conflict.message}`));
  blockers.push(...collectSilentDowngradeBlockers(context));

  if (context.subject.version === context.against.version) {
    warnings.push(
      `Compatibility evaluated for ${context.operation} with explicit warnings/blockers only; no implicit downgrade path is allowed.`,
    );
  }

  const report: CompatibilityReportV0 = {
    status:
      blockers.length > 0
        ? "incompatible"
        : requiredMigrations.length > 0
          ? "requires_migration"
          : "compatible",
    warnings: dedupe(warnings),
    blockers: dedupe(blockers),
    requiredMigrations,
    checkedAgainst: context,
  };

  assertNoSilentDowngrade(report, context);
  return report;
}

export function detectImportConflicts(
  context: CompatibilityContextV0,
): ImportConflictV0[] {
  const conflicts: ImportConflictV0[] = [];

  if (
    context.incoming?.logicalId &&
    context.existing?.logicalId &&
    context.existing.logicalId === context.incoming.logicalId
  ) {
    conflicts.push(buildConflict("logical_id_collision", context));
  }

  if (context.incoming?.name && context.existing?.name && context.existing.name === context.incoming.name) {
    conflicts.push(buildConflict("name_collision", context));
  }

  const supportedFamily =
    !context.supported?.schemaFamilies?.length ||
    context.supported.schemaFamilies.includes(context.subject.family);
  const supportedVersion =
    !context.supported?.schemaVersions?.length ||
    context.supported.schemaVersions.includes(context.subject.version);
  if (!supportedFamily || !supportedVersion) {
    conflicts.push(buildConflict("unsupported_schema", context));
  }

  if (context.dependencies?.some((dependency) => !dependency.resolved)) {
    conflicts.push(buildConflict("missing_dependency", context));
  }

  if (hasCapabilityConflict(context)) {
    conflicts.push(buildConflict("capability_unavailable", context));
  }

  if (context.policy && !context.policy.allowed) {
    conflicts.push(buildConflict("policy_denied", context, context.policy.reason));
  }

  if (
    context.packageVersion &&
    context.againstPackageVersion &&
    context.packageVersion.name === context.againstPackageVersion.name &&
    context.packageVersion.version !== context.againstPackageVersion.version
  ) {
    conflicts.push(buildConflict("package_version_conflict", context));
  }

  if (context.ancestry?.diverged) {
    conflicts.push(buildConflict("ancestry_diverged", context));
  }

  if (context.externalRefs?.some((ref) => !ref.resolved)) {
    conflicts.push(buildConflict("external_ref_unresolved", context));
  }

  return conflicts;
}

export function assertNoSilentDowngrade(
  report: CompatibilityReportV0,
  context: CompatibilityContextV0 = report.checkedAgainst,
): void {
  const requiredBlockers = collectSilentDowngradeBlockers(context);
  for (const blocker of requiredBlockers) {
    if (!report.blockers.includes(blocker)) {
      throw new Error(`silent_downgrade_not_blocked:${blocker}`);
    }
  }
}

function buildConflict(
  code: keyof typeof IMPORT_CONFLICT_MESSAGES,
  context: CompatibilityContextV0,
  detail?: string,
): ImportConflictV0 {
  return {
    code,
    message: detail ? `${IMPORT_CONFLICT_MESSAGES[code]} ${detail}` : IMPORT_CONFLICT_MESSAGES[code],
    incoming: context.subject,
    existing: context.against,
  };
}

function collectSilentDowngradeBlockers(
  context: CompatibilityContextV0,
): string[] {
  const blockers: string[] = [];

  if (hasCapabilityConflict(context)) {
    blockers.push(SILENT_DOWNGRADE_BLOCKERS.capability);
  }

  if (context.policy && !context.policy.allowed) {
    blockers.push(SILENT_DOWNGRADE_BLOCKERS.policy);
  }

  if (context.evidence?.required && !context.evidence.present) {
    blockers.push(SILENT_DOWNGRADE_BLOCKERS.evidence);
  }

  if (context.approval?.required && !context.approval.granted) {
    blockers.push(SILENT_DOWNGRADE_BLOCKERS.approval);
  }

  return blockers;
}

function hasCapabilityConflict(context: CompatibilityContextV0): boolean {
  if (!context.capabilities?.required) {
    return false;
  }

  const available = context.capabilities.available ?? [];
  if (available.length === 0) {
    return true;
  }

  return !available.some((capability) =>
    matchRuntimeCapabilities(capability, context.capabilities?.required).ok,
  );
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
