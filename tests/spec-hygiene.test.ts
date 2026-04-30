import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const fixtureRoot = resolve(process.cwd(), "tests/fixtures/spec-mirror");
const objectMapFixtureRoot = resolve(process.cwd(), "tests/fixtures/spec-mirror-objectmap");
const scriptPath = resolve(process.cwd(), "scripts/spec-hygiene.mjs");

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-spec-hygiene-"));
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

describe("scripts/spec-hygiene.mjs", () => {
  it("passes against the valid fixture mirror", async () => {
    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", fixtureRoot]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("spec hygiene ok");
  });

  it("passes against the valid object-map fixture mirror", async () => {
    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", objectMapFixtureRoot]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("spec hygiene ok");
  });

  it("passes when a spec directory contains an unrelated sidecar file", async () => {
    const sidecarFixture = join(workDir, "sidecar-mirror");
    await cp(fixtureRoot, sidecarFixture, { recursive: true });
    await writeFile(join(sidecarFixture, "alpha-spec", "notes.txt"), "sidecar files are ignored\n");

    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", sidecarFixture]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("spec hygiene ok");
  });

  it("fails when a spec page declares an invalid status", async () => {
    const brokenFixture = join(workDir, "invalid-status-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await replaceInFile(join(brokenFixture, "alpha-spec", "PRD.md"), "Status: accepted", "Status: active");

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("ERROR [META_INVALID_STATUS] alpha-spec/PRD.md:");
    expect(stderr).toContain('invalid Status "active"');
  });

  it("fails tree-sync checks for an object-map mirror when a generated file is missing", async () => {
    const brokenFixture = join(workDir, "missing-object-map-generated-file-mirror");
    await cp(objectMapFixtureRoot, brokenFixture, { recursive: true });
    await rm(join(brokenFixture, "alpha-spec", "PRD.md"));

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("ERROR [MANIFEST_MISSING_ENTRY] alpha-spec/PRD.md: referenced file is missing");
  });

  it("fails with MANIFEST_SHAPE when the root manifest uses an unsupported schema", async () => {
    const brokenFixture = join(workDir, "invalid-manifest-shape-mirror");
    await cp(objectMapFixtureRoot, brokenFixture, { recursive: true });
    await writeFile(join(brokenFixture, "manifest.json"), `${JSON.stringify({ entries: {} }, null, 2)}\n`);

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'ERROR [MANIFEST_SHAPE] manifest.json: must be either an "entries" array or an object map keyed by spec title'
    );
  });

  it("fails when a required metadata field is missing", async () => {
    const brokenFixture = join(workDir, "missing-metadata-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await replaceInFile(join(brokenFixture, "beta-spec", "TRD.md"), "Owner: Beta Platform\n", "");

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('ERROR [META_MISSING_FIELD] beta-spec/TRD.md: missing metadata field "Owner"');
  });

  it("fails when a spec page declares the wrong Spec Type", async () => {
    const brokenFixture = join(workDir, "wrong-spec-type-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await replaceInFile(join(brokenFixture, "gamma-spec", "QA.md"), "Spec Type: QA", "Spec Type: TRD");

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('ERROR [META_WRONG_SPEC_TYPE] gamma-spec/QA.md: Spec Type must be "QA" (got "TRD")');
  });

  it("exits 0 when the mirror is absent by default", async () => {
    const missingMirror = join(workDir, "missing-mirror");
    const { stdout, stderr, exitCode } = await runSpecHygiene(["--input", missingMirror]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(`spec mirror not found at ${missingMirror}; nothing to validate`);
  });

  it("exits 2 when the mirror is absent and --require-mirror is set", async () => {
    const missingMirror = join(workDir, "required-mirror");
    const { stdout, stderr, exitCode } = await runSpecHygiene([
      "--input",
      missingMirror,
      "--require-mirror",
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
    expect(stdout).toContain(`spec mirror not found at ${missingMirror}; nothing to validate`);
  });

  it("fails when two specs share the same normalized title", async () => {
    const brokenFixture = join(workDir, "duplicate-title-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await replaceInFile(join(brokenFixture, "beta-spec", "overview.md"), "# Beta Overview", "# Alpha Overview");

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("ERROR [DUPLICATE_SPEC] alpha-spec/overview.md:");
    expect(stderr).toContain('duplicate title "alpha overview"');
  });

  it("fails when a manifest-generated file is missing from the spec tree", async () => {
    const brokenFixture = join(workDir, "missing-generated-file-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await rm(join(brokenFixture, "beta-spec", "QA.md"));

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("ERROR [MANIFEST_MISSING_ENTRY] beta-spec/QA.md: referenced file is missing");
  });

  it("fails when a manifest entry omits title_key", async () => {
    const brokenFixture = join(workDir, "missing-title-key-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await updateJsonFile(join(brokenFixture, "manifest.json"), (manifest) => {
      delete manifest.entries[0].title_key;
    });

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('ERROR [MANIFEST_MISSING_ENTRY] manifest.json: entries[0].title_key must be a string');
  });

  it("fails when title_key does not match the overview heading", async () => {
    const brokenFixture = join(workDir, "title-key-mismatch-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await updateJsonFile(join(brokenFixture, "manifest.json"), (manifest) => {
      manifest.entries[0].title_key = "wrong_title_key";
    });

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('ERROR [MANIFEST_TITLE_KEY_MISMATCH] manifest.json: entries[0].title_key must be "alpha_overview" but found "wrong_title_key"');
  });

  it("fails when a manifest path does not use the canonical per-spec location", async () => {
    const brokenFixture = join(workDir, "manifest-path-mismatch-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await updateJsonFile(join(brokenFixture, "manifest.json"), (manifest) => {
      manifest.entries[0].generated_files.QA = "QA.md";
    });

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      'ERROR [MANIFEST_PATH_MISMATCH] manifest.json: expected path "alpha-spec/QA.md" but found "QA.md"'
    );
  });

  it("fails when two manifest entries reuse the same slug and source path", async () => {
    const brokenFixture = join(workDir, "duplicate-slug-source-mirror");
    await cp(fixtureRoot, brokenFixture, { recursive: true });
    await updateJsonFile(join(brokenFixture, "manifest.json"), (manifest) => {
      manifest.entries[1].spec_directory = "alpha-spec";
      manifest.entries[1].source_combined_file = "alpha-spec/source.md";
      manifest.entries[1].generated_files = {
        overview: "alpha-spec/overview.md",
        PRD: "alpha-spec/PRD.md",
        TRD: "alpha-spec/TRD.md",
        QA: "alpha-spec/QA.md",
      };
    });

    const { stderr, exitCode } = await runSpecHygiene(["--input", brokenFixture]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("ERROR [DUPLICATE_SPEC] alpha-spec/manifest.json:");
    expect(stderr).toContain('duplicate spec directory "alpha-spec"');
    expect(stderr).toContain("ERROR [DUPLICATE_SPEC] alpha-spec/source.md:");
    expect(stderr).toContain('duplicate source path "alpha-spec/source.md"');
  });

  it("warns without failing when an addendum title likely overlaps an existing spec", async () => {
    const warningFixture = join(workDir, "addendum-overlap-mirror");
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
    expect(stdout).toContain("spec hygiene ok");
    expect(stderr).toContain("WARN [ADDENDUM_WARNING] gamma-spec/overview.md:");
    expect(stderr).toContain('title overlaps with "Alpha Overview"');
  });
});
