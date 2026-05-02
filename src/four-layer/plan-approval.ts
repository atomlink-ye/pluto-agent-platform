import type {
  MailboxMessage,
  PlanApprovalRequestBody,
  PlanApprovalResponseBody,
} from "../contracts/four-layer.js";

export function createPlanApprovalRequest(input: {
  plan: string;
  requestedMode: string;
  taskId?: string;
}): PlanApprovalRequestBody {
  return {
    plan: input.plan,
    requestedMode: input.requestedMode,
    ...(input.taskId ? { taskId: input.taskId } : {}),
  };
}

export function createPlanApprovalResponse(input: {
  approved: boolean;
  mode: string;
  feedback?: string;
  taskId?: string;
}): PlanApprovalResponseBody {
  return {
    approved: input.approved,
    mode: input.mode,
    ...(input.feedback ? { feedback: input.feedback } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
  };
}

export function isPlanApprovalRequest(message: MailboxMessage): message is MailboxMessage & { body: PlanApprovalRequestBody } {
  return message.kind === "plan_approval_request" && typeof message.body === "object" && message.body !== null;
}

export function isTrustedPlanApprovalResponse(
  message: MailboxMessage,
  trustedSender: string,
): message is MailboxMessage & { body: PlanApprovalResponseBody } {
  return message.kind === "plan_approval_response"
    && message.from === trustedSender
    && typeof message.body === "object"
    && message.body !== null;
}
