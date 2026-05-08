import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const tempDirs: string[] = [];
const SPEC_PATH = join(process.cwd(), "packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml");
const AGENTIC_SPEC_PATH = join(process.cwd(), "packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-mock/scenario.yaml");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createFakePaseoBin(rootDir: string): Promise<string> {
  const binPath = join(rootDir, "paseo.cjs");
  const script = [
    "#!/usr/bin/env node",
    'const { mkdirSync, readFileSync, writeFileSync, existsSync } = require("node:fs");',
    'const { dirname, join } = require("node:path");',
    'const args = process.argv.slice(2);',
    'const stateDir = process.env.PASEO_FAKE_STATE_DIR;',
    'if (!stateDir) throw new Error("PASEO_FAKE_STATE_DIR is required");',
    'mkdirSync(stateDir, { recursive: true });',
    'const command = args[0];',
    'const agentPath = (agentId) => join(stateDir, `${agentId}.json`);',
    'const readAgent = (agentId) => existsSync(agentPath(agentId)) ? JSON.parse(readFileSync(agentPath(agentId), "utf8")) : { transcript: "" };',
    'const writeAgent = (agentId, state) => { mkdirSync(dirname(agentPath(agentId)), { recursive: true }); writeFileSync(agentPath(agentId), JSON.stringify(state), "utf8"); };',
    'const extractPrompt = (raw) => { const match = raw.match(/```json\\s*([\\s\\S]*?)```/); return match ? match[1].trim() : raw.trim(); };',
    'const turnIndexFor = (directive) => { try { const parsed = JSON.parse(directive); if (parsed.kind === "create_task") return 0; if (parsed.kind === "publish_artifact") return 2; if (parsed.kind === "append_mailbox_message") return 3; if (parsed.kind === "complete_run") return 5; if (parsed.kind === "change_task_state" && parsed.payload && parsed.payload.to === "running") return 1; if (parsed.kind === "change_task_state" && parsed.payload && parsed.payload.to === "completed") return 4; } catch {} return 99; };',
    'const appendTranscript = (agentId, promptText) => { const directive = extractPrompt(promptText); const prefix = `[assistant turn ${turnIndexFor(directive)}]\\n`; const prior = readAgent(agentId).transcript; const next = prior ? `${prior}\\n${prefix}${directive}` : `${prefix}${directive}`; writeAgent(agentId, { transcript: next }); };',
    'if (command === "run") { const titleIndex = args.indexOf("--title"); const title = titleIndex >= 0 ? args[titleIndex + 1] : "unknown"; const agentId = `fake-${title}`; appendTranscript(agentId, args.at(-1) ?? ""); process.stdout.write(JSON.stringify({ agentId })); process.exit(0); }',
    'if (command === "send") { const agentId = args[1]; const promptFile = args[args.indexOf("--prompt-file") + 1]; appendTranscript(agentId, readFileSync(promptFile, "utf8")); process.exit(0); }',
    'if (command === "wait") { process.stdout.write(JSON.stringify({ exitCode: 0 })); process.exit(0); }',
    'if (command === "logs") { const agentId = args[1]; process.stdout.write(readAgent(agentId).transcript ?? ""); process.exit(0); }',
    'if (command === "inspect") { process.stdout.write(JSON.stringify({ usage: { inputTokens: 12, outputTokens: 6, costUsd: 0.01 } })); process.exit(0); }',
    'if (command === "delete") { process.exit(0); }',
    'process.stderr.write(`unsupported fake paseo command: ${command}\\n`);',
    'process.exit(1);',
  ].join("\n");

  await writeFile(binPath, script, "utf8");
  await chmod(binPath, 0o755);
  return binPath;
}

