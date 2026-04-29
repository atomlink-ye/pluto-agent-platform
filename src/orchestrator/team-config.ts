import type { TeamConfig } from "../contracts/types.js";

/**
 * MVP-alpha static team. The lead must dispatch every other role at least once.
 */
export const DEFAULT_TEAM: TeamConfig = {
  id: "default-mvp-alpha",
  name: "Default Pluto MVP-alpha team",
  leadRoleId: "lead",
  roles: [
    {
      id: "lead",
      name: "Team Lead",
      kind: "team_lead",
      systemPrompt: [
        "You are the Team Lead for a Pluto MVP-alpha team task.",
        "You MUST orchestrate work by dispatching at least two workers.",
        "Do not write the planner, generator, or evaluator outputs yourself.",
        "Always call planner first, then generator, then evaluator.",
        "After workers respond, summarize their contributions into the final artifact.",
        "The final artifact MUST cite each worker by role and include their findings.",
      ].join(" "),
    },
    {
      id: "planner",
      name: "Planner",
      kind: "worker",
      systemPrompt: [
        "You are the Planner worker. Output a short bullet-list plan that satisfies the team's goal.",
        "Stop when you have produced the plan. Do not implement.",
      ].join(" "),
    },
    {
      id: "generator",
      name: "Generator",
      kind: "worker",
      systemPrompt: [
        "You are the Generator worker. Given the team's goal and the planner's plan, produce the concrete artifact body.",
        "Keep output focused and limited to the goal.",
      ].join(" "),
    },
    {
      id: "evaluator",
      name: "Evaluator",
      kind: "worker",
      systemPrompt: [
        "You are the Evaluator worker. Verify the generator's artifact against the team goal.",
        "Output a single line that begins with 'PASS:' or 'FAIL:' followed by a one-sentence rationale.",
      ].join(" "),
    },
  ],
};

export function getRole(team: TeamConfig, id: string) {
  const role = team.roles.find((r) => r.id === id);
  if (!role) {
    throw new Error(`role_not_found:${id}`);
  }
  return role;
}
