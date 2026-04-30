import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentEvent,
  BlockerReasonV0,
  EvidencePacketStatusV0,
  EvidencePacketV0,
  TeamRunResult,
  TeamTask,
} from "../contracts/types.js";
import { normalizeBlockerReason } from "./blocker-classifier.js";
import {
  redactObject,
  redactString,
  redactWorkspacePath as redactCanonicalWorkspacePath,
} from "./redactor.js";

export function redactSecrets(text: string): string {
  return redactString(text);
}

export function redactEventPayload(payload: unknown): unknown {
  return redactObject(payload);
}

export function redactWorkspacePath(workspacePath: string): string {
  return redactCanonicalWorkspacePath(workspacePath);
}

export function redactEvidencePacketV0(packet: EvidencePacketV0): EvidencePacketV0 {
  return redactObject(packet) as EvidencePacketV0;
}

export type EvidencePacketValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

const REQUIRED_TOP_LEVEL_FIELDS = [
  "schemaVersion",
  "runId",
  "taskTitle",
  "status",
  "blockerReason",
  "startedAt",
  "finishedAt",
  "workspace",
  "workers",
  "validation",
  "citedInputs",
  "risks",
  "openQuestions",
  "classifierVersion",
  "generatedAt",
] as const;

function hasOwnProperty(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validateStringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      errors.push(`${path}[${index}] must be a string`);
    }
  });
}

export function validateEvidencePacketV0(packet: unknown): EvidencePacketValidationResult {
  const errors: string[] = [];

  if (typeof packet !== "object" || packet === null) {
    return { ok: false, errors: ["packet must be an object"] };
  }

  const p = packet as Record<string, unknown>;
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!hasOwnProperty(p, field)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (p["schemaVersion"] !== 0) errors.push("schemaVersion must be 0");
  if (typeof p["runId"] !== "string") errors.push("runId must be a string");
  if (typeof p["taskTitle"] !== "string") errors.push("taskTitle must be a string");
  if (!["done", "blocked", "failed"].includes(p["status"] as string)) {
    errors.push("status must be one of done, blocked, failed");
  }

  if (p["blockerReason"] !== null) {
    if (typeof p["blockerReason"] !== "string") {
      errors.push("blockerReason must be a string or null");
    } else if (normalizeBlockerReason(p["blockerReason"]) === "unknown" && p["blockerReason"] !== "unknown") {
      errors.push("blockerReason must be a canonical or legacy-normalizable blocker reason");
    }
  }

  if (typeof p["startedAt"] !== "string") errors.push("startedAt must be a string");
  if (typeof p["finishedAt"] !== "string") errors.push("finishedAt must be a string");
  if (p["workspace"] !== null && typeof p["workspace"] !== "string") {
    errors.push("workspace must be a string or null");
  }

  if (!Array.isArray(p["workers"])) {
    errors.push("workers must be an array");
  } else {
    for (const [index, workerValue] of p["workers"].entries()) {
      if (typeof workerValue !== "object" || workerValue === null) {
        errors.push(`workers[${index}] must be an object`);
        continue;
      }

      const worker = workerValue as Record<string, unknown>;
      if (typeof worker["role"] !== "string") {
        errors.push(`workers[${index}].role must be a string`);
      }
      if (worker["sessionId"] !== null && typeof worker["sessionId"] !== "string") {
        errors.push(`workers[${index}].sessionId must be a string or null`);
      }
      if (typeof worker["contributionSummary"] !== "string") {
        errors.push(`workers[${index}].contributionSummary must be a string`);
      }
      if (worker["tokenUsageApprox"] !== null && typeof worker["tokenUsageApprox"] !== "number") {
        errors.push(`workers[${index}].tokenUsageApprox must be a number or null`);
      }
      if (worker["durationMsApprox"] !== null && typeof worker["durationMsApprox"] !== "number") {
        errors.push(`workers[${index}].durationMsApprox must be a number or null`);
      }
    }
  }

  if (typeof p["validation"] !== "object" || p["validation"] === null) {
    errors.push("validation must be an object");
  } else {
    const validation = p["validation"] as Record<string, unknown>;
    if (!["pass", "fail", "na"].includes(validation["outcome"] as string)) {
      errors.push("validation.outcome must be one of pass, fail, na");
    }
    if (validation["reason"] !== null && typeof validation["reason"] !== "string") {
      errors.push("validation.reason must be a string or null");
    }
  }

  if (typeof p["citedInputs"] !== "object" || p["citedInputs"] === null) {
    errors.push("citedInputs must be an object");
  } else {
    const citedInputs = p["citedInputs"] as Record<string, unknown>;
    if (typeof citedInputs["taskPrompt"] !== "string") {
      errors.push("citedInputs.taskPrompt must be a string");
    }
    validateStringArray(citedInputs["workspaceMarkers"], "citedInputs.workspaceMarkers", errors);
  }

  validateStringArray(p["risks"], "risks", errors);
  validateStringArray(p["openQuestions"], "openQuestions", errors);

  if (p["classifierVersion"] !== 0) errors.push("classifierVersion must be 0");
  if (typeof p["generatedAt"] !== "string") errors.push("generatedAt must be a string");

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
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
      contributionSummary: redactString(info.output.slice(0, 500) || ""),
      tokenUsageApprox: null,
      durationMsApprox: null,
    }),
  );

  const validation = extractValidation(events);
  const { risks, openQuestions } = extractRisksAndQuestions(events);

  const packet: EvidencePacketV0 = {
    schemaVersion: 0,
    runId: result.runId,
    taskTitle: redactString(task.title),
    status: mapStatus(result, blockerReason),
    blockerReason,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    workspace: redactCanonicalWorkspacePath(task.workspacePath) || null,
    workers,
    validation: {
      outcome: validation.outcome,
      reason: validation.reason ? redactString(validation.reason) : null,
    },
    citedInputs: {
      taskPrompt: redactString(task.prompt),
      workspaceMarkers: [],
    },
    risks: risks.map((risk) => redactString(risk)),
    openQuestions: openQuestions.map((q) => redactString(q)),
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
  return redactString(lines.join("\n"));
}

export async function writeEvidence(
  runDir: string,
  packet: EvidencePacketV0,
): Promise<{ mdPath: string; jsonPath: string }> {
  const mdPath = join(runDir, "evidence.md");
  const jsonPath = join(runDir, "evidence.json");
  const redactedPacket = redactEvidencePacketV0(packet);
  const validation = validateEvidencePacketV0(redactedPacket);
  if (!validation.ok) {
    throw new Error(`evidence_packet_invalid: ${validation.errors.join("; ")}`);
  }

  try {
    await writeFile(mdPath, renderEvidenceMarkdown(redactedPacket), "utf8");
    await writeFile(jsonPath, JSON.stringify(redactedPacket, null, 2) + "\n", "utf8");
  } catch (cause) {
    await Promise.all([
      rm(mdPath, { force: true }).catch(() => {}),
      rm(jsonPath, { force: true }).catch(() => {}),
    ]);
    throw cause;
  }

  return { mdPath, jsonPath };
}