async function createAgenticFakePaseoBin(rootDir: string): Promise<string> {
  const binPath = join(rootDir, "paseo-agentic.cjs");
  const script = [
    "#!/usr/bin/env node",
    'const { mkdirSync, readFileSync, writeFileSync, existsSync } = require("node:fs");',
    'const { dirname, join } = require("node:path");',
    'const args = process.argv.slice(2);',
    'const stateDir = process.env.PASEO_FAKE_STATE_DIR;',
    'if (!stateDir) throw new Error("PASEO_FAKE_STATE_DIR is required");',
    'mkdirSync(stateDir, { recursive: true });',
    'const command = args[0];',
    'const agentPath = (agentId) => join(stateDir, `${agentId}.json`);',
    'const readAgent = (agentId) => existsSync(agentPath(agentId)) ? JSON.parse(readFileSync(agentPath(agentId), "utf8")) : { transcript: "", promptCount: 0 };',
    'const writeAgent = (agentId, state) => { mkdirSync(dirname(agentPath(agentId)), { recursive: true }); writeFileSync(agentPath(agentId), JSON.stringify(state), "utf8"); };',
    'const logicalTitle = (title) => title.startsWith("pluto-") ? title.slice("pluto-".length) : title;',
    'const nextDirective = (title, promptCount) => { const actor = logicalTitle(title);',
    '  if (actor === "role:lead" && promptCount === 0) return { kind: "create_task", payload: { title: "Draft the runtime change", ownerActor: { kind: "role", role: "generator" }, dependsOn: [] } };',
    '  if (actor === "role:generator" && promptCount === 0) return { kind: "append_mailbox_message", payload: { fromActor: { kind: "role", role: "generator" }, toActor: { kind: "role", role: "lead" }, kind: "completion", body: "Generator completed the draft." } };',
    '  if (actor === "role:lead" && promptCount === 1) return { kind: "complete_run", payload: { status: "succeeded", summary: "Agentic mock run completed." } };',
    '  return { kind: "complete_run", payload: { status: "failed", summary: `Unexpected agent turn for ${title} #${promptCount}` } };',
    '};',
    "const appendTranscript = (agentId, title) => { const state = readAgent(agentId); const directive = nextDirective(title, state.promptCount); const transcriptText = `\\`\\`\\`json\\n${JSON.stringify(directive)}\\n\\`\\`\\`\\n`; const nextTranscript = state.transcript ? `${state.transcript}${transcriptText}` : transcriptText; writeAgent(agentId, { transcript: nextTranscript, promptCount: state.promptCount + 1 }); };",
    'if (command === "run") { const titleIndex = args.indexOf("--title"); const title = titleIndex >= 0 ? args[titleIndex + 1] : "unknown"; const agentId = `fake-${title}`; appendTranscript(agentId, title); process.stdout.write(JSON.stringify({ agentId })); process.exit(0); }',
    'if (command === "send") { const agentId = args[1]; const title = agentId.slice("fake-".length); appendTranscript(agentId, title); process.exit(0); }',
    'if (command === "wait") { process.stdout.write(JSON.stringify({ exitCode: 0 })); process.exit(0); }',
    'if (command === "logs") { const agentId = args[1]; process.stdout.write(readAgent(agentId).transcript ?? ""); process.exit(0); }',
    'if (command === "inspect") { process.stdout.write(JSON.stringify({ usage: { inputTokens: 12, outputTokens: 6, costUsd: 0.01 } })); process.exit(0); }',
    'if (command === "delete") { process.exit(0); }',
    'process.stderr.write(`unsupported fake paseo command: ${command}\\n`);',
    'process.exit(1);',
  ].join("\n");

  await writeFile(binPath, script, "utf8");
  await chmod(binPath, 0o755);
  return binPath;
}

