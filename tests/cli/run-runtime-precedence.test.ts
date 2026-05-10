import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const tempDirs: string[] = [];
const SPEC_PATH = join(process.cwd(), "packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml");
const archivedMessage = "v1.6 runtime was archived in S7. Reference copy lives on the legacy-v1.6-harness-prototype branch. v2 takes pluto:run --spec <path> only.";

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
    'if (command === "inspect") { process.stdout.write(JSON.stringify({ usage: { inputTokens: 8, outputTokens: 4, costUsd: 0.01 } })); process.exit(0); }',
    'if (command === "delete") { process.exit(0); }',
    'process.stderr.write(`unsupported fake paseo command: ${command}\\n`);',
    'process.exit(1);',
  ].join("\n");

  await writeFile(binPath, script, "utf8");
  await chmod(binPath, 0o755);
  return binPath;
}

async function installV2PackageShims(): Promise<void> {
  process.env.TSX_TSCONFIG_PATH = join(process.cwd(), "tests/cli/tsconfig.subpath-shims.json");
  const shimRoots = [
    join(process.cwd(), "src", "node_modules", "@pluto"),
  ];
  const coreSubpaths = [
    "index",
    "actor-ref",
    "run-event",
    "versioning",
    "protocol-request",
    "projections",
    "projections/replay",
    "core/team-context",
    "core/providers",
    "core/run-kernel",
    "core/run-state",
    "core/run-state-reducer",
    "core/spec-compiler",
  ];
  const coreExports = Object.fromEntries(
    coreSubpaths.map((subpath) => [subpath === "index" ? "." : `./${subpath}`, `./${subpath}.js`]),
  );

  for (const shimRoot of shimRoots) {
    const coreDir = join(shimRoot, "v2-core");
    await mkdir(coreDir, { recursive: true });
    await writeFile(join(coreDir, "package.json"), JSON.stringify({ name: "@pluto/v2-core", type: "module", exports: coreExports }, null, 2), "utf8");
    for (const subpath of coreSubpaths) {
      const parts = subpath.split("/");
      if (parts.length > 1) {
        await mkdir(join(coreDir, ...parts.slice(0, -1)), { recursive: true });
      }
      const target = pathToFileURL(join(process.cwd(), "packages/pluto-v2-core/src", `${subpath}.ts`)).href;
      await writeFile(join(coreDir, `${subpath}.js`), `export * from ${JSON.stringify(target)};\n`, "utf8");
    }

    const runtimeDir = join(shimRoot, "v2-runtime");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "package.json"), JSON.stringify({ name: "@pluto/v2-runtime", type: "module", exports: "./index.js" }, null, 2), "utf8");
    await writeFile(join(runtimeDir, "index.js"), `export * from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/pluto-v2-runtime/src/index.ts")).href)};\n`, "utf8");
  }
}

async function runCli(args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/run.ts"), ...args], {
      cwd: process.cwd(),
      timeout: 30_000,
      env: { ...process.env, ...env },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      exitCode: execError.code ?? 1,
    };
  }
}

describe("src/cli/run.ts runtime precedence", () => {
  it("exits 1 with the archived message for --runtime=v1", async () => {
    const result = await runCli(["--runtime=v1"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(archivedMessage);
  });

  it("exits 1 with the archived message for PLUTO_RUNTIME=v1", async () => {
    const result = await runCli([], { PLUTO_RUNTIME: "v1" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(archivedMessage);
  });

  it("defaults to v2 when neither the CLI flag nor env var is set", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-precedence-default-"));
    const dataDir = join(workspace, ".pluto");
    const fakeStateDir = join(workspace, "paseo-state");
    tempDirs.push(workspace);

    await installV2PackageShims();
    const fakePaseoBin = await createFakePaseoBin(workspace);
    const result = await runCli(
      [
        `--spec=${SPEC_PATH}`,
        "--workspace",
        workspace,
        "--data-dir",
        dataDir,
      ],
      {
        PASEO_BIN: fakePaseoBin,
        PASEO_FAKE_STATE_DIR: fakeStateDir,
      },
    );

    const filteredStderr = result.stderr
      .split("\n")
      .filter((line) => !line.startsWith("npm warn") && line.trim() !== "")
      .join("\n");
    expect(result.exitCode).toBe(0);
    expect(filteredStderr).toBe("");
    const output = JSON.parse(result.stdout) as { status: string };
    expect(output.status).toBe("succeeded");
  }, 30_000);

  it("lets --runtime=v2 override PLUTO_RUNTIME=v1 during the transition window", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pluto-run-precedence-flag-"));
    const dataDir = join(workspace, ".pluto");
    const fakeStateDir = join(workspace, "paseo-state");
    tempDirs.push(workspace);

    await installV2PackageShims();
    const fakePaseoBin = await createFakePaseoBin(workspace);
    const result = await runCli(
      [
        "--runtime=v2",
        `--spec=${SPEC_PATH}`,
        "--workspace",
        workspace,
        "--data-dir",
        dataDir,
      ],
      {
        PLUTO_RUNTIME: "v1",
        PASEO_BIN: fakePaseoBin,
        PASEO_FAKE_STATE_DIR: fakeStateDir,
      },
    );

    const filteredStderr = result.stderr
      .split("\n")
      .filter((line) => !line.startsWith("npm warn") && line.trim() !== "")
      .join("\n");
    expect(result.exitCode).toBe(0);
    expect(filteredStderr).toBe("");
    const output = JSON.parse(result.stdout) as { status: string; runDir: string; evidencePacketPath: string };
    expect(output.status).toBe("succeeded");
    expect(output.runDir).toBe(join(dataDir, "runs", "run-hello-team-paseo-mock"));
    expect(output.evidencePacketPath).toBe(join(output.runDir, "evidence-packet.json"));
  }, 30_000);
});
