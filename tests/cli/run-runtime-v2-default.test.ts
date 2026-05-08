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
const AGENTIC_SPEC_PATH = join(process.cwd(), "packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml");
const PLUTO_TOOL_PATH = join(process.cwd(), "packages/pluto-v2-runtime/src/cli/pluto-tool.ts");
const TSX_BIN_PATH = join(process.cwd(), "node_modules", ".bin", "tsx");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createFakePaseoBin(rootDir: string, options?: { rejectOrchestratorOnce?: boolean }): Promise<string> {
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
    'const spawnModesPath = join(stateDir, "__spawn-modes.json");',
    'const orchestratorRejectedPath = join(stateDir, "__orchestrator-rejected");',
    'const readAgent = (agentId) => existsSync(agentPath(agentId)) ? JSON.parse(readFileSync(agentPath(agentId), "utf8")) : { transcript: "" };',
    'const writeAgent = (agentId, state) => { mkdirSync(dirname(agentPath(agentId)), { recursive: true }); writeFileSync(agentPath(agentId), JSON.stringify(state), "utf8"); };',
    'const readSpawnModes = () => existsSync(spawnModesPath) ? JSON.parse(readFileSync(spawnModesPath, "utf8")) : [];',
    'const recordSpawnMode = (title, mode) => { const next = readSpawnModes(); next.push({ title, mode }); writeFileSync(spawnModesPath, JSON.stringify(next), "utf8"); };',
    'const extractPrompt = (raw) => { const match = raw.match(/```json\\s*([\\s\\S]*?)```/); return match ? match[1].trim() : raw.trim(); };',
    'const turnIndexFor = (directive) => { try { const parsed = JSON.parse(directive); if (parsed.kind === "create_task") return 0; if (parsed.kind === "publish_artifact") return 2; if (parsed.kind === "append_mailbox_message") return 3; if (parsed.kind === "complete_run") return 5; if (parsed.kind === "change_task_state" && parsed.payload && parsed.payload.to === "running") return 1; if (parsed.kind === "change_task_state" && parsed.payload && parsed.payload.to === "completed") return 4; } catch {} return 99; };',
    'const appendTranscript = (agentId, promptText) => { const directive = extractPrompt(promptText); const prefix = `[assistant turn ${turnIndexFor(directive)}]\\n`; const prior = readAgent(agentId).transcript; const next = prior ? `${prior}\\n${prefix}${directive}` : `${prefix}${directive}`; writeAgent(agentId, { transcript: next }); };',
    `const rejectOrchestratorOnce = ${JSON.stringify(Boolean(options?.rejectOrchestratorOnce))};`,
    'if (command === "run") { const titleIndex = args.indexOf("--title"); const modeIndex = args.indexOf("--mode"); const title = titleIndex >= 0 ? args[titleIndex + 1] : "unknown"; const mode = modeIndex >= 0 ? args[modeIndex + 1] : null; recordSpawnMode(title, mode); if (rejectOrchestratorOnce && mode === "orchestrator" && !existsSync(orchestratorRejectedPath)) { writeFileSync(orchestratorRejectedPath, "1", "utf8"); process.stderr.write("unsupported mode orchestrator\\n"); process.exit(2); } const agentId = `fake-${title}`; appendTranscript(agentId, args.at(-1) ?? ""); process.stdout.write(JSON.stringify({ agentId })); process.exit(0); }',
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
    'const { execFileSync } = require("node:child_process");',
    'const { dirname, join } = require("node:path");',
    `const plutoToolPath = ${JSON.stringify(PLUTO_TOOL_PATH)};`,
    `const tsxBinPath = ${JSON.stringify(TSX_BIN_PATH)};`,
    'const args = process.argv.slice(2);',
    'const stateDir = process.env.PASEO_FAKE_STATE_DIR;',
    'if (!stateDir) throw new Error("PASEO_FAKE_STATE_DIR is required");',
    'mkdirSync(stateDir, { recursive: true });',
    'const command = args[0];',
    'const agentPath = (agentId) => join(stateDir, `${agentId}.json`);',
    'const readAgent = (agentId) => existsSync(agentPath(agentId)) ? JSON.parse(readFileSync(agentPath(agentId), "utf8")) : { transcript: "", promptCount: 0, initialized: false, cwd: null, apiUrl: null, token: null, actor: null };',
    'const writeAgent = (agentId, state) => { mkdirSync(dirname(agentPath(agentId)), { recursive: true }); writeFileSync(agentPath(agentId), JSON.stringify(state), "utf8"); };',
    'const logicalTitle = (title) => title.startsWith("pluto-") ? title.slice("pluto-".length) : title;',
    'const actorForTitle = (title) => { const actor = logicalTitle(title); if (actor === "manager") return { kind: "manager" }; if (actor.startsWith("role:")) return { kind: "role", role: actor.slice("role:".length) }; return { kind: "role", role: actor }; };',
    'const readInjectedEnv = (state) => { const url = state.apiUrl ?? process.env.PLUTO_RUN_API_URL; const token = state.token ?? process.env.PLUTO_RUN_TOKEN; const actor = state.actor ?? process.env.PLUTO_RUN_ACTOR; if (typeof url !== "string" || typeof token !== "string" || typeof actor !== "string") throw new Error("missing injected runtime env"); return { url, token, actor }; };',
    'const actorFlag = (actor) => { if (actor.kind === "manager") return "manager"; if (actor.kind === "role") return `role:${actor.role}`; throw new Error(`unsupported actor ${JSON.stringify(actor)}`); };',
    'const toolArgs = (toolName, args) => { if (toolName === "pluto_create_task") return ["create-task", `--owner=${actorFlag(args.ownerActor)}`, `--title=${args.title}`, ...((args.dependsOn ?? []).map((dependency) => `--depends-on=${dependency}`))]; if (toolName === "pluto_append_mailbox_message") return ["send-mailbox", `--to=${actorFlag(args.toActor)}`, `--kind=${args.kind}`, `--body=${args.body}`]; if (toolName === "pluto_complete_run") return ["complete-run", `--status=${args.status}`, `--summary=${args.summary}`]; throw new Error(`unsupported tool ${toolName}`); };',
    'const callTool = async (state, toolName, args) => { const injected = readInjectedEnv(state); try { const stdout = execFileSync(tsxBinPath, [plutoToolPath, ...toolArgs(toolName, args)], { cwd: state.cwd, env: { ...process.env, PLUTO_RUN_API_URL: injected.url, PLUTO_RUN_TOKEN: injected.token, PLUTO_RUN_ACTOR: injected.actor }, encoding: "utf8" }); return stdout.trim().length === 0 ? {} : JSON.parse(stdout); } catch (error) { const stderr = typeof error?.stderr === "string" ? error.stderr : error?.stderr?.toString?.(); throw new Error((stderr && stderr.trim().length > 0 ? stderr : error.message).trim()); } };',
    'const ensureInitialized = async (state) => { if (state.initialized) return state; const injected = readInjectedEnv(state); return { ...state, apiUrl: injected.url, token: injected.token, actor: injected.actor, initialized: true }; };',
    'const nextToolCall = (title, promptCount) => { const actor = logicalTitle(title); if (actor === "role:lead" && promptCount === 0) return { name: "pluto_create_task", args: { title: "Draft the runtime change", ownerActor: { kind: "role", role: "generator" }, dependsOn: [] }, transcriptText: "lead delegated work\\n" }; if (actor === "role:generator" && promptCount === 0) return { name: "pluto_append_mailbox_message", args: { toActor: { kind: "role", role: "lead" }, kind: "completion", body: "Generator completed the draft." }, transcriptText: "generator completed work\\n" }; if (actor === "role:lead" && promptCount === 1) return { name: "pluto_complete_run", args: { status: "succeeded", summary: "Agentic mock run completed." }, transcriptText: "lead closed the run\\n" }; return { name: "pluto_complete_run", args: { status: "failed", summary: `Unexpected agent turn for ${title} #${promptCount}` }, transcriptText: "unexpected turn\\n" }; };',
    'const performTurn = async (agentId, title, cwd) => { let state = readAgent(agentId); state = { ...state, cwd: cwd ?? state.cwd }; if (!state.cwd) throw new Error(`missing cwd for ${agentId}`); state = await ensureInitialized(state); const turn = nextToolCall(title, state.promptCount); await callTool(state, turn.name, turn.args); const nextTranscript = state.transcript ? `${state.transcript}${turn.transcriptText}` : turn.transcriptText; writeAgent(agentId, { ...state, transcript: nextTranscript, promptCount: state.promptCount + 1 }); };',
    'const main = async () => {',
    '  if (command === "run") { const titleIndex = args.indexOf("--title"); const cwdIndex = args.indexOf("--cwd"); const title = titleIndex >= 0 ? args[titleIndex + 1] : "unknown"; const cwd = cwdIndex >= 0 ? args[cwdIndex + 1] : null; const agentId = `fake-${title}`; await performTurn(agentId, title, cwd); process.stdout.write(JSON.stringify({ agentId })); return; }',
    '  if (command === "send") { const agentId = args[1]; const title = agentId.slice("fake-".length); await performTurn(agentId, title, null); return; }',
    '  if (command === "wait") { process.stdout.write(JSON.stringify({ exitCode: 0 })); return; }',
    '  if (command === "logs") { const agentId = args[1]; process.stdout.write(readAgent(agentId).transcript ?? ""); return; }',
    '  if (command === "inspect") { process.stdout.write(JSON.stringify({ usage: { inputTokens: 12, outputTokens: 6, costUsd: 0.01 } })); return; }',
    '  if (command === "delete") { return; }',
    '  throw new Error(`unsupported fake paseo command: ${command}`);',
    '};',
    'main().catch((error) => { process.stderr.write(`${error.stack || error.message}\\n`); process.exit(1); });',
  ].join("\n");

  await writeFile(binPath, script, "utf8");
  await chmod(binPath, 0o755);
  return binPath;
}