async function installV2PackageShims(): Promise<void> {
  const shimRoots = [
    join(process.cwd(), "node_modules", "@pluto"),
    join(process.cwd(), "packages", "pluto-v2-runtime", "node_modules", "@pluto"),
  ];
  const packages = [
    {
      name: "v2-core",
      target: pathToFileURL(join(process.cwd(), "packages/pluto-v2-core/src/index.ts")).href,
    },
    {
      name: "v2-runtime",
      target: pathToFileURL(join(process.cwd(), "packages/pluto-v2-runtime/src/index.ts")).href,
    },
  ];

  for (const shimRoot of shimRoots) {
    for (const pkg of packages) {
      const dir = join(shimRoot, pkg.name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: `@pluto/${pkg.name}`, type: "module", exports: "./index.js" }, null, 2), "utf8");
      await writeFile(join(dir, "index.js"), `export * from ${JSON.stringify(pkg.target)};\n`, "utf8");
    }
  }
}

async function assertNonEmptyFile(filePath: string): Promise<void> {
  expect((await stat(filePath)).size).toBeGreaterThan(0);
}

function filterCliStderr(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.startsWith("npm warn") && line.trim() !== "")
    .join("\n");
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await exec(
      "npx",
      [
        "tsx",
        join(process.cwd(), "src/cli/run.ts"),
        ...args,
      ],
      {
        cwd: process.cwd(),
        timeout: 30_000,
        env,
      },
    );

    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const failed = error as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
      exitCode: failed.code ?? 1,
    };
  }
}

