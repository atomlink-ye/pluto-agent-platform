import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { GovernanceEventStore } from "../audit/governance-event-store.js";
import type { GovernanceEventRecordV0 } from "../audit/governance-events.js";
import { CatalogStore } from "../catalog/catalog-store.js";
import type { PolicyPackV0, SkillDefinitionV0, TemplateV0 } from "../catalog/contracts.js";
import type { PrincipalRefV0, WorkspaceScopedRefV0 } from "../contracts/identity.js";
import type { SecretRefV0 } from "../contracts/security.js";
import { GovernanceStore } from "../governance/governance-store.js";
import { DEFAULT_GOVERNANCE_SEED_IDS } from "../governance/seed.js";
import { SecurityStore } from "../security/security-store.js";
import { BootstrapStore } from "./bootstrap-store.js";
import type { BootstrapFailureV0, BootstrapObjectRefV0, BootstrapSessionV0, BootstrapStepV0 } from "./contracts.js";

const CURATED_SAMPLE_ID = "sample-curated-default-workflow";
const CURATED_CATALOG_VERSION = "0.0.1";

export type SampleDefinitionStatusV0 = "active" | "retired" | "invalid";
export type SampleLifecycleStatusV0 = "installed" | "active" | "revoked";

export interface SampleCatalogRefV0 {
  id: string;
  version: string;
}

export interface SampleGovernanceRefV0 {
  id: string;
}

export interface SampleExpectedArtifactV0 {
  artifactType: "report" | "plan" | "patch" | "checklist";
  templateRef: SampleCatalogRefV0;
  producedBy: string;
}

export interface CuratedSampleWorkflowDefinitionV0 {
  sampleId: string;
  scope: "local-v0";
  status: SampleDefinitionStatusV0;
  name: string;
  playbookRef: SampleGovernanceRefV0;
  scenarioRef: SampleGovernanceRefV0;
  templateRef: SampleCatalogRefV0;
  skillRefs: SampleCatalogRefV0[];
  policyPackRef: SampleCatalogRefV0;
  requiredCapabilities: string[];
  requiredSecretRefNames: string[];
  expectedArtifacts: SampleExpectedArtifactV0[];
  evidenceContractRefs: string[];
}

export interface SampleInstallRecordV0 {
  schema: "pluto.bootstrap.sample-install";
  schemaVersion: 0;
  sampleId: string;
  workspaceRef: WorkspaceScopedRefV0;
  actorRefs: PrincipalRefV0[];
  scope: "local-v0";
  lifecycleStatus: SampleLifecycleStatusV0;
  definition: CuratedSampleWorkflowDefinitionV0;
  installedAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
  auditEventIds: string[];
}

export interface SamplePolicyBlockV0 {
  reason: string;
  resolutionHint: string;
}

export interface InstallCuratedSampleWorkflowInput {
  workspaceRef: WorkspaceScopedRefV0;
  actorRefs: PrincipalRefV0[];
  sessionId: string;
  stepId: string;
  availableCapabilities: string[];
  policyBlocks?: SamplePolicyBlockV0[];
  sample?: CuratedSampleWorkflowDefinitionV0;
  now?: string;
  sourceCommand?: string;
  sourceRef?: string | null;
}

export interface RevokeCuratedSampleWorkflowInput {
  workspaceRef: WorkspaceScopedRefV0;
  actorRefs: PrincipalRefV0[];
  sessionId: string;
  stepId: string;
  reason?: string;
  now?: string;
  sourceCommand?: string;
  sourceRef?: string | null;
}

export interface InstallCuratedSampleWorkflowSuccess {
  ok: true;
  record: SampleInstallRecordV0;
  decision: "installed" | "activated" | "reconciled";
  auditEvents: GovernanceEventRecordV0[];
}

export interface InstallCuratedSampleWorkflowFailure {
  ok: false;
  failure: BootstrapFailureV0;
}

export type InstallCuratedSampleWorkflowResult =
  | InstallCuratedSampleWorkflowSuccess
  | InstallCuratedSampleWorkflowFailure;

export interface RevokeCuratedSampleWorkflowSuccess {
  ok: true;
  record: SampleInstallRecordV0;
  decision: "revoked" | "already_revoked" | "missing";
  auditEvents: GovernanceEventRecordV0[];
}

export type RevokeCuratedSampleWorkflowResult =
  | RevokeCuratedSampleWorkflowSuccess
  | InstallCuratedSampleWorkflowFailure;

