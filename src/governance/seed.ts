import type {
  PlaybookRecordV0,
  ScheduleRecordV0,
  ScenarioRecordV0,
} from "../contracts/governance.js";
import { GovernanceStore } from "./governance-store.js";

export const DEFAULT_GOVERNANCE_SEED_IDS = {
  playbookId: "playbook-default-governance",
  scenarioId: "scenario-default-governance",
  scheduleId: "schedule-default-governance-weekly",
} as const;

export const DEFAULT_GOVERNANCE_SEED_WORKSPACE_ID = "workspace-default-governance";
export const DEFAULT_GOVERNANCE_SEED_OWNER_ID = "owner-default-governance";
export const DEFAULT_GOVERNANCE_SEED_TIMESTAMP = "2026-04-30T00:00:00.000Z";

export interface GovernanceSeedOptions {
  workspaceId?: string;
  ownerId?: string;
}

export interface SeededGovernanceFixturesV0 {
  playbook: PlaybookRecordV0;
  scenario: ScenarioRecordV0;
  schedules: [ScheduleRecordV0];
}

export function createDefaultGovernanceFixtures(
  opts: GovernanceSeedOptions = {},
): SeededGovernanceFixturesV0 {
  const workspaceId = opts.workspaceId ?? DEFAULT_GOVERNANCE_SEED_WORKSPACE_ID;
  const ownerId = opts.ownerId ?? DEFAULT_GOVERNANCE_SEED_OWNER_ID;

  const playbook: PlaybookRecordV0 = {
    schemaVersion: 0,
    kind: "playbook",
    id: DEFAULT_GOVERNANCE_SEED_IDS.playbookId,
    workspaceId,
    title: "Default governance playbook",
    ownerId,
    createdAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    updatedAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    status: "active",
  };

  const scenario: ScenarioRecordV0 = {
    schemaVersion: 0,
    kind: "scenario",
    id: DEFAULT_GOVERNANCE_SEED_IDS.scenarioId,
    workspaceId,
    playbookId: playbook.id,
    title: "Default governance scenario",
    ownerId,
    createdAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    updatedAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    status: "ready",
  };

  const schedule: ScheduleRecordV0 = {
    schemaVersion: 0,
    kind: "schedule",
    id: DEFAULT_GOVERNANCE_SEED_IDS.scheduleId,
    workspaceId,
    playbookId: playbook.id,
    scenarioId: scenario.id,
    ownerId,
    cadence: "0 9 * * 1",
    createdAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    updatedAt: DEFAULT_GOVERNANCE_SEED_TIMESTAMP,
    status: "active",
  };

  return {
    playbook,
    scenario,
    schedules: [schedule],
  };
}

export async function seedDefaultGovernanceFixtures(
  store: GovernanceStore,
  opts: GovernanceSeedOptions = {},
): Promise<SeededGovernanceFixturesV0> {
  const fixtures = createDefaultGovernanceFixtures(opts);

  await store.put("playbook", fixtures.playbook);
  await store.put("scenario", fixtures.scenario);

  for (const schedule of fixtures.schedules) {
    await store.put("schedule", schedule);
  }

  return fixtures;
}
