import { describe, expect, it } from "vitest";

import { GOVERNANCE_EVENT_TYPES_V0 } from "@/audit/event-types.js";
import { DECISION_EVENTS_V0 } from "@/contracts/review.js";
import { PUBLISH_ATTEMPT_STATUSES_V0, ROLLBACK_ACTIONS_V0 } from "@/contracts/publish.js";
import {
  QA_GATE_KINDS_V0,
  RELEASE_READINESS_STATUSES_V0,
  WAIVER_STATUSES_V0,
} from "@/contracts/release.js";
import type {
  AgentEventType,
  EvidencePacketV0,
  RunsEventV0,
  RunsListItemV0,
  TeamRunResult,
  WorkerRequestedOrchestratorSource,
  WorkerRequestedPayload,
} from "@/contracts/types.js";

describe("event vocabulary compatibility", () => {
  it("keeps existing runtime and evidence vocabularies unchanged while adding governance audit events", () => {
    const agentEventTypes: AgentEventType[] = [
      "run_started",
      "lead_started",
      "worker_requested",
      "worker_started",
      "worker_completed",
      "lead_message",
      "worker_message",
      "orchestrator_underdispatch_fallback",
      "revision_started",
      "revision_completed",
      "escalation",
      "final_reconciliation_validated",
      "final_reconciliation_invalid",
      "artifact_created",
      "blocker",
      "retry",
      "run_completed",
      "run_failed",
    ];
    const runStatuses: TeamRunResult["status"][] = [
      "completed",
      "completed_with_escalation",
      "completed_with_warnings",
      "failed",
    ];
    const runsListStatuses: RunsListItemV0["status"][] = ["queued", "running", "blocked", "failed", "done"];
    const evidenceStatuses: EvidencePacketV0["status"][] = ["done", "blocked", "failed"];
    const runsEventKinds: RunsEventV0["kind"][] = [];
    const workerRequestedSources: WorkerRequestedOrchestratorSource[] = [
      "lead_marker",
      "pluto_fallback",
      "teamlead_direct",
    ];
    const workerRequestedPayload: WorkerRequestedPayload = {
      targetRole: "planner",
      instructions: "Plan the artifact.",
      orchestratorSource: "lead_marker",
      source: "legacy_marker_fallback",
    };

    expect(agentEventTypes).toEqual([
      "run_started",
      "lead_started",
      "worker_requested",
      "worker_started",
      "worker_completed",
      "lead_message",
      "worker_message",
      "orchestrator_underdispatch_fallback",
      "revision_started",
      "revision_completed",
      "escalation",
      "final_reconciliation_validated",
      "final_reconciliation_invalid",
      "artifact_created",
      "blocker",
      "retry",
      "run_completed",
      "run_failed",
    ]);
    expect(runStatuses).toEqual([
      "completed",
      "completed_with_escalation",
      "completed_with_warnings",
      "failed",
    ]);
    expect(runsListStatuses).toEqual(["queued", "running", "blocked", "failed", "done"]);
    expect(evidenceStatuses).toEqual(["done", "blocked", "failed"]);
    expect(runsEventKinds).toEqual([]);
    expect(workerRequestedSources).toEqual([
      "lead_marker",
      "pluto_fallback",
      "teamlead_direct",
    ]);
    expect(workerRequestedPayload).toMatchObject({
      targetRole: "planner",
      orchestratorSource: "lead_marker",
    });

    expect(DECISION_EVENTS_V0).toEqual([
      "requested",
      "commented",
      "changes_requested",
      "approved",
      "rejected",
      "revoked",
      "delegated",
      "expired",
    ]);
    expect(PUBLISH_ATTEMPT_STATUSES_V0).toEqual(["queued", "blocked", "succeeded", "failed"]);
    expect(ROLLBACK_ACTIONS_V0).toEqual(["rollback", "retract", "supersede"]);
    expect(WAIVER_STATUSES_V0).toEqual(["draft", "approved", "expired", "revoked"]);
    expect(RELEASE_READINESS_STATUSES_V0).toEqual(["pending", "ready", "blocked"]);
    expect(QA_GATE_KINDS_V0).toEqual(["test", "eval", "manual_check", "artifact_check"]);
    expect(GOVERNANCE_EVENT_TYPES_V0).toEqual([
      "review_requested",
      "decision_recorded",
      "approval_granted",
      "approval_rejected",
      "approval_revoked",
      "delegation_changed",
      "package_assembled",
      "export_sealed",
      "publish_attempted",
      "rollback_recorded",
      "retract_recorded",
      "supersede_recorded",
      "waiver_approved",
      "waiver_revoked",
      "readiness_evaluated",
    ]);
  });
});
