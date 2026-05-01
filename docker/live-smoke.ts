#!/usr/bin/env tsx
/**
 * Pluto MVP-alpha live smoke.
 *
 * Submits a fixed team task to the live PaseoOpenCodeAdapter and asserts:
 *   - Team Lead session was created.
 *   - At least 2 worker sessions completed.
 *   - The final artifact references each contributing role.
 *
 * Architecture note:
 *   The Paseo CLI is a macOS app bundle and cannot be installed inside a
 *   Linux Docker container. Therefore live mode runs on the HOST (where the
 *   Paseo daemon and provider CLIs live). The OpenCode runtime container in
 *   docker/compose.yml is optional and is only useful as the OpenCode web UI
 *   debug endpoint. The live adapter does not require it to be running.
 *
 * Preconditions:
 *   - paseo CLI reachable on $PATH (host).
 *   - Provider: opencode (default) or $PASEO_PROVIDER.
 *   - Model: opencode/minimax-m2.5-free (default) or $PASEO_MODEL.
 *   - Optional: $OPENCODE_BASE_URL for OpenCode HTTP debug endpoint.
 *
 * If preconditions are missing this script prints a structured BLOCKER report
 * and exits with code 2 (intentionally distinct from generic failure exit 1).
 */
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { constants, existsSync } from "node:fs";
import * as process from "node:process";

import { FakeAdapter } from "../src/adapters/fake/index.js";
import { PaseoOpenCodeAdapter } from "../src/adapters/paseo-opencode/index.js";
import { DEFAULT_RUNNER } from "../src/adapters/paseo-opencode/process-runner.js";
import { DEFAULT_TEAM, RunStore, TeamRunService, normalizeBlockerReason, selectTeamPlaybook, validateEvidencePacketV0 } from "../src/orchestrator/index.js";
import type { PaseoTeamAdapter } from "../src/contracts/adapter.js";
import type {
  AgentEvent,
  BlockerReasonV0,
  EvidencePacketV0,
  OrchestrationMode,
  WorkerRequestedOrchestratorSource,
} from "../src/contracts/types.js";

function normalizePaseoHostForCli(host: string | undefined): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^https?:\/\//i, "");
}

const REQUESTED_PLAYBOOK_ID = process.env["PASEO_TEAM_PLAYBOOK"];
const REQUESTED_ORCHESTRATION_MODE = ((process.env["PASEO_ORCHESTRATION_MODE"] ?? "teamlead_direct") === "teamlead_direct"
  ? "teamlead_direct"
  : "lead_marker") as OrchestrationMode;
const REQUIRE_CITATIONS = process.env["PASEO_REQUIRE_CITATIONS"] === "1" || process.env["PASEO_REQUIRE_CITATIONS"]?.toLowerCase() === "true";
const ADAPTER_KIND: "paseo-opencode" | "fake" = (() => {
  // Two equivalent ways to opt in to fake mode:
  //   PLUTO_LIVE_ADAPTER=fake   (the canonical knob)
  //   PLUTO_FAKE_LIVE=1         (a convenience flag used by external gates)
  if (
    process.env["PLUTO_FAKE_LIVE"] === "1" ||
    process.env["PLUTO_FAKE_LIVE"]?.toLowerCase() === "true"
  ) {
    return "fake";
  }
  const v = (process.env["PLUTO_LIVE_ADAPTER"] ?? "paseo-opencode") as
    | "paseo-opencode"
    | "fake";
  return v === "fake" ? "fake" : "paseo-opencode";
})();

interface BlockerReport {
  status: "blocker";
  reason: string;
  hint: string;
}

type LiveSmokeEvidenceClassification =
  | { outcome: "done" }
  | { outcome: "partial"; reason: "provider_unavailable" | "quota_exceeded" }
  | { outcome: "failed"; message: string; blockerReason: BlockerReasonV0 | null };

interface LiveSmokeWorkspaceSelection {
  path: string;
  source: "env_override" | "preferred_default" | "fallback_default";
  requestedDefaultPath: string;
  fallbackPath: string;
  reason: string | null;
}

