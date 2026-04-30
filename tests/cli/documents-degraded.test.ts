import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApprovalRecordV0, DocumentRecordV0, VersionRecordV0 } from "@/contracts/governance.js";
import { GovernanceStore } from "@/governance/governance-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec(
      "npx",
      ["tsx", join(process.cwd(), "src/cli/documents.ts"), ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PLUTO_DATA_DIR: dataDir,
          PLUTO_RUNTIME_AVAILABLE: "false",
        },
        timeout: 10_000,
      },
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-documents-cli-degraded-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("pnpm documents degraded views", () => {
  it("renders governance detail and degraded action reasons when runtime is unavailable", async () => {
    const store = new GovernanceStore({ dataDir });
    const baseRecord = {
      schemaVersion: 0 as const,
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
    };
    const document: DocumentRecordV0 = {
      ...baseRecord,
      kind: "document",
      id: "doc-1",
      title: "Governance Seed",
      ownerId: "owner-1",
      currentVersionId: "ver-2",
      status: "active",
    };
    const version: VersionRecordV0 = {
      ...baseRecord,
      kind: "version",
      id: "ver-2",
      documentId: document.id,
      createdById: "owner-1",
      label: "v2",
      status: "ready",
    };
    const approval: ApprovalRecordV0 = {
      ...baseRecord,
      kind: "approval",
      id: "approval-1",
      documentId: document.id,
      versionId: version.id,
      requestedById: "owner-1",
      approverId: "approver-1",
      status: "approved",
    };

    await store.put("document", document);
    await store.put("version", version);
    await store.put("approval", approval);

    const { stdout, exitCode } = await runCli(["show", "doc-1", "--json"]);
    expect(exitCode).toBe(0);

    expect(JSON.parse(stdout)).toEqual({
      schemaVersion: 0,
      item: {
        schemaVersion: 0,
        pageState: "degraded",
        governanceStatus: "active",
        document: {
          schemaVersion: 0,
          kind: "document",
          id: "doc-1",
          workspaceId: "workspace-1",
          createdAt: "2026-04-30T00:00:00.000Z",
          updatedAt: "2026-04-30T00:00:01.000Z",
          status: "active",
          title: "Governance Seed",
          ownerId: "owner-1",
          currentVersionId: "ver-2",
          governanceStatus: "active",
        },
        currentVersion: {
          schemaVersion: 0,
          kind: "version",
          id: "ver-2",
          workspaceId: "workspace-1",
          createdAt: "2026-04-30T00:00:00.000Z",
          updatedAt: "2026-04-30T00:00:01.000Z",
          status: "ready",
          documentId: "doc-1",
          createdById: "owner-1",
          label: "v2",
          governanceStatus: "ready",
        },
        reviews: [],
        approvals: [
          {
            schemaVersion: 0,
            kind: "approval",
            id: "approval-1",
            workspaceId: "workspace-1",
            createdAt: "2026-04-30T00:00:00.000Z",
            updatedAt: "2026-04-30T00:00:01.000Z",
            status: "approved",
            documentId: "doc-1",
            versionId: "ver-2",
            requestedById: "owner-1",
            approverId: "approver-1",
            governanceStatus: "ready",
          },
        ],
        publishPackages: [],
        evidence: [],
        recentRuns: [],
      },
      actions: {
        requestReview: {
          enabled: false,
          state: "degraded",
          reason: "runtime_unavailable",
        },
        publish: {
          enabled: false,
          state: "disabled",
          reason: "evidence_missing",
        },
      },
    });
  });
});
