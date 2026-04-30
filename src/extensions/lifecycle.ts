import {
  deriveRequestedPrivilegedCapabilities,
  evaluateExtensionActivation,
  type ExtensionActivationInput,
  type ExtensionActivationResult,
} from "./activation.js";
import { ExtensionAuditLog, type ExtensionAuditEvent, type ExtensionAuditEventType } from "./audit.js";
import type { ExtensionInstallV0, ExtensionLifecycleV0, ExtensionPackageV0, TrustReviewV0, TrustVerdictV0 } from "./contracts.js";
import { ExtensionStore } from "./extension-store.js";

interface LifecycleContext {
  store?: ExtensionStore;
  audit?: ExtensionAuditLog;
}

interface ActorRef {
  id: string;
  displayName: string;
}

export interface InstallExtensionInput extends LifecycleContext {
  installId: string;
  packageRecord: ExtensionPackageV0;
  installedPath: string;
  requestedBy: string;
  requestedAt?: string;
}

export interface RecordTrustReviewInput extends LifecycleContext {
  installId: string;
  reviewId: string;
  verdict: TrustVerdictV0;
  reviewer: ActorRef;
  rationale: string;
  privilegedCapabilities?: string[];
  reviewedAt?: string;
}

export interface ActivateExtensionInput extends LifecycleContext, Omit<ExtensionActivationInput, "trustReview"> {
  installId: string;
  actor?: string;
  activatedAt?: string;
}

export interface ActivateExtensionResult extends ExtensionActivationResult {
  install: ExtensionInstallV0;
}

export interface DeactivateExtensionInput extends LifecycleContext {
  installId: string;
  actor?: string;
  deactivatedAt?: string;
}

export interface RevokeExtensionInput extends LifecycleContext {
  installId: string;
  actor?: string;
  revokedAt?: string;
  reason: string;
  replacedBy?: string;
}

export async function installExtension(input: InstallExtensionInput): Promise<ExtensionInstallV0> {
  const store = input.store ?? new ExtensionStore();
  const audit = input.audit ?? new ExtensionAuditLog();
  const timestamp = input.requestedAt ?? new Date().toISOString();
  const pkg = input.packageRecord;

  const install: ExtensionInstallV0 = {
    schemaVersion: 0,
    installId: input.installId,
    extensionId: pkg.extensionId,
    version: pkg.version,
    status: "installed",
    requestedAt: timestamp,
    installedAt: timestamp,
    removedAt: null,
    installedPath: input.installedPath,
    requestedBy: input.requestedBy,
    source: pkg.source,
    packageId: pkg.packageId,
    checksum: pkg.checksum,
    manifest: pkg.manifest,
    lifecycle: cloneLifecycle(pkg.lifecycle, {
      status: "draft",
      updatedAt: timestamp,
      revokedAt: null,
    }),
    signature: pkg.signature,
    trustReview: null,
  };

  await store.upsert("installs", install.installId, install);
  await appendAuditEvent(audit, "install", install, timestamp, input.requestedBy, {
    version: install.version,
    packageId: install.packageId,
    checksum: install.checksum,
    installedPath: install.installedPath,
  });

  return install;
}

export async function recordTrustReview(input: RecordTrustReviewInput): Promise<TrustReviewV0> {
  const store = input.store ?? new ExtensionStore();
  const audit = input.audit ?? new ExtensionAuditLog();
  const install = await requireInstall(store, input.installId);
  const reviewedAt = input.reviewedAt ?? new Date().toISOString();

  const review: TrustReviewV0 = {
    schemaVersion: 0,
    reviewId: input.reviewId,
    extensionId: install.extensionId,
    version: install.version,
    packageId: install.packageId,
    verdict: input.verdict,
    privilegedCapabilities: [...(input.privilegedCapabilities ?? [])],
    reviewer: input.reviewer,
    reason: input.rationale,
    reviewedAt,
    provenance: {
      source: install.source.kind,
      location: install.source.location,
      digest: install.checksum,
    },
    lifecycle: {
      status: install.lifecycle.status,
      publishedAt: install.lifecycle.publishedAt ?? null,
      deprecatedAt: install.lifecycle.deprecatedAt ?? null,
      revokedAt: install.lifecycle.revokedAt ?? null,
    },
    evidence: {
      signatureStatus: install.signature.status,
      capabilityNames: install.manifest.capabilities.map((capability) => capability.name),
      toolNames: install.manifest.toolSurfaces.map((tool) => tool.tool),
      secretNames: install.manifest.secretNames.map((secret) => secret.name),
      postureConstraintNames: install.manifest.postureConstraints.map((constraint) => constraint.name),
      outboundTargets: install.manifest.outboundWriteClaims.map((claim) => claim.target),
    },
  };

  const updatedInstall: ExtensionInstallV0 = {
    ...install,
    trustReview: review,
  };

  await store.upsert("trust-reviews", review.reviewId, review);
  await store.upsert("installs", updatedInstall.installId, updatedInstall);
  await appendAuditEvent(audit, "trust-review", updatedInstall, reviewedAt, input.reviewer.id, {
    reviewId: review.reviewId,
    verdict: review.verdict,
    rationale: review.reason,
    privilegedCapabilities: review.privilegedCapabilities,
  });

  return review;
}