async function installV2PackageShims(): Promise<void> {
  const shimRoots = [
    join(process.cwd(), "src", "node_modules", "@pluto"),
    join(process.cwd(), "packages", "pluto-v2-runtime", "node_modules", "@pluto"),
  ];
  const zodShimDir = join(process.cwd(), "packages", "pluto-v2-core", "node_modules", "zod");
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

  const zodTarget = pathToFileURL(join(process.cwd(), "packages", "pluto-v2-runtime", "node_modules", "zod", "index.js")).href;
  await mkdir(zodShimDir, { recursive: true });
  await writeFile(
    join(zodShimDir, "package.json"),
    JSON.stringify({ name: "zod", type: "module", exports: "./index.js" }, null, 2),
    "utf8",
  );
  await writeFile(join(zodShimDir, "index.js"), `export * from ${JSON.stringify(zodTarget)};\n`, "utf8");
}

async function assertNonEmptyFile(filePath: string): Promise<void> {
  expect((await stat(filePath)).size).toBeGreaterThan(0);
}

async function readSpawnModes(stateDir: string): Promise<string[]> {
  const entries = JSON.parse(await readFile(join(stateDir, "__spawn-modes.json"), "utf8")) as Array<{ mode: string }>;
  return entries.map((entry) => entry.mode);
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
    expect((await readSpawnModes(fakeStateDir)).every((mode) => mode === "orchestrator")).toBe(true);

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

  it("honors PASEO_MODE=build overrides", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-v2-build-mode-"));
    const fakeStateDir = join(workspace, "paseo-state");
    tempDirs.push(workspace);

    await installV2PackageShims();
    const fakePaseoBin = await createFakePaseoBin(workspace);
    const { stderr, exitCode } = await runCli(
      [
        `--spec=${SPEC_PATH}`,
        "--workspace",
        workspace,
      ],
      {
        ...process.env,
        PASEO_BIN: fakePaseoBin,
        PASEO_FAKE_STATE_DIR: fakeStateDir,
        PASEO_MODE: "build",
      },
    );

    expect(exitCode).toBe(0);
    expect(filterCliStderr(stderr)).toBe("");
    expect((await readSpawnModes(fakeStateDir)).every((mode) => mode === "build")).toBe(true);
  }, 30_000);

  it("falls back to build with a warning when orchestrator mode is rejected", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-v2-mode-fallback-"));
    const fakeStateDir = join(workspace, "paseo-state");
    tempDirs.push(workspace);

    await installV2PackageShims();
    const fakePaseoBin = await createFakePaseoBin(workspace, { rejectOrchestratorOnce: true });
    const { stderr, exitCode } = await runCli(
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

    const filteredStderr = filterCliStderr(stderr);
    expect(exitCode).toBe(0);
    expect(filteredStderr).toContain("paseo_mode_fallback: orchestrator rejected");
    expect((await readSpawnModes(fakeStateDir)).slice(0, 2)).toEqual(["orchestrator", "build"]);
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

    const output = JSON.parse(stdout) as { status: string; runDir: string; evidencePacketPath: string; transcriptPaths: string[] };
    expect(output.status).toBe("succeeded");
    expect(output.runDir).toBe(join(dataDir, "runs", "run-hello-team-agentic-tool-mock"));
    expect(output.transcriptPaths.length).toBeGreaterThan(0);

    const packet = JSON.parse(await readFile(output.evidencePacketPath, "utf8")) as {
      initiatingActor: { kind: string; role?: string } | null;
    };
    expect(packet.initiatingActor).toEqual({ kind: "role", role: "lead" });

    const finalReport = await readFile(join(output.runDir, "final-report.md"), "utf8");
    expect(finalReport).toContain("- Initiated by: lead (role)");

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
