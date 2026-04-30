import type {
  PortabilityConflictResolutionV0,
  PortabilityConflictV0,
  PortableAssetKindV0,
  PortableAssetLogicalRefV0,
} from "../contracts/portability.js";

const PROTECTED_IMPORT_STATUSES = new Set(["accepted", "published"]);

export interface ExistingPortableImportRecordV0 {
  assetKind: PortableAssetKindV0;
  logicalId: string;
  status: "draft" | "accepted" | "published" | (string & {});
}

export interface ResolvePortabilityConflictInputV0 {
  incoming: PortableAssetLogicalRefV0;
  existing: ExistingPortableImportRecordV0;
  resolution?: PortabilityConflictResolutionV0;
}

export function resolvePortabilityConflictV0(
  input: ResolvePortabilityConflictInputV0,
): PortabilityConflictV0 {
  const resolution = input.resolution ?? "duplicate";
  const protectedRecord = PROTECTED_IMPORT_STATUSES.has(input.existing.status);

  if (resolution === "fork") {
    return buildConflict(input, resolution, "created_as_fork", protectedRecord
      ? "Import created a fork because the existing record is accepted or published."
      : "Import created a fork instead of reusing the existing draft.");
  }

  if (resolution === "reject") {
    return buildConflict(input, resolution, "rejected", "Import was rejected by conflict policy.");
  }

  if (protectedRecord) {
    return buildConflict(
      input,
      resolution,
      "rejected",
      "Import cannot overwrite an accepted or published record by default.",
    );
  }

  return buildConflict(
    input,
    resolution,
    "created_as_draft",
    "Import materialized as a draft so the incoming record does not overwrite the existing draft.",
  );
}

function buildConflict(
  input: ResolvePortabilityConflictInputV0,
  resolution: PortabilityConflictResolutionV0,
  outcome: PortabilityConflictV0["outcome"],
  message: string,
): PortabilityConflictV0 {
  return {
    schema: "pluto.portability.conflict",
    schemaVersion: 0,
    code: protectedConflictCode(input.existing.status),
    message,
    assetKind: input.incoming.kind,
    incomingLogicalId: input.incoming.logicalId,
    existingLogicalId: input.existing.logicalId,
    resolution,
    outcome,
  };
}

function protectedConflictCode(status: ExistingPortableImportRecordV0["status"]): string {
  return PROTECTED_IMPORT_STATUSES.has(status) ? "protected_record_conflict" : "draft_record_conflict";
}

export { PROTECTED_IMPORT_STATUSES };