export interface SampleInstallServiceOptions {
  dataDir?: string;
  bootstrapStore?: BootstrapStore;
  catalogStore?: CatalogStore;
  governanceStore?: GovernanceStore;
  securityStore?: SecurityStore;
  auditStore?: GovernanceEventStore;
}

export const CURATED_SAMPLE_WORKFLOW_V0: CuratedSampleWorkflowDefinitionV0 = {
  sampleId: CURATED_SAMPLE_ID,
  scope: "local-v0",
  status: "active",
  name: "Curated default workflow",
  playbookRef: { id: DEFAULT_GOVERNANCE_SEED_IDS.playbookId },
  scenarioRef: { id: DEFAULT_GOVERNANCE_SEED_IDS.scenarioId },
  templateRef: { id: "lead-summary", version: CURATED_CATALOG_VERSION },
  skillRefs: [
    { id: "lead-orchestrate", version: CURATED_CATALOG_VERSION },
    { id: "plan-artifact", version: CURATED_CATALOG_VERSION },
    { id: "generate-artifact", version: CURATED_CATALOG_VERSION },
    { id: "evaluate-artifact", version: CURATED_CATALOG_VERSION },
  ],
  policyPackRef: { id: "default-guardrails", version: CURATED_CATALOG_VERSION },
  requiredCapabilities: ["local-repo-read", "workspace-write"],
  requiredSecretRefNames: ["OPENCODE_API_KEY"],
  expectedArtifacts: [
    { artifactType: "report", templateRef: { id: "lead-summary", version: CURATED_CATALOG_VERSION }, producedBy: "lead-orchestrate" },
    { artifactType: "plan", templateRef: { id: "planner-plan", version: CURATED_CATALOG_VERSION }, producedBy: "plan-artifact" },
    { artifactType: "patch", templateRef: { id: "generator-body", version: CURATED_CATALOG_VERSION }, producedBy: "generate-artifact" },
    { artifactType: "checklist", templateRef: { id: "evaluator-verdict", version: CURATED_CATALOG_VERSION }, producedBy: "evaluate-artifact" },
  ],
  evidenceContractRefs: [
    "catalog:roles/lead@0.0.1#expectedEvidence",
    "catalog:roles/planner@0.0.1#expectedEvidence",
    "catalog:roles/generator@0.0.1#expectedEvidence",
    "catalog:roles/evaluator@0.0.1#expectedEvidence",
    "catalog:skills/lead-orchestrate@0.0.1#evidenceContract",
    "catalog:skills/plan-artifact@0.0.1#evidenceContract",
    "catalog:skills/generate-artifact@0.0.1#evidenceContract",
    "catalog:skills/evaluate-artifact@0.0.1#evidenceContract",
  ],
};

export class SampleInstallService {
  private readonly dataDir: string;
  private readonly bootstrapStore: BootstrapStore;
  private readonly catalogStore: CatalogStore;
  private readonly governanceStore: GovernanceStore;
  private readonly securityStore: SecurityStore;
  private readonly auditStore: GovernanceEventStore;

  constructor(options: SampleInstallServiceOptions = {}) {
    this.dataDir = options.dataDir ?? process.env.PLUTO_DATA_DIR ?? ".pluto";
    this.bootstrapStore = options.bootstrapStore ?? new BootstrapStore({ dataDir: this.dataDir });
    this.catalogStore = options.catalogStore ?? new CatalogStore({ dataDir: this.dataDir });
    this.governanceStore = options.governanceStore ?? new GovernanceStore({ dataDir: this.dataDir });
    this.securityStore = options.securityStore ?? new SecurityStore({ dataDir: this.dataDir });
    this.auditStore = options.auditStore ?? new GovernanceEventStore({ dataDir: this.dataDir });
  }

