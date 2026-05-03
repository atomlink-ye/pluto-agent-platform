import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  AgentEvent,
  BlockerReasonV0,
  CoordinationTranscriptRefV0,
  TeamRunResult,
  TeamTask,
} from "../../contracts/types.js";
import type {
  EvidenceAuditEvent,
  EvidenceCommandResult,
  EvidenceRoleCitation,
  EvidenceTransition,
  Run,
} from "../../contracts/four-layer.js";
import type { AcceptanceCheckResult } from "../../four-layer/acceptance-runner.js";
import type { AuditMiddlewareResult } from "../../four-layer/audit-middleware.js";
import { aggregateEvidencePacket, writeEvidencePacket } from "../../four-layer/index.js";
import { generateEvidencePacket, writeEvidence } from "../evidence.js";
import { RunStore } from "../run-store.js";

export interface CommandExecutionResult extends EvidenceCommandResult {
  stdout: string;
  stderr: string;
}

export interface ManagerRunHarnessResult {
  run: Run;
  legacyResult: TeamRunResult;
  runDir: string;
  workspaceDir: string;
  artifactPath: string | null;
  canonicalEvidencePath: string;
  legacyEvidencePath: string;
  stdoutPath: string;
  finalReportPath: string;
}

export interface FinishManagerHarnessFailureInput {
  run: Run;
  runDir: string;
  workspaceDir: string;
  artifactPath: string | null;
  collected: AgentEvent[];
  task: TeamTask;
  issues: string[];
  blockerReason: BlockerReasonV0 | null;
  clock: () => Date;
  store: RunStore;
  mailboxRef: CoordinationTranscriptRefV0;
  commandResults: CommandExecutionResult[];
  transitions: EvidenceTransition[];
  roleCitations: EvidenceRoleCitation[];
  auditEvents: EvidenceAuditEvent[];
  acceptance: AcceptanceCheckResult;
  audit: AuditMiddlewareResult;
}

export async function finishManagerHarnessFailure(input: FinishManagerHarnessFailureInput): Promise<ManagerRunHarnessResult> {
  input.run.status = "failed";
  input.run.finishedAt = input.clock().toISOString();
  const legacyResult: TeamRunResult = {
    runId: input.run.runId,
    status: "failed",
    events: input.collected,
    blockerReason: input.blockerReason,
    failure: { message: input.issues.join("; ") || "manager run failed" },
  };
  const stdoutPath = join(input.runDir, "stdout.log");
  await mkdir(dirname(stdoutPath), { recursive: true });
  await writeFile(stdoutPath, input.issues.join("\n") + "\n", "utf8");
  const legacyEvidence = generateEvidencePacket({
    task: input.task,
    result: legacyResult,
    events: input.collected,
    startedAt: new Date(input.run.startedAt ?? input.clock().toISOString()),
    finishedAt: new Date(input.run.finishedAt),
    blockerReason: input.blockerReason,
    transcriptRef: input.mailboxRef,
  });
  await writeEvidence(input.runDir, legacyEvidence);
  const canonicalEvidence = await writeEvidencePacket(input.runDir, aggregateEvidencePacket({
    run: input.run,
    failureReason: input.issues.join("; "),
    issues: input.issues,
    commandResults: input.commandResults,
    transitions: input.transitions,
    roleCitations: input.roleCitations,
    auditEvents: input.auditEvents,
    stdoutPath,
    transcriptPath: input.mailboxRef.path,
    mailboxLogPath: input.mailboxRef.path,
    taskListPath: join(input.runDir, "tasks.json"),
    acceptance: input.acceptance,
    audit: input.audit,
  }));
  return {
    run: input.run,
    legacyResult,
    runDir: input.runDir,
    workspaceDir: input.workspaceDir,
    artifactPath: input.artifactPath,
    canonicalEvidencePath: canonicalEvidence.jsonPath,
    legacyEvidencePath: join(input.runDir, "evidence.json"),
    stdoutPath,
    finalReportPath: join(input.runDir, "final-report.md"),
  };
}
