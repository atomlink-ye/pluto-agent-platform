import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const fixtureRoot = resolve(process.cwd(), "tests/fixtures/spec-mirror");
const scriptPath = resolve(process.cwd(), "scripts/spec-hygiene.mjs");

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-spec-hygiene-cli-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runSpecHygiene(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("node", [scriptPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env },
      timeout: 10_000,
    });

    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: failure.code ?? 1,
    };
  }
}

async function replaceInFile(filePath: string, searchValue: string, replaceValue: string) {
  const content = await readFile(filePath, "utf8");
  await writeFile(filePath, content.replace(searchValue, replaceValue));
}

async function updateJsonFile(filePath: string, update: (value: any) => void) {
  const content = await readFile(filePath, "utf8");
  const value = JSON.parse(content);
  update(value);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

describe("spec-hygiene CLI", () => {
  it("returns 0 and prints the clean success line", async () => {
    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", fixtureRoot]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(`spec hygiene ok for ${fixtureRoot}\n`);
  });

  it("returns a hard failure with stable formatted output", async () => {
    const brokenFixture = join(workDir, "hard-failure-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await replaceInFile(join(brokenFixture, "alpha-spec", "PRD.md"), "Status: accepted", "Status: active");

    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe(
      `ERROR [META_INVALID_STATUS] alpha-spec/PRD.md: invalid Status "active"; expected one of: idea, draft v0, draft v1, accepted, superseded, archived\n`
    );
  });

  it("prints manifest/tree failures with the stable error contract", async () => {
    const brokenFixture = join(workDir, "missing-generated-file-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await rm(join(brokenFixture, "beta-spec", "QA.md"));

    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe(`ERROR [MANIFEST_MISSING_ENTRY] beta-spec/QA.md: referenced file is missing\n`);
  });

  it("prints warnings to stderr without failing", async () => {
    const warningFixture = join(workDir, "warning-mirror");
    await cp(fixtureRoot, warningFixture, { recursive: true });
    await replaceInFile(
      join(warningFixture, "gamma-spec", "overview.md"),
      "# Gamma Overview",
      "# Alpha Overview Addendum"
    );
    await updateJsonFile(join(warningFixture, "manifest.json"), (manifest) => {
      manifest.entries[2].title_key = "alpha_overview_addendum";
    });

    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", warningFixture]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe(
      'WARN [ADDENDUM_WARNING] gamma-spec/overview.md: title overlaps with "Alpha Overview" from alpha-spec/overview.md\n'
    );
    expect(stdout).toBe(`spec hygiene ok for ${warningFixture}\n`);
  });

  it("returns 0 when the mirror is missing by default", async () => {
    const missingMirror = join(workDir, "missing-mirror");
    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", missingMirror]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(`spec mirror not found at ${missingMirror}; nothing to validate\n`);
  });

  it("returns 2 when --require-mirror is set and the mirror is missing", async () => {
    const missingMirror = join(workDir, "required-mirror");
    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", missingMirror, "--require-mirror"]);

    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
    expect(stdout).toBe(`spec mirror not found at ${missingMirror}; nothing to validate\n`);
  });
});
