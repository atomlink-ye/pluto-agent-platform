import type { AgentRoleId, TeamConfig, TeamPlaybookV0, TeamPlaybookValidationResultV0 } from "../contracts/types.js";

export const DEFAULT_TEAM_PLAYBOOK_ID = "teamlead-direct-default-v0";
export const RESEARCH_REVIEW_PLAYBOOK_ID = "teamlead-direct-research-review-v0";

export const DEFAULT_TEAM_PLAYBOOK_V0: TeamPlaybookV0 = {
  schemaVersion: 0,
  id: DEFAULT_TEAM_PLAYBOOK_ID,
  title: "Default planner → generator → evaluator",
  description: "TeamLead directs planner, then generator consumes planner output, then evaluator reviews generator output.",
  orchestrationSource: "teamlead_direct",
  stages: [
    {
      id: "planner-contract",
      kind: "plan",
      roleId: "planner",
      title: "Planner contract",
      instructions: "Produce a concise plan/contract for the requested artifact, including acceptance criteria and risks.",
      dependsOn: [],
      evidenceCitation: { required: true, label: "planner contract" },
    },
    {
      id: "generator-output",
      kind: "generate",
      roleId: "generator",
      title: "Generator output",
      instructions: "Generate or implement the artifact using the planner contract as the upstream input.",
      dependsOn: ["planner-contract"],
      evidenceCitation: { required: true, label: "generator output" },
    },
    {
      id: "evaluator-verdict",
      kind: "evaluate",
      roleId: "evaluator",
      title: "Evaluator verdict",
      instructions: "Evaluate the generator output against the planner contract and task acceptance criteria. Start with PASS: or FAIL:.",
      dependsOn: ["generator-output"],
      evidenceCitation: { required: true, label: "evaluator verdict" },
    },
  ],
  revisionRules: [
    {
      fromStageId: "evaluator-verdict",
      targetStageId: "generator-output",
      maxRevisionCycles: 1,
      failureSignal: "FAIL:",
    },
  ],
  finalCitationMetadata: {
    requiredStageIds: ["planner-contract", "generator-output", "evaluator-verdict"],
    requireFinalReconciliation: true,
  },
};

export const RESEARCH_REVIEW_PLAYBOOK_V0: TeamPlaybookV0 = {
  schemaVersion: 0,
  id: RESEARCH_REVIEW_PLAYBOOK_ID,
  title: "Research with independent review",
  description: "A non-default playbook proving TeamRunService can select authored playbook data without per-playbook control-flow edits.",
  orchestrationSource: "teamlead_direct",
  stages: [
    {
      id: "research-brief",
      kind: "research",
      roleId: "planner",
      title: "Research brief",
      instructions: "Research the task and produce a concise brief with cited assumptions and open questions.",
      dependsOn: [],
      evidenceCitation: { required: true, label: "research brief" },
    },
    {
      id: "research-review",
      kind: "evaluate",
      roleId: "evaluator",
      title: "Research review",
      instructions: "Review the research brief for completeness and decision usefulness. Start with PASS: or FAIL:.",
      dependsOn: ["research-brief"],
      evidenceCitation: { required: true, label: "research review" },
    },
  ],
  revisionRules: [
    {
      fromStageId: "research-review",
      targetStageId: "research-brief",
      maxRevisionCycles: 1,
      failureSignal: "FAIL:",
    },
  ],
  finalCitationMetadata: {
    requiredStageIds: ["research-brief", "research-review"],
    requireFinalReconciliation: true,
  },
};

export const DEFAULT_TEAM_PLAYBOOKS_V0 = [DEFAULT_TEAM_PLAYBOOK_V0, RESEARCH_REVIEW_PLAYBOOK_V0] as const;

export function selectTeamPlaybook(team: TeamConfig, requestedId?: string): TeamPlaybookV0 {
  const playbooks = team.playbooks?.length ? team.playbooks : [...DEFAULT_TEAM_PLAYBOOKS_V0];
  const selectedId = requestedId ?? team.defaultPlaybookId ?? DEFAULT_TEAM_PLAYBOOK_ID;
  const playbook = playbooks.find((candidate) => candidate.id === selectedId);
  if (!playbook) {
    throw new Error(`team_playbook_not_found:${selectedId}`);
  }
  const validation = validateTeamPlaybookV0(playbook, team);
  if (!validation.ok) {
    throw new Error(`team_playbook_invalid:${playbook.id}:${validation.errors.join(";")}`);
  }
  return playbook;
}

export function validateTeamPlaybookV0(playbook: TeamPlaybookV0, team?: TeamConfig): TeamPlaybookValidationResultV0 {
  const errors: string[] = [];
  if (playbook.schemaVersion !== 0) errors.push("schemaVersion must be 0");
  if (!playbook.id.trim()) errors.push("id is required");
  if (!Array.isArray(playbook.stages) || playbook.stages.length === 0) errors.push("stages must be non-empty");

  const stageIds = new Set<string>();
  const roleIds = new Set<AgentRoleId>(team?.roles.map((role) => role.id) ?? ["lead", "planner", "generator", "evaluator"]);
  for (const [index, stage] of playbook.stages.entries()) {
    const path = `stages[${index}]`;
    if (!stage.id.trim()) errors.push(`${path}.id is required`);
    if (stageIds.has(stage.id)) errors.push(`${path}.id duplicate:${stage.id}`);
    stageIds.add(stage.id);
    if (!roleIds.has(stage.roleId)) errors.push(`${path}.roleId unknown:${stage.roleId}`);
    if (stage.roleId === "lead") errors.push(`${path}.roleId must be a worker role`);
    if (!Array.isArray(stage.dependsOn)) errors.push(`${path}.dependsOn must be an array`);
    if (!stage.evidenceCitation?.label) errors.push(`${path}.evidenceCitation.label is required`);
  }

  for (const stage of playbook.stages) {
    for (const dep of stage.dependsOn) {
      if (!stageIds.has(dep)) errors.push(`stage ${stage.id} depends on unknown stage ${dep}`);
      if (dep === stage.id) errors.push(`stage ${stage.id} cannot depend on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(playbook.stages.map((stage) => [stage.id, stage]));
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`dependency cycle includes ${id}`);
      return;
    }
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const stage of playbook.stages) visit(stage.id);

  for (const rule of playbook.revisionRules ?? []) {
    if (!stageIds.has(rule.fromStageId)) errors.push(`revisionRules.fromStageId unknown:${rule.fromStageId}`);
    if (!stageIds.has(rule.targetStageId)) errors.push(`revisionRules.targetStageId unknown:${rule.targetStageId}`);
    if (!Number.isInteger(rule.maxRevisionCycles) || rule.maxRevisionCycles < 0) errors.push("revisionRules.maxRevisionCycles must be >= 0");
  }

  for (const required of playbook.finalCitationMetadata.requiredStageIds ?? []) {
    if (!stageIds.has(required)) errors.push(`finalCitationMetadata.requiredStageIds unknown:${required}`);
  }

  return { ok: errors.length === 0, errors };
}
