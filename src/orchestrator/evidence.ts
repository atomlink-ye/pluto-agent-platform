import { writeFile } from "node:fs/promises";
import { isAbsolute, join, win32 } from "node:path";
import type {
  AgentEvent,
  BlockerReasonV0,
  EvidencePacketStatusV0,
  EvidencePacketV0,
  TeamRunResult,
  TeamTask,
} from "../contracts/types.js";
import { normalizeBlockerReason } from "./blocker-classifier.js";

const SECRET_PATTERNS = [
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, // JWT-like
  /\b(?:sk|pk)[_-][A-Za-z0-9_-]{16,}\b/gi, // sk-ant-*, pk-* prefixed keys
  /\b(?:api|key|token|secret|bearer|auth)[_-]?[A-Za-z0-9]{16,}\b/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /\bxoxb-[A-Za-z0-9-]+\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}/g, // Base64-encoded JWT prefixes
];

const ENV_KEY_VALUE_RE = /\b([A-Z][A-Z0-9_]*(?:_TOKEN|_KEY|_SECRET|_PASSWORD|_CREDENTIAL|_API_KEY))\s*=\s*\S+/gi;
const KNOWN_SECRET_ENV_NAMES = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENCODE_API_KEY",
  "OPENROUTER_API_KEY",
  "DAYTONA_API_KEY",
];

export function redactSecrets(text: string): string {
  let result = text;

  for (const name of KNOWN_SECRET_ENV_NAMES) {
    const envVal = process.env[name];
    if (envVal && envVal.length > 4) {
      result = result.replaceAll(envVal, `[REDACTED:${name}]`);
    }
  }

  result = result.replace(ENV_KEY_VALUE_RE, (_match, key: string) => `${key}=[REDACTED]`);

  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), "[REDACTED]");
  }

  return result;
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactUnknown(item)]),
    );
  }
  return value;
}

export function redactEventPayload(payload: unknown): unknown {
  return redactUnknown(payload);
}

export function redactWorkspacePath(workspacePath: string): string {
  const redacted = redactSecrets(workspacePath);
  if (isAbsolute(redacted) || win32.isAbsolute(redacted)) return "[REDACTED:workspace-path]";
  return redacted;
}

export function redactEvidencePacketV0(packet: EvidencePacketV0): EvidencePacketV0 {
  return redactUnknown(packet) as EvidencePacketV0;
}

export function validateEvidencePacketV0(packet: unknown): packet is EvidencePacketV0 {
  if (typeof packet !== "object" || packet === null) return false;
  const p = packet as Record<string, unknown>;

  if (p["schemaVersion"] !== 0) return false;
  if (typeof p["runId"] !== "string") return false;
  if (typeof p["taskTitle"] !== "string") return false;
  if (!["done", "blocked", "failed"].includes(p["status"] as string)) return false;
  if (p["blockerReason"] !== null && typeof p["blockerReason"] !== "string") return false;
  if (typeof p["startedAt"] !== "string") return false;
  if (typeof p["finishedAt"] !== "string") return false;
  if (p["workspace"] !== null && typeof p["workspace"] !== "string") return false;
  if (!Array.isArray(p["workers"])) return false;
  if (typeof p["validation"] !== "object" || p["validation"] === null) return false;
  if (typeof p["citedInputs"] !== "object" || p["citedInputs"] === null) return false;
  if (!Array.isArray(p["risks"])) return false;
  if (!Array.isArray(p["openQuestions"])) return false;
  if (p["classifierVersion"] !== 0) return false;
  if (typeof p["generatedAt"] !== "string") return false;

  const validation = p["validation"] as Record<string, unknown>;
  if (!["pass", "fail", "na"].includes(validation["outcome"] as string)) return false;

  const citedInputs = p["citedInputs"] as Record<string, unknown>;
  if (typeof citedInputs["taskPrompt"] !== "string") return false;
  if (!Array.isArray(citedInputs["workspaceMarkers"])) return false;

  for (const w of p["workers"] as unknown[]) {
    if (typeof w !== "object" || w === null) return false;
    const worker = w as Record<string, unknown>;
    if (typeof worker["role"] !== "string") return false;
    if (typeof worker["contributionSummary"] !== "string") return false;
  }

  return true;
}

export interface GenerateEvidenceInput {
  task: TeamTask;
  result: TeamRunResult;
  events: AgentEvent[];
  startedAt: Date;
  finishedAt: Date;
  blockerReason: BlockerReasonV0 | null;
}

function mapStatus(result: TeamRunResult, blockerReason: BlockerReasonV0 | null): EvidencePacketStatusV0 {
  if (result.status === "completed" && !blockerReason) return "done";
  if (blockerReason) return "blocked";
  return "failed";
}

function extractValidation(events: AgentEvent[]): EvidencePacketV0["validation"] {
  const evalEvents = events.filter(
    (e) => e.roleId === "evaluator" && e.type === "worker_completed",
  );
  if (evalEvents.length === 0) return { outcome: "na", reason: null };

  const lastEval = evalEvents[evalEvents.length - 1]!;
  const output = String(lastEval.payload?.["output"] ?? "");
  if (output.startsWith("PASS:")) {
    return { outcome: "pass", reason: output.slice(5).trim() || null };
  }
  if (output.startsWith("FAIL:")) {
    return { outcome: "fail", reason: output.slice(5).trim() || null };
  }
  return { outcome: "na", reason: null };
}