async function resolveLiveWorkspace(): Promise<LiveSmokeWorkspaceSelection> {
  const requestedDefaultPath = resolve("/Volumes/AgentsWorkspace/tmp/pluto-regression-fix/live-quickstart");
  const fallbackPath = resolve(`${process.cwd()}/.tmp/live-quickstart`);
  const override = process.env["PLUTO_LIVE_WORKSPACE"]?.trim();
  if (override) {
    return {
      path: resolve(override),
      source: "env_override",
      requestedDefaultPath,
      fallbackPath,
      reason: null,
    };
  }
  try {
    await mkdir(requestedDefaultPath, { recursive: true });
    await access(requestedDefaultPath, constants.W_OK);
    return {
      path: requestedDefaultPath,
      source: "preferred_default",
      requestedDefaultPath,
      fallbackPath,
      reason: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`live-smoke: ${requestedDefaultPath} unavailable, using ${fallbackPath} (${reason})`);
    return {
      path: fallbackPath,
      source: "fallback_default",
      requestedDefaultPath,
      fallbackPath,
      reason,
    };
  }
}

export function classifyLiveSmokeEvidence(packet: EvidencePacketV0): LiveSmokeEvidenceClassification {
  if (packet.status === "done") {
    return { outcome: "done" };
  }

  const blockerReason = normalizeBlockerReason(packet.blockerReason);
  if (packet.status === "blocked") {
    if (blockerReason === "provider_unavailable" || blockerReason === "quota_exceeded") {
      return { outcome: "partial", reason: blockerReason };
    }
    return {
      outcome: "failed",
      blockerReason,
      message: `blocked run is not an acceptable partial: ${blockerReason ?? "missing blocker reason"}`,
    };
  }

  return {
    outcome: "failed",
    blockerReason,
    message: `live smoke evidence status ${packet.status} is not acceptable`,
  };
}

function summarizeOrchestratorSources(events: AgentEvent[]) {
  const sourceByRole = new Map<string, WorkerRequestedOrchestratorSource>();
  for (const event of events) {
    if (event.type !== "worker_requested") continue;
    const roleId = String(event.payload["targetRole"] ?? event.roleId ?? "");
    const orchestratorSource = event.payload["orchestratorSource"];
    if (!roleId) {
      throw new Error("worker_requested event missing targetRole for orchestratorSource summary");
    }
    if (
      orchestratorSource !== "lead_marker" &&
      orchestratorSource !== "pluto_fallback" &&
      orchestratorSource !== "teamlead_direct"
    ) {
      throw new Error(`worker_requested event for ${roleId} missing valid orchestratorSource`);
    }
    sourceByRole.set(roleId, orchestratorSource);
  }

  const distribution: Record<WorkerRequestedOrchestratorSource, number> = {
    lead_marker: 0,
    pluto_fallback: 0,
    teamlead_direct: 0,
  };
  const byRole: Record<string, WorkerRequestedOrchestratorSource> = {};

  for (const event of events) {
    if (event.type !== "worker_completed") continue;
    const roleId = String(event.roleId ?? event.payload["targetRole"] ?? "");
    if (!roleId) {
      throw new Error("worker_completed event missing roleId for orchestratorSource summary");
    }
    const orchestratorSource = sourceByRole.get(roleId);
    if (!orchestratorSource) {
      throw new Error(`worker_completed event for ${roleId} had no matching worker_requested orchestratorSource`);
    }
    distribution[orchestratorSource] += 1;
    byRole[roleId] = orchestratorSource;
  }

  const totalWorkers = Object.keys(byRole).length;
  if (totalWorkers === 0) {
    throw new Error("no completed workers were attributed to a worker_requested orchestratorSource");
  }

  return {
    byRole,
    distribution,
    totalWorkers,
    fallbackRatio: distribution.pluto_fallback / totalWorkers,
  };
}

