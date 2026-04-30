import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { DEFAULT_TEAM, getRoleCatalogSelection } from "@/orchestrator/team-config.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import type { TeamTask } from "@/contracts/types.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-provenance-service-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function makeTask(): TeamTask {
  return {
    id: "catalog-provenance-task",
    title: "Catalog provenance task",
    prompt: "Produce a deterministic artifact.",
    workspacePath: workDir,
    minWorkers: 2,
  };
}

describe("TeamRunService catalog provenance pins", () => {
  it("copies the selected catalog versions onto worker contributions", async () => {
    const store = new RunStore({ dataDir: join(workDir, ".pluto") });
    const service = new TeamRunService({
      adapter: new FakeAdapter({ team: DEFAULT_TEAM }),
      team: DEFAULT_TEAM,
      store,
      pumpIntervalMs: 1,
      timeoutMs: 5_000,
    });

    const result = await service.run(makeTask());

    expect(result.status).toBe("completed");

    for (const contribution of result.artifact?.contributions ?? []) {
      const selection = getRoleCatalogSelection(DEFAULT_TEAM, contribution.roleId);
      expect(selection).not.toBeNull();
      expect(contribution.workerRoleRef).toEqual(selection?.workerRole);
      expect(contribution.skillRef).toEqual(selection?.skill);
      expect(contribution.templateRef).toEqual(selection?.template);
      expect(contribution.catalogEntryRef).toEqual(selection?.entry);
      expect(contribution.policyPackRefs).toEqual(
        selection?.policyPack ? [selection.policyPack] : undefined,
      );
      expect(contribution.extensionInstallRef).toBeUndefined();
    }
  });
});