  async installCuratedSampleWorkflow(
    input: InstallCuratedSampleWorkflowInput,
  ): Promise<InstallCuratedSampleWorkflowResult> {
    const now = input.now ?? new Date().toISOString();
    const sample = structuredClone(input.sample ?? CURATED_SAMPLE_WORKFLOW_V0);
    const validation = await this.validateInstallGate(sample, input.availableCapabilities, input.policyBlocks ?? []);
    if (validation !== null) {
      return this.failClosed(input, now, validation.blockingReason, validation.resolutionHint);
    }

    const session = await this.requireSession(input.workspaceRef.workspaceId, input.sessionId);
    const step = await this.requireStep(input.workspaceRef.workspaceId, input.sessionId, input.stepId);
    const existing = await this.readInstallRecord(input.workspaceRef.workspaceId, sample.sampleId);
    const objectRef = this.toObjectRef(input.workspaceRef, input.actorRefs, sample, existing?.lifecycleStatus ?? "installed", now);

    let record: SampleInstallRecordV0;
    let decision: InstallCuratedSampleWorkflowSuccess["decision"];
    const auditEvents: GovernanceEventRecordV0[] = [];

    if (existing === null) {
      const installEvent = this.buildAuditEvent({
        actorRefs: input.actorRefs,
        eventType: "bootstrap_sample_install_recorded",
        targetRecordId: sample.sampleId,
        workspaceId: input.workspaceRef.workspaceId,
        createdAt: now,
        beforeStatus: null,
        afterStatus: "installed",
        summary: `curated sample ${sample.sampleId} installed for local-v0`,
        sourceCommand: input.sourceCommand ?? "SampleInstallService.installCuratedSampleWorkflow",
        sourceRef: input.sourceRef ?? sample.sampleId,
      });
      await this.auditStore.append(installEvent);
      auditEvents.push(installEvent);

      record = {
        schema: "pluto.bootstrap.sample-install",
        schemaVersion: 0,
        sampleId: sample.sampleId,
        workspaceRef: input.workspaceRef,
        actorRefs: [...input.actorRefs],
        scope: "local-v0",
        lifecycleStatus: "installed",
        definition: sample,
        installedAt: now,
        activatedAt: null,
        revokedAt: null,
        updatedAt: now,
        auditEventIds: [installEvent.eventId],
      };
      decision = "installed";
    } else {
      record = {
        ...existing,
        definition: sample,
        actorRefs: [...input.actorRefs],
        updatedAt: now,
      };
      decision = existing.lifecycleStatus === "active" ? "reconciled" : "activated";
    }

    if (record.lifecycleStatus !== "active") {
      const activateEvent = this.buildAuditEvent({
        actorRefs: input.actorRefs,
        eventType: "bootstrap_sample_activation_recorded",
        targetRecordId: sample.sampleId,
        workspaceId: input.workspaceRef.workspaceId,
        createdAt: now,
        beforeStatus: record.lifecycleStatus,
        afterStatus: "active",
        summary: `curated sample ${sample.sampleId} activated for local-v0`,
        sourceCommand: input.sourceCommand ?? "SampleInstallService.installCuratedSampleWorkflow",
        sourceRef: input.sourceRef ?? sample.sampleId,
      });
      await this.auditStore.append(activateEvent);
      auditEvents.push(activateEvent);
      record = {
        ...record,
        lifecycleStatus: "active",
        activatedAt: now,
        revokedAt: null,
        updatedAt: now,
        auditEventIds: [...record.auditEventIds, activateEvent.eventId],
      };
      if (decision === "installed") {
        decision = "installed";
      } else {
        decision = "activated";
      }
    }

    await this.writeInstallRecord(record);
    await this.resolveFailures(input.workspaceRef.workspaceId, input.sessionId, input.stepId, now);
    await this.putStep({
      ...step,
      status: "succeeded",
      updatedAt: now,
      finishedAt: now,
      blockingReason: null,
      resolutionHint: null,
      createdObjectRefs: mergeObjectRefs(step.createdObjectRefs, [objectRef]),
    });
    await this.syncSessionStatus(session, now, {
      createdObjectRefs: mergeObjectRefs(session.createdObjectRefs, [objectRef]),
    });

    return { ok: true, record, decision, auditEvents };
  }