function extractRisksAndQuestions(events: AgentEvent[]): { risks: string[]; openQuestions: string[] } {
  const risks: string[] = [];
  const openQuestions: string[] = [];

  for (const ev of events) {
    if (ev.roleId === "evaluator" && ev.type === "worker_completed") {
      const output = String(ev.payload?.["output"] ?? "");
      if (output.includes("FAIL:")) {
        risks.push(output.replace(/^FAIL:\s*/, "").trim());
      }
    }
  }

  return { risks, openQuestions };
}

export function generateEvidencePacket(input: GenerateEvidenceInput): EvidencePacketV0 {
  const { task, result, events, startedAt, finishedAt } = input;
  const blockerReason = normalizeBlockerReason(input.blockerReason);

  const workerEvents = events.filter(
    (e) => e.type === "worker_started" || e.type === "worker_completed",
  );
  const workerMap = new Map<string, { sessionId: string | null; output: string }>();
  for (const ev of workerEvents) {
    const role = String(ev.roleId ?? "");
    if (!role) continue;
    const existing = workerMap.get(role) ?? { sessionId: null, output: "" };
    if (ev.type === "worker_started") {
      existing.sessionId = ev.sessionId ?? null;
    } else if (ev.type === "worker_completed") {
      existing.output = String(ev.payload?.["output"] ?? "");
    }
    workerMap.set(role, existing);
  }

  const workers: EvidencePacketV0["workers"] = Array.from(workerMap.entries()).map(
    ([role, info]) => ({
      role,
      sessionId: info.sessionId,
      contributionSummary: redactSecrets(info.output.slice(0, 500) || ""),
      tokenUsageApprox: null,
      durationMsApprox: null,
    }),
  );

  const validation = extractValidation(events);
  const { risks, openQuestions } = extractRisksAndQuestions(events);

  const packet: EvidencePacketV0 = {
    schemaVersion: 0,
    runId: result.runId,
    taskTitle: redactSecrets(task.title),
    status: mapStatus(result, blockerReason),
    blockerReason,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    workspace: redactWorkspacePath(task.workspacePath) || null,
    workers,
    validation: {
      outcome: validation.outcome,
      reason: validation.reason ? redactSecrets(validation.reason) : null,
    },
    citedInputs: {
      taskPrompt: redactSecrets(task.prompt),
      workspaceMarkers: [],
    },
    risks: risks.map((risk) => redactSecrets(risk)),
    openQuestions: openQuestions.map((q) => redactSecrets(q)),
    classifierVersion: 0,
    generatedAt: new Date().toISOString(),
  };

  return packet;
}

export function renderEvidenceMarkdown(packet: EvidencePacketV0): string {
  const lines: string[] = [];
  lines.push(`# Evidence Packet — ${packet.runId}`);
  lines.push("");
  lines.push(`- **Status:** ${packet.status}`);
  if (packet.blockerReason) {
    lines.push(`- **Blocker:** ${packet.blockerReason}`);
  }
  lines.push(`- **Task:** ${packet.taskTitle}`);
  lines.push(`- **Started:** ${packet.startedAt}`);
  lines.push(`- **Finished:** ${packet.finishedAt}`);
  if (packet.workspace) {
    lines.push(`- **Workspace:** ${packet.workspace}`);
  }
  lines.push("");
  lines.push("## Workers");
  lines.push("");
  for (const w of packet.workers) {
    lines.push(`### ${w.role}`);
    lines.push(`- Session: ${w.sessionId ?? "n/a"}`);
    lines.push(`- Contribution: ${w.contributionSummary || "(none)"}`);
    lines.push("");
  }
  lines.push("## Validation");
  lines.push(`- Outcome: ${packet.validation.outcome}`);
  if (packet.validation.reason) {
    lines.push(`- Reason: ${packet.validation.reason}`);
  }
  lines.push("");
  if (packet.risks.length > 0) {
    lines.push("## Risks");
    for (const r of packet.risks) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }
  if (packet.openQuestions.length > 0) {
    lines.push("## Open Questions");
    for (const q of packet.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }
  lines.push("## Cited Inputs");
  lines.push(`- Prompt: ${packet.citedInputs.taskPrompt}`);
  if (packet.citedInputs.workspaceMarkers.length > 0) {
    lines.push(`- Workspace markers: ${packet.citedInputs.workspaceMarkers.join(", ")}`);
  }
  lines.push("");
  lines.push(`---`);
  lines.push(`Schema version: ${packet.schemaVersion} | Classifier version: ${packet.classifierVersion} | Generated: ${packet.generatedAt}`);
  lines.push("");
  return redactSecrets(lines.join("\n"));
}

export async function writeEvidence(
  runDir: string,
  packet: EvidencePacketV0,
): Promise<{ mdPath: string; jsonPath: string }> {
  const mdPath = join(runDir, "evidence.md");
  const jsonPath = join(runDir, "evidence.json");
  const redactedPacket = redactEvidencePacketV0(packet);
  await writeFile(mdPath, renderEvidenceMarkdown(redactedPacket), "utf8");
  await writeFile(jsonPath, JSON.stringify(redactedPacket, null, 2) + "\n", "utf8");
  return { mdPath, jsonPath };
}
