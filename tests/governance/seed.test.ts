import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  validatePlaybookRecordV0,
  validateScheduleRecordV0,
  validateScenarioRecordV0,
} from "@/contracts/governance.js";
import { GovernanceStore } from "@/governance/governance-store.js";
import {
  DEFAULT_GOVERNANCE_SEED_IDS,
  seedDefaultGovernanceFixtures,
} from "@/governance/seed.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-governance-seed-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("seedDefaultGovernanceFixtures", () => {
  it("writes deterministic, schema-valid playbook, scenario, and schedule fixtures", async () => {
    const store = new GovernanceStore({ dataDir });

    const seeded = await seedDefaultGovernanceFixtures(store);

    expect(seeded.playbook.id).toBe(DEFAULT_GOVERNANCE_SEED_IDS.playbookId);
    expect(seeded.scenario.id).toBe(DEFAULT_GOVERNANCE_SEED_IDS.scenarioId);
    expect(seeded.schedules.map((schedule) => schedule.id)).toEqual([
      DEFAULT_GOVERNANCE_SEED_IDS.scheduleId,
    ]);

    expect(validatePlaybookRecordV0(seeded.playbook)).toEqual({ ok: true, value: seeded.playbook });
    expect(validateScenarioRecordV0(seeded.scenario)).toEqual({ ok: true, value: seeded.scenario });
    expect(validateScheduleRecordV0(seeded.schedules[0])).toEqual({ ok: true, value: seeded.schedules[0] });

    expect(await store.get("playbook", seeded.playbook.id)).toEqual(seeded.playbook);
    expect(await store.get("scenario", seeded.scenario.id)).toEqual(seeded.scenario);
    expect(await store.get("schedule", seeded.schedules[0].id)).toEqual(seeded.schedules[0]);
    expect((await store.list("playbook")).map((record) => record.id)).toEqual([
      DEFAULT_GOVERNANCE_SEED_IDS.playbookId,
    ]);
    expect((await store.list("scenario")).map((record) => record.id)).toEqual([
      DEFAULT_GOVERNANCE_SEED_IDS.scenarioId,
    ]);
    expect((await store.list("schedule")).map((record) => record.id)).toEqual([
      DEFAULT_GOVERNANCE_SEED_IDS.scheduleId,
    ]);
  });

  it("is idempotent for repeated seeding", async () => {
    const store = new GovernanceStore({ dataDir });

    const first = await seedDefaultGovernanceFixtures(store);
    const second = await seedDefaultGovernanceFixtures(store);

    expect(second).toEqual(first);
    expect(await store.list("playbook")).toHaveLength(1);
    expect(await store.list("scenario")).toHaveLength(1);
    expect(await store.list("schedule")).toHaveLength(1);
  });
});