async function preflight(): Promise<BlockerReport | null> {
  if (ADAPTER_KIND === "fake") return null;

  // Check for paseo CLI availability (required for paseo-opencode mode)
  // Respect PASEO_BIN env var (default: "paseo")
  const paseoBin = process.env["PASEO_BIN"] ?? "paseo";
  const paseoHost = normalizePaseoHostForCli(process.env["PASEO_HOST"]);
  const probe = await DEFAULT_RUNNER.exec(paseoBin, ["--version"]).catch((e) => ({
    stdout: "",
    stderr: String(e),
    exitCode: -1 as number | null,
  }));
  if (probe.exitCode !== 0) {
    return {
      status: "blocker",
      reason: "paseo CLI unavailable",
      hint: `Install ${paseoBin} on PATH or rerun with PLUTO_LIVE_ADAPTER=fake.`,
    };
  }

  if (paseoHost) {
    const daemonProbe = await DEFAULT_RUNNER.exec(
      paseoBin,
      ["provider", "ls", "--json", "--host", paseoHost],
    ).catch((e) => ({
      stdout: "",
      stderr: String(e),
      exitCode: -1 as number | null,
    }));
    if (daemonProbe.exitCode !== 0) {
      return {
        status: "blocker",
        reason: "paseo daemon unavailable",
        hint: `Could not reach Paseo daemon at PASEO_HOST=${paseoHost}. Check the daemon URL or unset PASEO_HOST for local socket mode.`,
      };
    }
  }

  // Check provider/model (defaults: opencode + opencode/minimax-m2.5-free).
  // Backward compatibility: if PASEO_PROVIDER is a provider/model string and
  // PASEO_MODEL is unset, normalize it to the split form used by the adapter.
  const requestedProvider = process.env["PASEO_PROVIDER"];
  const requestedModel = process.env["PASEO_MODEL"];
  const provider = !requestedModel && requestedProvider?.includes("/")
    ? requestedProvider.split("/")[0]
    : (requestedProvider ?? "opencode");
  if (!provider) {
    return {
      status: "blocker",
      reason: "PASEO_PROVIDER unset",
      hint: "Set PASEO_PROVIDER to a paseo provider alias (e.g. opencode).",
    };
  }

  const model = requestedModel ?? (requestedProvider?.includes("/") ? requestedProvider : "opencode/minimax-m2.5-free");
  if (!model) {
    return {
      status: "blocker",
      reason: "PASEO_MODEL unset",
      hint: "Set PASEO_MODEL to a model identifier (e.g. opencode/minimax-m2.5-free).",
    };
  }

  // OPENCODE_BASE_URL is optional - only needed for Docker/OpenCode HTTP debug endpoint
  // The local paseo → opencode CLI path does not require it
  const baseUrl = process.env["OPENCODE_BASE_URL"];
  if (paseoHost) {
    console.log(`[live-smoke] PASEO_HOST set: ${paseoHost} (explicit daemon host)`);
  } else {
    console.log(`[live-smoke] PASEO_HOST not set (using local daemon/socket)`);
  }

  if (baseUrl) {
    console.log(`[live-smoke] OPENCODE_BASE_URL set: ${baseUrl} (optional debug endpoint)`);
  } else {
    console.log(`[live-smoke] OPENCODE_BASE_URL not set (using local paseo → opencode CLI)`);
  }

  console.log(`[live-smoke] Using provider: ${provider}, model: ${model}`);

  return null;
}