  async revokeCuratedSampleWorkflow(
    input: RevokeCuratedSampleWorkflowInput,
  ): Promise<RevokeCuratedSampleWorkflowResult> {
    const now = input.now ?? new Date().toISOString();
    const existing = await this.readInstallRecord(input.workspaceRef.workspaceId, CURATED_SAMPLE_ID);
    if (existing === null) {
      return { ok: true, record: null as never, decision: "missing", auditEvents: [] };
    }

    if (existing.lifecycleStatus === "revoked") {
      return { ok: true, record: existing, decision: "already_revoked", auditEvents: [] };
    }

    const event = this.buildAuditEvent({
      actorRefs: input.actorRefs,
      eventType: "bootstrap_sample_revocation_recorded",
      targetRecordId: existing.sampleId,
      workspaceId: input.workspaceRef.workspaceId,
      createdAt: now,
      beforeStatus: existing.lifecycleStatus,
      afterStatus: "revoked",
      summary: `curated sample ${existing.sampleId} revoked for local-v0`,
      reason: input.reason ?? null,
      sourceCommand: input.sourceCommand ?? "SampleInstallService.revokeCuratedSampleWorkflow",
      sourceRef: input.sourceRef ?? existing.sampleId,
    });
    await this.auditStore.append(event);

    const record: SampleInstallRecordV0 = {
      ...existing,
      lifecycleStatus: "revoked",
      revokedAt: now,
      updatedAt: now,
      actorRefs: [...input.actorRefs],
      auditEventIds: [...existing.auditEventIds, event.eventId],
    };
    await this.writeInstallRecord(record);

    const session = await this.requireSession(input.workspaceRef.workspaceId, input.sessionId);
    const step = await this.requireStep(input.workspaceRef.workspaceId, input.sessionId, input.stepId);
    await this.putStep({
      ...step,
      status: "succeeded",
      updatedAt: now,
      finishedAt: now,
      blockingReason: null,
      resolutionHint: null,
      createdObjectRefs: mergeObjectRefs(
        step.createdObjectRefs,
        [this.toObjectRef(input.workspaceRef, input.actorRefs, existing.definition, "revoked", now)],
      ),
    });
    await this.syncSessionStatus(session, now);

    return { ok: true, record, decision: "revoked", auditEvents: [event] };
  }

  async getInstalledSample(workspaceId: string, sampleId = CURATED_SAMPLE_ID): Promise<SampleInstallRecordV0 | null> {
    return this.readInstallRecord(workspaceId, sampleId);
  }