describe("src/cli/run.ts default v2 runtime", () => {
  it("defaults to v2 and writes the run-directory evidence outputs when --spec is passed", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-v2-default-"));
    const dataDir = join(workspace, ".pluto");
    const fakeStateDir = join(workspace, "paseo-state");
    tempDirs.push(workspace);

    await installV2PackageShims();
    const fakePaseoBin = await createFakePaseoBin(workspace);
    const { stdout, stderr, exitCode } = await runCli(
      [
        `--spec=${SPEC_PATH}`,
        "--workspace",
        workspace,
        "--data-dir",
        dataDir,
      ],
      {
        ...process.env,
        PASEO_BIN: fakePaseoBin,
        PASEO_FAKE_STATE_DIR: fakeStateDir,
      },
    );

    const filteredStderr = filterCliStderr(stderr);
    expect(exitCode).toBe(0);
    expect(filteredStderr).toBe("");
    const output = JSON.parse(stdout) as { status: string; runDir: string; evidencePacketPath: string; transcriptPaths: string[] };
    expect(output.status).toBe("succeeded");
    expect(output.runDir).toBe(join(dataDir, "runs", "run-hello-team-paseo-mock"));
    expect(output.evidencePacketPath).toBe(join(output.runDir, "evidence-packet.json"));
    expect(output.transcriptPaths.length).toBeGreaterThan(0);

    const packet = JSON.parse(await readFile(output.evidencePacketPath, "utf8")) as { status: string };
    expect(packet.status).toBe("succeeded");

    await Promise.all([
      assertNonEmptyFile(join(output.runDir, "events.jsonl")),
      assertNonEmptyFile(join(output.runDir, "projections", "tasks.json")),
      assertNonEmptyFile(join(output.runDir, "projections", "mailbox.jsonl")),
      assertNonEmptyFile(join(output.runDir, "projections", "artifacts.json")),
      assertNonEmptyFile(join(output.runDir, "final-report.md")),
      assertNonEmptyFile(join(output.runDir, "usage-summary.json")),
      assertNonEmptyFile(output.transcriptPaths[0]!),
    ]);

    const usageSummary = JSON.parse(await readFile(join(output.runDir, "usage-summary.json"), "utf8")) as {
      usageStatus: string;
      reportedBy: string;
    };
    expect(usageSummary.usageStatus).toBe("reported");
    expect(usageSummary.reportedBy).toBe("paseo.usageEstimate");
  }, 30_000);

  it("defaults runRootDir to <workspace>/.pluto/runs when --workspace is set without --data-dir", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-v2-workspace-"));
    const fakeStateDir = join(workspace, "paseo-state");
    tempDirs.push(workspace);

    await installV2PackageShims();
    const fakePaseoBin = await createFakePaseoBin(workspace);
    const { stdout, stderr, exitCode } = await runCli(
      [
        `--spec=${SPEC_PATH}`,
        "--workspace",
        workspace,
      ],
      {
        ...process.env,
        PASEO_BIN: fakePaseoBin,
        PASEO_FAKE_STATE_DIR: fakeStateDir,
      },
    );

    expect(exitCode).toBe(0);
    expect(filterCliStderr(stderr)).toBe("");

    const output = JSON.parse(stdout) as { runDir: string };
    expect(output.runDir).toBe(join(workspace, ".pluto", "runs", "run-hello-team-paseo-mock"));
  }, 30_000);

  it("routes agentic specs through the real CLI path", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-v2-agentic-"));
    const dataDir = join(workspace, ".pluto");
    const fakeStateDir = join(workspace, "paseo-state");
    tempDirs.push(workspace);

    await installV2PackageShims();
    const fakePaseoBin = await createAgenticFakePaseoBin(workspace);
    const { stdout, stderr, exitCode } = await runCli(
      [
        `--spec=${AGENTIC_SPEC_PATH}`,
        "--workspace",
        workspace,
        "--data-dir",
        dataDir,
      ],
      {
        ...process.env,
        PASEO_BIN: fakePaseoBin,
        PASEO_FAKE_STATE_DIR: fakeStateDir,
      },
    );

    expect(exitCode).toBe(0);
    expect(filterCliStderr(stderr)).toBe("");

    const output = JSON.parse(stdout) as { status: string; runDir: string; transcriptPaths: string[] };
    expect(output.status).toBe("succeeded");
    expect(output.runDir).toBe(join(dataDir, "runs", "run-hello-team-agentic-mock"));
    expect(output.transcriptPaths.length).toBeGreaterThan(0);

    const events = (await readFile(join(output.runDir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { kind: string; payload?: { ownerActor?: { kind: string; role?: string } } });

    expect(events.some((event) =>
      event.kind === "task_created"
      && event.payload?.ownerActor?.kind === "role"
      && event.payload.ownerActor.role !== "lead",
    )).toBe(true);
  }, 30_000);

  it("writes the documented run-directory files even when the v2 run fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-v2-failed-"));
    const badSpecPath = join(workspace, "bad-agentic.yaml");
    tempDirs.push(workspace);

    await installV2PackageShims();
    await writeFile(badSpecPath, "runId: broken\n---\nrunId: duplicate\n", "utf8");

    const { stdout, stderr, exitCode } = await runCli(
      [
        `--spec=${badSpecPath}`,
        "--workspace",
        workspace,
      ],
      process.env,
    );

    expect(exitCode).toBe(1);
    expect(filterCliStderr(stderr)).toContain("Expected exactly one YAML document");

    const output = JSON.parse(stdout) as {
      status: string;
      runDir: string;
      evidencePacketPath: string;
      transcriptPaths: string[];
    };
    expect(output.status).toBe("failed");
    expect(output.runDir).toBe(join(workspace, ".pluto", "runs", "bad-agentic"));
    expect(output.evidencePacketPath).toBe(join(output.runDir, "evidence-packet.json"));
    expect(output.transcriptPaths).toEqual([]);

    await Promise.all([
      assertNonEmptyFile(join(output.runDir, "events.jsonl")),
      assertNonEmptyFile(join(output.runDir, "projections", "tasks.json")),
      assertNonEmptyFile(join(output.runDir, "projections", "mailbox.jsonl")),
      assertNonEmptyFile(join(output.runDir, "projections", "artifacts.json")),
      assertNonEmptyFile(join(output.runDir, "evidence-packet.json")),
      assertNonEmptyFile(join(output.runDir, "final-report.md")),
      assertNonEmptyFile(join(output.runDir, "usage-summary.json")),
    ]);

    const packet = JSON.parse(await readFile(output.evidencePacketPath, "utf8")) as { status: string; summary: string | null };
    expect(packet.status).toBe("failed");
    expect(packet.summary).toBe("Expected exactly one YAML document");
  }, 30_000);
});