async function main() {
  const workspaceSelection = await resolveLiveWorkspace();
  const WORKSPACE = workspaceSelection.path;
  const DATA_DIR = resolve(process.env["PLUTO_DATA_DIR"] ?? `${WORKSPACE}/.pluto`);
  const ARTIFACT_PATH = process.env["PLUTO_LIVE_ARTIFACT_PATH"] ?? `${WORKSPACE}/hello-pluto.md`;
  await mkdir(WORKSPACE, { recursive: true });

  const blocker = await preflight();
  if (blocker) {
    console.error(JSON.stringify(blocker, null, 2));
    process.exit(2);
  }

  const adapter: PaseoTeamAdapter =
    ADAPTER_KIND === "fake"
      ? new FakeAdapter({ team: DEFAULT_TEAM })
      : new PaseoOpenCodeAdapter({ workspaceCwd: WORKSPACE });

  const store = new RunStore({ dataDir: DATA_DIR });
  const service = new TeamRunService({
    adapter,
    team: DEFAULT_TEAM,
    store,
    timeoutMs: 8 * 60 * 1000,
    pumpIntervalMs: 250,
  });
  const selectedPlaybook = selectTeamPlaybook(DEFAULT_TEAM, REQUESTED_PLAYBOOK_ID);
  const expectedWorkerRoles = selectedPlaybook.stages.map((stage) => stage.roleId);

  const startedAt = Date.now();
  const result = await service.run({
    id: `live-smoke-${startedAt}`,
    title: "Pluto MVP-alpha hello team",
    prompt:
      "Produce a markdown file that says hello from the team lead, planner, generator, and evaluator (one line each).",
    workspacePath: WORKSPACE,
    artifactPath: ARTIFACT_PATH,
    minWorkers: 2,
    playbookId: selectedPlaybook.id,
    orchestrationMode: REQUESTED_ORCHESTRATION_MODE,
  });
  const runCompletedEvent = [...result.events].reverse().find((event) => event.type === "run_completed");
  const dependencyTrace = Array.isArray(runCompletedEvent?.payload["dependencyTrace"])
    ? runCompletedEvent?.payload["dependencyTrace"]
    : [];
  const revisions = Array.isArray(runCompletedEvent?.payload["revisions"])
    ? runCompletedEvent?.payload["revisions"]
    : [];
  const escalation = typeof runCompletedEvent?.payload["escalation"] === "object" && runCompletedEvent.payload["escalation"] !== null
    ? runCompletedEvent.payload["escalation"]
    : null;
  const finalReconciliation = typeof runCompletedEvent?.payload["finalReconciliation"] === "object" && runCompletedEvent.payload["finalReconciliation"] !== null
    ? runCompletedEvent.payload["finalReconciliation"]
    : null;

  let orchestratorSources: ReturnType<typeof summarizeOrchestratorSources>;
  try {
    orchestratorSources = summarizeOrchestratorSources(result.events);
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: error instanceof Error ? error.message : String(error),
          runId: result.runId,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  let summary: Record<string, unknown> = {
    runId: result.runId,
    status: result.status,
    elapsedMs: Date.now() - startedAt,
    workspace: workspaceSelection,
    orchestrationMode: REQUESTED_ORCHESTRATION_MODE,
    dependencyTrace,
    revisions,
    escalation,
    finalReconciliation,
    requestedPlaybookId: selectedPlaybook.id,
    expectedWorkerRoles,
    contributions: result.artifact?.contributions.map((c) => ({
      roleId: c.roleId,
      chars: c.output.length,
    })),
    artifactPath: `${store.runDir(result.runId)}/artifact.md`,
    eventsPath: `${store.runDir(result.runId)}/events.jsonl`,
    orchestratorSources,
  };

  // --- MVP-beta evidence assertions ---
  const evidenceMdPath = `${store.runDir(result.runId)}/evidence.md`;
  const evidenceJsonPath = `${store.runDir(result.runId)}/evidence.json`;

  if (!existsSync(evidenceMdPath) || !existsSync(evidenceJsonPath)) {
    console.error(
      JSON.stringify(
        { status: "assertion_failed", message: "evidence.md or evidence.json missing", summary },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const evidenceJsonRaw = await readFile(evidenceJsonPath, "utf8");
  const evidenceParsed: unknown = JSON.parse(evidenceJsonRaw);
  const evidenceValidation = validateEvidencePacketV0(evidenceParsed);
  if (!evidenceValidation.ok) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: `evidence.json does not validate against EvidencePacketV0: ${evidenceValidation.errors.join("; ")}`,
          summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const evidencePacket = evidenceParsed as EvidencePacketV0;
  if (!evidencePacket.orchestration?.playbookId || !evidencePacket.orchestration?.transcript?.path) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "playbook/transcript orchestration evidence missing",
          summary,
          orchestration: evidencePacket.orchestration ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (evidencePacket.orchestration.playbookId !== selectedPlaybook.id) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "evidence playbookId does not match selected playbook",
          summary,
          orchestration: evidencePacket.orchestration,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  summary = {
    ...summary,
    playbookId: evidencePacket.orchestration.playbookId,
    transcript: evidencePacket.orchestration.transcript,
    revisions: evidencePacket.orchestration.revisions ?? revisions,
    escalation: evidencePacket.orchestration.escalation ?? escalation,
    finalReconciliation: evidencePacket.orchestration.finalReconciliation ?? finalReconciliation,
  };
  if (
    REQUESTED_ORCHESTRATION_MODE === "teamlead_direct"
    && (!finalReconciliation || !Array.isArray((finalReconciliation as Record<string, unknown>)["citations"]) || (finalReconciliation as Record<string, unknown>)["valid"] !== true)
  ) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "teamlead_direct citation check did not report all required stage citations",
          summary,
          finalReconciliation,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (REQUIRE_CITATIONS && (summary["finalReconciliation"] as { valid?: boolean } | undefined)?.valid !== true) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "PASEO_REQUIRE_CITATIONS=1 but final reconciliation citations were invalid",
          summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (
    REQUESTED_ORCHESTRATION_MODE === "teamlead_direct"
    && dependencyTrace.map((entry) => (entry as { stageId?: string }).stageId).join(",")
      !== selectedPlaybook.stages.map((stage) => stage.id).join(",")
  ) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "teamlead_direct dependencyTrace is not in playbook topological order",
          summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (!existsSync(evidencePacket.orchestration.transcript.path)) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "coordination transcript path recorded in evidence does not exist",
          summary,
          transcript: evidencePacket.orchestration.transcript.path,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const evidenceClassification = classifyLiveSmokeEvidence(evidencePacket);

  const secretPatterns = [
    /\b(?:sk|pk)[_-][A-Za-z0-9_-]{16,}\b/i,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/,
    /\beyJ[A-Za-z0-9_-]{20,}/,
  ];
  const evidenceMdContent = await readFile(evidenceMdPath, "utf8");
  const allEvidenceContent = evidenceMdContent + evidenceJsonRaw;
  const leakedSecrets = secretPatterns.filter((p) => p.test(allEvidenceContent));
  if (leakedSecrets.length > 0) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "evidence files contain secret-shaped patterns",
          patterns: leakedSecrets.map((p) => p.source),
          summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if (evidenceClassification.outcome === "partial") {
    console.log(
      JSON.stringify(
        {
          status: "partial",
          reason: evidenceClassification.reason,
          summary,
          evidence: { md: evidenceMdPath, json: evidenceJsonPath, orchestration: evidencePacket.orchestration },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (evidenceClassification.outcome === "failed") {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          message: evidenceClassification.message,
          blockerReason: evidenceClassification.blockerReason,
          failure: result.failure?.message,
          summary,
          evidence: { md: evidenceMdPath, json: evidenceJsonPath, orchestration: evidencePacket.orchestration },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if (orchestratorSources.fallbackRatio > 0.5) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "more than 50% of completed workers were dispatched via pluto_fallback",
          summary,
          evidence: { md: evidenceMdPath, json: evidenceJsonPath },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if ((result.status === "failed") || !result.artifact) {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          message: "live smoke evidence reported done but run result is incomplete",
          failure: result.failure?.message,
          summary,
          evidence: { md: evidenceMdPath, json: evidenceJsonPath, orchestration: evidencePacket.orchestration },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const finalArtifact = result.artifact;

  // Assertions on the artifact content.
  const artifactMd = await readFile(`${store.runDir(result.runId)}/artifact.md`, "utf8");
  const requiredRoles = ["lead", ...expectedWorkerRoles];
  const missing = requiredRoles.filter((r) => !artifactMd.toLowerCase().includes(r));
  if (missing.length > 0) {
    console.error(
      JSON.stringify(
        { status: "assertion_failed", message: "artifact missing required roles", missing, summary },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const contributionRoles = finalArtifact.contributions.map((contribution) => contribution.roleId);
  if (contributionRoles.join(",") !== expectedWorkerRoles.join(",")) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "worker contributions do not match the selected playbook stages",
          contributionRoles,
          expectedWorkerRoles,
          summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if (
    REQUESTED_ORCHESTRATION_MODE === "teamlead_direct"
    && Object.values(orchestratorSources.byRole).some((value) => value !== "teamlead_direct")
  ) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "teamlead_direct run emitted non-teamlead_direct worker_requested source",
          summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const leakedProtocol = finalArtifact.contributions.filter((c) =>
    c.output.includes("Instructions from the Team Lead:") ||
    c.output.includes("Reply with your contribution only"),
  );
  if (leakedProtocol.length > 0) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "worker output leaked adapter prompt protocol",
          roles: leakedProtocol.map((c) => c.roleId),
          summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(JSON.stringify({ status: "ok", summary, evidence: { md: evidenceMdPath, json: evidenceJsonPath, orchestration: evidencePacket.orchestration } }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
