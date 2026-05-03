import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { EvidencePacket } from "@/contracts/four-layer.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mailbox external write audit", () => {
  it("records a mailbox audit event in the evidence packet without aborting the run", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-mailbox-audit-"));
    const dataDir = join(workspace, ".pluto");
    tempDirs.push(workspace);
    let mutated = false;

    const result = await runManagerHarness({
      rootDir: repoRoot,
      selection: { scenario: "hello-team", runProfile: "fake-smoke" },
      workspaceOverride: workspace,
      dataDir,
      createAdapter: ({ team }) => new FakeAdapter({ team }),
      onPhase: async (phase, details) => {
        if (phase !== "before_hook_boundary" || details["hookBoundary"] !== "run_end" || mutated) return;
        mutated = true;
        await appendFile(String(details["mailboxPath"]), JSON.stringify({
          id: "external-mailbox-write",
          to: "lead",
          from: "external-writer",
          createdAt: "2026-05-02T00:00:02.000Z",
          kind: "text",
          summary: "EXTERNAL",
          body: "Injected between hook boundaries",
        }) + "\n", "utf8");
      },
    });

    expect(result.run.status).toBe("succeeded");
    const packet = JSON.parse(await readFile(result.canonicalEvidencePath, "utf8")) as EvidencePacket;
    expect(packet.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mailbox_external_write_detected", hookBoundary: "run_end" }),
    ]));
  });
});
