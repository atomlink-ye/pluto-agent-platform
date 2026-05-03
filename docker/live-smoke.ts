#!/usr/bin/env tsx
/**
 * Pluto MVP-alpha live smoke.
 *
 * Runs the checked-in four-layer scenario/run-profile through the manager-run
 * harness and asserts:
 *   - The Team Lead session was created.
 *   - The canonical evidence packet was written.
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
import { join, resolve } from "node:path";
import { constants, existsSync } from "node:fs";
import * as process from "node:process";

import { FakeAdapter } from "../src/adapters/fake/index.js";
import { PaseoOpenCodeAdapter } from "../src/adapters/paseo-opencode/index.js";
import { DEFAULT_RUNNER } from "../src/adapters/paseo-opencode/process-runner.js";
import { normalizeBlockerReason, runManagerHarness, validateEvidencePacketV0 } from "../src/orchestrator/index.js";
import type { EvidencePacket } from "../src/contracts/four-layer.js";
import type {
  AgentEvent,
  BlockerReasonV0,
  EvidencePacketV0,
} from "../src/contracts/types.js";

function normalizePaseoHostForCli(host: string | undefined): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^https?:\/\//i, "");
}

const REQUESTED_SCENARIO = process.env["PLUTO_SCENARIO"] ?? "hello-team";
const REQUESTED_RUN_PROFILE = process.env["PLUTO_RUN_PROFILE"] ?? "fake-smoke";
const REQUESTED_PLAYBOOK = process.env["PLUTO_PLAYBOOK"];
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

function summarizeDispatchEvents(events: AgentEvent[]) {
  const trackedTypes = [
    "spawn_request_received",
    "spawn_request_executed",
    "worker_complete_received",
    "final_reconciliation_received",
  ] as const;
  const relevant = events.filter((event) => trackedTypes.includes(event.type as typeof trackedTypes[number]));
  const counts = Object.fromEntries(trackedTypes.map((type) => [type, relevant.filter((event) => event.type === type).length]));
  const sources = Array.from(new Set(
    relevant
      .map((event) => event.payload["orchestrationSource"])
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ));
  return { counts, sources };
}

function extractTransportMessageId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "messageId", "transportMessageId"]) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key] as string;
    }
  }
  return null;
}

function extractTransportMessages(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
  }
  if (typeof payload === "object" && payload !== null && Array.isArray((payload as Record<string, unknown>)["messages"])) {
    return ((payload as Record<string, unknown>)["messages"] as unknown[])
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
  }
  return [];
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

  const expectedWorkerRoles = ["planner", "generator", "evaluator"];

  const startedAt = Date.now();
  const result = await runManagerHarness({
    rootDir: process.cwd(),
    selection: {
      scenario: REQUESTED_SCENARIO,
      runProfile: REQUESTED_RUN_PROFILE,
      ...(REQUESTED_PLAYBOOK ? { playbook: REQUESTED_PLAYBOOK } : {}),
      runtimeTask: "Produce a markdown file that says hello from the lead, planner, generator, and evaluator (one line each).",
    },
    workspaceOverride: WORKSPACE,
    dataDir: DATA_DIR,
    createAdapter: ({ team, workspaceCwd }) => ADAPTER_KIND === "fake"
      ? new FakeAdapter({ team })
      : new PaseoOpenCodeAdapter({ workspaceCwd }),
  });

  const expectedDispatchSource = process.env["PLUTO_DISPATCH_MODE"] === "static_loop" ? "static_loop" : "teamlead_chat";
  const dispatchSummary = summarizeDispatchEvents(result.legacyResult.events);

  let summary: Record<string, unknown> = {
    runId: result.run.runId,
    status: result.run.status,
    elapsedMs: Date.now() - startedAt,
    workspace: workspaceSelection,
    scenario: REQUESTED_SCENARIO,
    runProfile: REQUESTED_RUN_PROFILE,
    requestedPlaybook: REQUESTED_PLAYBOOK ?? null,
    expectedWorkerRoles,
    contributions: result.legacyResult.artifact?.contributions.map((c) => ({
      roleId: c.roleId,
      chars: c.output.length,
    })),
    artifactPath: result.artifactPath,
    eventsPath: `${result.runDir}/events.jsonl`,
    dispatchSummary,
    expectedDispatchSource,
  };

  // --- MVP-beta evidence assertions ---
  const evidenceMdPath = `${result.runDir}/evidence.md`;
  const evidenceJsonPath = `${result.runDir}/evidence.json`;
  const evidencePacketPath = result.canonicalEvidencePath;

  if (!existsSync(evidenceMdPath) || !existsSync(evidenceJsonPath) || !existsSync(evidencePacketPath)) {
    console.error(
      JSON.stringify(
        { status: "assertion_failed", message: "evidence.md, evidence.json, or evidence-packet.json missing", summary },
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
  const canonicalEvidenceRaw = await readFile(evidencePacketPath, "utf8");
  const canonicalEvidence = JSON.parse(canonicalEvidenceRaw) as EvidencePacket;
  summary = {
    ...summary,
    playbookId: evidencePacket.orchestration.playbookId,
    transcript: evidencePacket.orchestration.transcript,
    canonicalStatus: canonicalEvidence.status,
    transitions: canonicalEvidence.transitions ?? [],
    roleCitations: canonicalEvidence.roleCitations ?? [],
  };
  if ((canonicalEvidence.transitions?.length ?? 0) < 4) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "canonical evidence packet recorded too few transitions",
          summary,
          evidencePacket: canonicalEvidence,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (!canonicalEvidence.roleCitations?.some((citation) => citation.role === "planner")
    || !canonicalEvidence.roleCitations?.some((citation) => citation.role === "generator")
    || !canonicalEvidence.roleCitations?.some((citation) => citation.role === "evaluator")) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "canonical evidence packet missing required role citations",
          summary,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (!canonicalEvidence.lineage?.transcriptPath || !existsSync(canonicalEvidence.lineage.transcriptPath)) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "canonical evidence packet transcript path missing or unreadable",
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
  if (!result.run.coordinationChannel?.locator || result.run.coordinationChannel.locator.startsWith("mailbox:")) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "run coordination channel locator was not replaced with a real room id",
          summary,
          coordinationChannel: result.run.coordinationChannel ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (canonicalEvidence.coordinationChannel?.locator !== result.run.coordinationChannel.locator) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "canonical evidence coordination channel locator does not match the run coordination channel",
          summary,
          coordinationChannel: canonicalEvidence.coordinationChannel ?? null,
          runCoordinationChannel: result.run.coordinationChannel,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (evidencePacket.orchestration.transcript.roomRef !== result.run.coordinationChannel.locator) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "legacy evidence transcript roomRef does not match the run coordination channel locator",
          summary,
          transcript: evidencePacket.orchestration.transcript,
          runCoordinationChannel: result.run.coordinationChannel,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const mailboxJsonlPath = result.run.coordinationChannel.path ?? `${result.runDir}/mailbox.jsonl`;
  const eventsPath = `${result.runDir}/events.jsonl`;
  const runEvents = (await readFile(eventsPath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AgentEvent);
  const mailboxEntries = (await readFile(mailboxJsonlPath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  const deliverableMailboxEntries = mailboxEntries.filter((entry) => {
    const to = entry["to"];
    return typeof to === "string" && to !== "pluto" && to !== "broadcast";
  });
  if (mailboxEntries.length === 0) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "mailbox.jsonl is empty",
          summary,
          mailboxJsonlPath,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const mirroredTransportIds = mailboxEntries
    .filter((entry) => entry["transportStatus"] === "ok" && typeof entry["transportMessageId"] === "string")
    .map((entry) => String(entry["transportMessageId"]));
  if (mirroredTransportIds.length !== mailboxEntries.length) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "mailbox.jsonl entries are missing transport metadata",
          summary,
          mailboxJsonlPath,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const deliveredEvents = runEvents.filter((event) => event.type === "mailbox_message_delivered");
  const queuedEvents = runEvents.filter((event) => event.type === "mailbox_message_queued");
  const deliveredTransportIds = new Set(
    deliveredEvents
      .map((event) => event.payload["transportMessageId"])
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  if (deliveredEvents.length === 0) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "events.jsonl is missing mailbox_message_delivered evidence",
          summary,
          eventsPath,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (deliveredEvents.length !== deliverableMailboxEntries.length) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "deliverable mailbox entries and delivered event count diverged",
          summary,
          mailboxJsonlPath,
          deliverableMailboxMessageCount: deliverableMailboxEntries.length,
          deliveredEventCount: deliveredEvents.length,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const planApprovalRequest = mailboxEntries.find((entry) => entry["kind"] === "plan_approval_request");
  const planApprovalResponse = mailboxEntries.find((entry) => entry["kind"] === "plan_approval_response");
  if (!planApprovalRequest || !planApprovalResponse) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "mailbox.jsonl is missing the plan-approval round-trip messages",
          summary,
          mailboxJsonlPath,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const requestTransportId = typeof planApprovalRequest["transportMessageId"] === "string"
    ? planApprovalRequest["transportMessageId"]
    : null;
  const responseTransportId = typeof planApprovalResponse["transportMessageId"] === "string"
    ? planApprovalResponse["transportMessageId"]
    : null;
  if (!requestTransportId || !responseTransportId || !deliveredTransportIds.has(requestTransportId) || !deliveredTransportIds.has(responseTransportId)) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "plan-approval round-trip is missing delivery evidence in events.jsonl",
          summary,
          eventsPath,
          requestTransportId,
          responseTransportId,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (!runEvents.some((event) => event.type === "plan_approval_requested") || !runEvents.some((event) => event.type === "plan_approval_responded")) {
    console.error(
      JSON.stringify(
        {
          status: "assertion_failed",
          message: "events.jsonl is missing plan_approval_requested/plan_approval_responded evidence",
          summary,
          eventsPath,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  let liveChatParity: { checked: boolean; messageCount: number; roomRef: string } = {
    checked: false,
    messageCount: mirroredTransportIds.length,
    roomRef: result.run.coordinationChannel.locator,
  };
  if (ADAPTER_KIND === "paseo-opencode") {
    const paseoBin = process.env["PASEO_BIN"] ?? "paseo";
    const paseoHost = normalizePaseoHostForCli(process.env["PASEO_HOST"]);
    const chatRead = await DEFAULT_RUNNER.exec(
      paseoBin,
      [
        "chat",
        "read",
        "--since",
        result.run.startedAt ?? new Date(startedAt).toISOString(),
        "--json",
        ...(paseoHost ? ["--host", paseoHost] : []),
        result.run.coordinationChannel.locator,
      ],
    );
    if (chatRead.exitCode !== 0) {
      console.error(
        JSON.stringify(
          {
            status: "assertion_failed",
            message: "paseo chat read failed during live parity verification",
            summary,
            stderr: chatRead.stderr,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    const liveMessages = extractTransportMessages(JSON.parse(chatRead.stdout));
    const liveTransportIds = liveMessages
      .map((message) => extractTransportMessageId(message))
      .filter((messageId): messageId is string => Boolean(messageId));
    if (JSON.stringify(liveTransportIds) !== JSON.stringify(mirroredTransportIds)) {
      console.error(
        JSON.stringify(
          {
            status: "assertion_failed",
            message: "live paseo chat transcript does not match mailbox mirror transport order",
            summary,
            mirroredTransportIds,
            liveTransportIds,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    liveChatParity = {
      checked: true,
      messageCount: liveTransportIds.length,
      roomRef: result.run.coordinationChannel.locator,
    };
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
          failure: result.legacyResult.failure?.message,
          summary,
          evidence: { md: evidenceMdPath, json: evidenceJsonPath, orchestration: evidencePacket.orchestration },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if ((result.legacyResult.status === "failed") || !result.legacyResult.artifact) {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          message: "live smoke evidence reported done but run result is incomplete",
          failure: result.legacyResult.failure?.message,
          summary,
          evidence: { md: evidenceMdPath, json: evidenceJsonPath, orchestration: evidencePacket.orchestration },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const finalArtifact = result.legacyResult.artifact;
  summary = {
    ...summary,
    coordinationChannel: result.run.coordinationChannel,
    mailboxJsonlPath,
    mailboxMessageCount: deliverableMailboxEntries.length,
    mirroredMailboxMessageCount: mailboxEntries.length,
    deliveryEvents: {
      delivered: deliveredEvents.length,
      queued: queuedEvents.length,
    },
    liveChatParity,
  };

  // Assertions on the artifact content.
  const artifactMd = await readFile(join(WORKSPACE, "artifact.md"), "utf8");
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

  const dispatchEvents = runEvents.filter((event) =>
    event.type === "spawn_request_received"
    || event.type === "spawn_request_executed"
    || event.type === "worker_complete_received"
    || event.type === "final_reconciliation_received",
  );
  if (expectedDispatchSource === "teamlead_chat") {
    const requiredDispatchTypes = ["spawn_request_received", "spawn_request_executed", "worker_complete_received", "final_reconciliation_received"] as const;
    for (const requiredType of requiredDispatchTypes) {
      if (!dispatchEvents.some((event) => event.type === requiredType)) {
        console.error(
          JSON.stringify(
            {
              status: "assertion_failed",
              message: `events.jsonl is missing ${requiredType} evidence`,
              summary,
              eventsPath,
            },
            null,
            2,
          ),
        );
        process.exit(1);
      }
    }
    if (dispatchEvents.some((event) => event.payload["orchestrationSource"] !== "teamlead_chat")) {
      console.error(
        JSON.stringify(
          {
            status: "assertion_failed",
            message: "dispatch events are missing orchestrationSource: teamlead_chat",
            summary,
            eventsPath,
            dispatchEvents: dispatchEvents.map((event) => ({ type: event.type, payload: event.payload })),
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
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
