import type {
  MailboxMessage,
  PlanApprovalRequestBody,
  PlanApprovalResponseBody,
} from "../contracts/four-layer.js";
import { isPlanApprovalRequest, isPlanApprovalResponse } from "./message-guards.js";

export { isPlanApprovalRequest } from "./message-guards.js";

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

export function isTrustedPlanApprovalResponse(
  message: MailboxMessage,
  trustedSender: string,
): message is MailboxMessage & { body: PlanApprovalResponseBody } {
  return isPlanApprovalResponse(message) && message.from === trustedSender;
}