export async function activateExtension(input: ActivateExtensionInput): Promise<ActivateExtensionResult> {
  const store = input.store ?? new ExtensionStore();
  const audit = input.audit ?? new ExtensionAuditLog();
  const install = await requireInstall(store, input.installId);
  const timestamp = input.activatedAt ?? new Date().toISOString();

  if (install.lifecycle.status === "revoked") {
    const denied = {
      state: "deny",
      privileged: false,
      reasons: ["extension_revoked"],
      install,
    } satisfies ActivateExtensionResult;
    await appendAuditEvent(audit, "activate-denied", install, timestamp, input.actor ?? "system", {
      reasons: denied.reasons,
      source: "revocation",
    });
    return denied;
  }

  const reviewState = trustVerdictToReviewState(install.trustReview?.verdict ?? "pending");
  const privilegedScopeReasons = resolvePrivilegedScopeReasons(install, input);
  const result = evaluateExtensionActivation({
    ...input,
    trustReview: {
      state: reviewState,
      reasons: reviewState === "approved" ? [] : [`trust_review_${reviewState}`],
    },
  });

  const denialReasons = [...result.reasons, ...privilegedScopeReasons];

  if (denialReasons.length > 0) {
    await appendAuditEvent(audit, "activate-denied", install, timestamp, input.actor ?? "system", {
      reasons: denialReasons,
      privileged: result.privileged,
      trustVerdict: install.trustReview?.verdict ?? null,
    });
    return {
      ...result,
      state: "deny",
      reasons: denialReasons,
      install,
    };
  }

  const updatedInstall: ExtensionInstallV0 = {
    ...install,
    lifecycle: cloneLifecycle(install.lifecycle, {
      status: "active",
      updatedAt: timestamp,
    }),
  };

  await store.upsert("installs", updatedInstall.installId, updatedInstall);
  await appendAuditEvent(audit, "activate", updatedInstall, timestamp, input.actor ?? "system", {
    privileged: result.privileged,
    trustVerdict: install.trustReview?.verdict ?? null,
  });

  return {
    ...result,
    install: updatedInstall,
  };
}

export async function deactivateExtension(input: DeactivateExtensionInput): Promise<ExtensionInstallV0> {
  const store = input.store ?? new ExtensionStore();
  const audit = input.audit ?? new ExtensionAuditLog();
  const install = await requireInstall(store, input.installId);
  const timestamp = input.deactivatedAt ?? new Date().toISOString();

  const updatedInstall: ExtensionInstallV0 = {
    ...install,
    lifecycle: cloneLifecycle(install.lifecycle, {
      status: "draft",
      updatedAt: timestamp,
    }),
  };

  await store.upsert("installs", updatedInstall.installId, updatedInstall);
  await appendAuditEvent(audit, "deactivate", updatedInstall, timestamp, input.actor ?? "system", {
    previousStatus: install.lifecycle.status,
  });

  return updatedInstall;
}

export async function revokeExtension(input: RevokeExtensionInput): Promise<ExtensionInstallV0> {
  const store = input.store ?? new ExtensionStore();
  const audit = input.audit ?? new ExtensionAuditLog();
  const install = await requireInstall(store, input.installId);
  const timestamp = input.revokedAt ?? new Date().toISOString();

  const updatedInstall: ExtensionInstallV0 = {
    ...install,
    status: "blocked",
    lifecycle: cloneLifecycle(install.lifecycle, {
      status: "revoked",
      channel: "deprecated",
      updatedAt: timestamp,
      revokedAt: timestamp,
      replacedBy: input.replacedBy ?? install.lifecycle.replacedBy ?? null,
    }),
  };

  await store.upsert("installs", updatedInstall.installId, updatedInstall);
  await appendAuditEvent(audit, "revoke", updatedInstall, timestamp, input.actor ?? "system", {
    reason: input.reason,
    replacedBy: input.replacedBy ?? null,
  });

  return updatedInstall;
}

async function requireInstall(store: ExtensionStore, installId: string): Promise<ExtensionInstallV0> {
  const install = await store.read("installs", installId);
  if (install === null) {
    throw new Error(`Extension install not found: ${installId}`);
  }
  return install;
}

function cloneLifecycle(lifecycle: ExtensionLifecycleV0, overrides: Partial<ExtensionLifecycleV0>): ExtensionLifecycleV0 {
  return {
    ...lifecycle,
    ...overrides,
  };
}

function trustVerdictToReviewState(verdict: TrustVerdictV0): "approved" | "pending" | "rejected" {
  if (verdict === "approved") {
    return "approved";
  }

  if (verdict === "rejected") {
    return "rejected";
  }

  return "pending";
}

function resolvePrivilegedScopeReasons(
  install: ExtensionInstallV0,
  input: Pick<ActivateExtensionInput, "requestedCapabilities" | "privilegedCapabilities">,
): string[] {
  if (install.trustReview?.verdict !== "approved") {
    return [];
  }

  const requestedPrivilegedCapabilities = (input.privilegedCapabilities ?? []).length > 0
    ? [...new Set(input.privilegedCapabilities ?? [])]
    : deriveRequestedPrivilegedCapabilities(input.requestedCapabilities);
  if (requestedPrivilegedCapabilities.length === 0) {
    return [];
  }

  const approvedCapabilities = new Set(install.trustReview.privilegedCapabilities);
  return requestedPrivilegedCapabilities
    .filter((capability) => !approvedCapabilities.has(capability))
    .map((capability) => `trust_review_scope_missing:${capability}`);
}

async function appendAuditEvent(
  audit: ExtensionAuditLog,
  eventType: ExtensionAuditEventType,
  install: ExtensionInstallV0,
  occurredAt: string,
  actor: string,
  details: Record<string, unknown>,
): Promise<ExtensionAuditEvent> {
  return audit.append({
    eventId: `${install.installId}:${eventType}:${occurredAt}`,
    eventType,
    occurredAt,
    extensionId: install.extensionId,
    installId: install.installId,
    actor,
    details,
  });
}
