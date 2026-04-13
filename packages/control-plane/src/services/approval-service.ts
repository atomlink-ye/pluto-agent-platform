import crypto from "node:crypto"

import type { ApprovalActionClass, ApprovalDecision, EventSource } from "@pluto-agent-platform/contracts"

import type { ApprovalRecord, ApprovalRepository, RunEventRepository } from "../repositories.js"
import type { RunService } from "./run-service.js"

export interface ApprovalCreateInput {
  runId: string
  actionClass: ApprovalActionClass
  title: string
  requestedBy: ApprovalRecord["requested_by"]
  context?: ApprovalRecord["context"]
}

const toEventSource = (source: string): EventSource => {
  if (
    source === "system" ||
    source === "orchestrator" ||
    source === "session" ||
    source === "operator" ||
    source === "policy"
  ) {
    return source
  }

  return "system"
}

export class ApprovalService {
  constructor(
    private readonly approvalRepository: ApprovalRepository,
    private readonly runService: RunService,
    private readonly runEventRepository: RunEventRepository,
  ) {}

  async createApproval({
    runId,
    actionClass,
    title,
    requestedBy,
    context,
  }: ApprovalCreateInput): Promise<ApprovalRecord> {
    const timestamp = new Date().toISOString()
    const approval: ApprovalRecord = {
      kind: "approval",
      id: `appr_${crypto.randomUUID()}`,
      run_id: runId,
      action_class: actionClass,
      title,
      status: "pending",
      requested_by: structuredClone(requestedBy),
      context: context ? structuredClone(context) : undefined,
      resolution: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const savedApproval = await this.approvalRepository.save(approval)

    await this.runService.transition(runId, "waiting_approval")

    await this.runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "approval.requested",
      occurredAt: timestamp,
      source: toEventSource(requestedBy.source),
      phase: context?.phase ?? null,
      stageId: context?.stage_id ?? null,
      sessionId: requestedBy.session_id ?? null,
      roleId: requestedBy.role_id ?? null,
      payload: {
        approvalId: savedApproval.id,
        actionClass: savedApproval.action_class,
        title: savedApproval.title,
        reason: savedApproval.context?.reason,
      },
    })

    return savedApproval
  }

  async resolve(
    approvalId: string,
    decision: ApprovalDecision,
    resolvedBy: string,
    note?: string,
  ): Promise<ApprovalRecord> {
    const approval = await this.approvalRepository.getById(approvalId)

    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`)
    }

    const approvals = await this.approvalRepository.listByRunId(approval.run_id)
    const pendingApproval = approvals.find(
      (candidate) => candidate.id === approvalId && candidate.status === "pending",
    )

    if (!pendingApproval) {
      throw new Error(`No pending approval exists for run: ${approval.run_id}`)
    }

    const timestamp = new Date().toISOString()
    const updatedApproval: ApprovalRecord = {
      ...pendingApproval,
      status: decision,
      resolution: {
        resolved_at: timestamp,
        resolved_by: resolvedBy,
        decision,
        note,
      },
      updatedAt: timestamp,
    }

    const savedApproval = await this.approvalRepository.update(updatedApproval)

    await this.runService.transition(
      pendingApproval.run_id,
      decision === "approved" ? "running" : "failed",
      decision === "approved"
        ? undefined
        : {
            failureReason: `approval denied: ${pendingApproval.id}`,
          },
    )

    await this.runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId: pendingApproval.run_id,
      eventType: "approval.resolved",
      occurredAt: timestamp,
      source: "operator",
      phase: pendingApproval.context?.phase ?? null,
      stageId: pendingApproval.context?.stage_id ?? null,
      sessionId: pendingApproval.requested_by.session_id ?? null,
      roleId: pendingApproval.requested_by.role_id ?? null,
      payload: {
        approvalId: savedApproval.id,
        decision,
        resolvedBy,
        note,
      },
    })

    return savedApproval
  }
}