  async listInstalledSamples(workspaceId: string): Promise<SampleInstallRecordV0[]> {
    const dir = this.sampleDir(workspaceId);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const records: SampleInstallRecordV0[] = [];
      for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
        const record = await this.readInstallRecord(workspaceId, entry.name.slice(0, -5));
        if (record !== null) {
          records.push(record);
        }
      }
      return records;
    } catch {
      return [];
    }
  }

  private async validateInstallGate(
    sample: CuratedSampleWorkflowDefinitionV0,
    availableCapabilities: readonly string[],
    policyBlocks: readonly SamplePolicyBlockV0[],
  ): Promise<{ blockingReason: string; resolutionHint: string } | null> {
    if (sample.scope !== "local-v0") {
      return {
        blockingReason: "unsupported_scope",
        resolutionHint: "Use the local-v0 curated sample installer only for local-v0 bootstrap flows.",
      };
    }

    if (sample.status === "retired") {
      return {
        blockingReason: "sample_retired",
        resolutionHint: "Select an active curated sample before retrying the bootstrap install.",
      };
    }

    if (sample.status === "invalid") {
      return {
        blockingReason: "sample_invalid",
        resolutionHint: "Repair or replace the invalid sample definition before retrying the bootstrap install.",
      };
    }

    const sampleValid = await this.validateReferencedAssets(sample);
    if (sampleValid !== null) {
      return sampleValid;
    }

    const missingCapabilities = sample.requiredCapabilities.filter((capability) => !availableCapabilities.includes(capability));
    if (missingCapabilities.length > 0) {
      return {
        blockingReason: "unsupported_capability",
        resolutionHint: `Provide required capabilities: ${missingCapabilities.join(", ")}.`,
      };
    }

    if (policyBlocks.length > 0) {
      return {
        blockingReason: "policy_blocked",
        resolutionHint: policyBlocks[0]!.resolutionHint,
      };
    }

    const missingSecrets = await this.findMissingSecrets(sample.requiredSecretRefNames);
    if (missingSecrets.length > 0) {
      return {
        blockingReason: "missing_secret_ref",
        resolutionHint: `Register active local-v0 secret refs: ${missingSecrets.join(", ")}.`,
      };
    }

    return null;
  }

  private async validateReferencedAssets(
    sample: CuratedSampleWorkflowDefinitionV0,
  ): Promise<{ blockingReason: string; resolutionHint: string } | null> {
    const playbook = await this.governanceStore.get("playbook", sample.playbookRef.id);
    const scenario = await this.governanceStore.get("scenario", sample.scenarioRef.id);
    const template = await this.catalogStore.read("templates", sample.templateRef.id, sample.templateRef.version);
    const policyPack = await this.catalogStore.read("policy-packs", sample.policyPackRef.id, sample.policyPackRef.version);
    const skills = await Promise.all(sample.skillRefs.map((ref) => this.catalogStore.read("skills", ref.id, ref.version)));
    const artifactTemplates = await Promise.all(
      sample.expectedArtifacts.map((artifact) => this.catalogStore.read("templates", artifact.templateRef.id, artifact.templateRef.version)),
    );

    if (playbook === null || scenario === null || scenario.playbookId !== playbook.id) {
      return {
        blockingReason: "sample_invalid",
        resolutionHint: "Re-seed the local-v0 governance fixtures so the curated playbook and scenario refs are available.",
      };
    }

    if (!isActiveTemplate(template) || !isEnabledPolicyPack(policyPack) || skills.some((skill) => !isActiveSkill(skill)) || artifactTemplates.some((entry) => !isActiveTemplate(entry))) {
      return {
        blockingReason: "sample_invalid",
        resolutionHint: "Re-seed the curated catalog assets so the sample's template, skills, and policy pack refs resolve to active records.",
      };
    }

    return null;
  }

  private async findMissingSecrets(names: readonly string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const name of names) {
      const secret = await this.securityStore.getSecretRef(name);
      if (!isActiveSecret(secret)) {
        missing.push(name);
      }
    }
    return missing;
  }

  private async failClosed(
    input: { workspaceRef: WorkspaceScopedRefV0; actorRefs: PrincipalRefV0[]; sessionId: string; stepId: string },
    now: string,
    blockingReason: string,
    resolutionHint: string,
  ): Promise<InstallCuratedSampleWorkflowFailure> {
    const session = await this.requireSession(input.workspaceRef.workspaceId, input.sessionId);
    const step = await this.requireStep(input.workspaceRef.workspaceId, input.sessionId, input.stepId);
    const failure: BootstrapFailureV0 = {
      schema: "pluto.bootstrap.failure",
      schemaVersion: 0,
      id: `${input.stepId}:${blockingReason}`,
      sessionId: input.sessionId,
      stepId: input.stepId,
      workspaceRef: input.workspaceRef,
      actorRefs: [...input.actorRefs],
      status: "active",
      blockingReason,
      resolutionHint,
      createdObjectRefs: [],
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    await this.bootstrapStore.putFailure(failure);
    await this.putStep({
      ...step,
      status: "blocked",
      updatedAt: now,
      finishedAt: null,
      blockingReason,
      resolutionHint,
    });
    await this.putSession({
      ...session,
      status: "blocked",
      updatedAt: now,
      finishedAt: null,
      blockingReason,
      resolutionHint,
    });

    return { ok: false, failure };
  }

  private async resolveFailures(workspaceId: string, sessionId: string, stepId: string, now: string): Promise<void> {
    const failures = await this.bootstrapStore.listFailures(workspaceId, sessionId);
    for (const failure of failures) {
      if (failure.stepId !== stepId || failure.status !== "active") {
        continue;
      }

      await this.bootstrapStore.putFailure({
        ...failure,
        status: "resolved",
        updatedAt: now,
        resolvedAt: now,
      });
    }
  }

  private async syncSessionStatus(
    session: BootstrapSessionV0,
    now: string,
    overrides: Partial<Pick<BootstrapSessionV0, "createdObjectRefs">> = {},
  ): Promise<void> {
    const steps = await this.bootstrapStore.listSteps(session.workspaceRef.workspaceId, session.id);
    const statuses = steps.map((step) => step.status);
    const nextStatus = statuses.every((status) => status === "succeeded")
      ? "succeeded"
      : statuses.some((status) => status === "blocked" || status === "failed")
      ? "blocked"
      : statuses.some((status) => status === "running" || status === "succeeded")
      ? "running"
      : session.status;

    const blockedStep = steps.find((step) => step.status === "blocked" || step.status === "failed");
    await this.putSession({
      ...session,
      ...overrides,
      status: nextStatus,
      updatedAt: now,
      finishedAt: nextStatus === "succeeded" ? now : null,
      blockingReason: blockedStep?.blockingReason ?? null,
      resolutionHint: blockedStep?.resolutionHint ?? null,
    });
  }

  private async requireSession(workspaceId: string, sessionId: string): Promise<BootstrapSessionV0> {
    const session = await this.bootstrapStore.getSession(workspaceId, sessionId);
    if (session === null) {
      throw new Error(`Bootstrap session not found: ${workspaceId}/${sessionId}`);
    }
    return session;
  }

  private async requireStep(workspaceId: string, sessionId: string, stepId: string): Promise<BootstrapStepV0> {
    const step = await this.bootstrapStore.getStep(workspaceId, sessionId, stepId);
    if (step === null) {
      throw new Error(`Bootstrap step not found: ${workspaceId}/${sessionId}/${stepId}`);
    }
    return step;
  }

  private async putSession(record: BootstrapSessionV0): Promise<void> {
    await this.bootstrapStore.putSession(record);
  }

  private async putStep(record: BootstrapStepV0): Promise<void> {
    await this.bootstrapStore.putStep(record);
  }

  private toObjectRef(
    workspaceRef: WorkspaceScopedRefV0,
    actorRefs: readonly PrincipalRefV0[],
    sample: CuratedSampleWorkflowDefinitionV0,
    status: SampleLifecycleStatusV0,
    now: string,
  ): BootstrapObjectRefV0 {
    return {
      schema: "pluto.bootstrap.object-ref",
      schemaVersion: 0,
      id: `bootstrap-sample:${sample.sampleId}`,
      workspaceRef,
      objectRef: {
        workspaceId: workspaceRef.workspaceId,
        kind: "sample_workflow",
        id: sample.sampleId,
      },
      objectType: "sample_workflow",
      status,
      actorRefs: [...actorRefs],
      summary: `${sample.name} (${sample.scope})`,
      createdAt: now,
      updatedAt: now,
    };
  }

  private buildAuditEvent(input: {
    actorRefs: readonly PrincipalRefV0[];
    eventType: string;
    targetRecordId: string;
    workspaceId: string;
    createdAt: string;
    beforeStatus: string | null;
    afterStatus: string | null;
    summary: string;
    reason?: string | null;
    sourceCommand: string;
    sourceRef?: string | null;
  }): GovernanceEventRecordV0 {
    return {
      schema: "pluto.audit.governance-event",
      schemaVersion: 0,
      eventId: `${input.createdAt}:${input.eventType}:${input.targetRecordId}`,
      eventType: input.eventType,
      actor: {
        principalId: input.actorRefs[0]?.principalId ?? "unknown",
      },
      target: {
        kind: "bootstrap_sample",
        recordId: input.targetRecordId,
        workspaceId: input.workspaceId,
      },
      status: {
        before: input.beforeStatus,
        after: input.afterStatus,
        summary: input.summary,
      },
      evidenceRefs: [],
      reason: input.reason ?? null,
      createdAt: input.createdAt,
      source: {
        command: input.sourceCommand,
        ref: input.sourceRef ?? null,
      },
    };
  }

  private sampleDir(workspaceId: string): string {
    return join(this.dataDir, "bootstrap", workspaceId, "samples", "local-v0");
  }

  private samplePath(workspaceId: string, sampleId: string): string {
    return join(this.sampleDir(workspaceId), `${sampleId}.json`);
  }

  private async writeInstallRecord(record: SampleInstallRecordV0): Promise<void> {
    await mkdir(this.sampleDir(record.workspaceRef.workspaceId), { recursive: true });
    await writeFile(this.samplePath(record.workspaceRef.workspaceId, record.sampleId), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  private async readInstallRecord(workspaceId: string, sampleId: string): Promise<SampleInstallRecordV0 | null> {
    try {
      return JSON.parse(await readFile(this.samplePath(workspaceId, sampleId), "utf8")) as SampleInstallRecordV0;
    } catch {
      return null;
    }
  }
}

function isActiveSecret(secret: SecretRefV0 | null): secret is SecretRefV0 {
  return secret !== null && secret.status === "active";
}

function isActiveSkill(skill: SkillDefinitionV0 | null): skill is SkillDefinitionV0 {
  return skill !== null && skill.status === "active";
}

function isActiveTemplate(template: TemplateV0 | null): template is TemplateV0 {
  return template !== null && template.status === "active";
}

function isEnabledPolicyPack(policyPack: PolicyPackV0 | null): policyPack is Extract<PolicyPackV0, { status: "enabled" }> {
  return policyPack !== null && policyPack.status === "enabled";
}

function mergeObjectRefs(
  existing: readonly BootstrapObjectRefV0[],
  additions: readonly BootstrapObjectRefV0[],
): BootstrapObjectRefV0[] {
  const byId = new Map<string, BootstrapObjectRefV0>();
  for (const objectRef of [...existing, ...additions]) {
    byId.set(objectRef.id, objectRef);
  }
  return [...byId.values()];
}
