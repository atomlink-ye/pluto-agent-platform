/**
 * Pluto MVP-alpha repo harness verification.
 *
 * Tests that the harness layer exists and is correctly structured.
 * This test uses strict TDD: it must fail until the harness is implemented.
 */
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = resolve(process.cwd());

describe("repo-harness", () => {
  describe("package.json", () => {
    it("exposes verify script", async () => {
      const pkg = JSON.parse(
        await readFile(resolve(PROJECT_ROOT, "package.json"), "utf-8")
      );
      expect(pkg.scripts).toHaveProperty("verify");
    });
  });

  describe(".gitignore", () => {
    it("ignores local OpenCode Companion serve state", async () => {
      const content = await readFile(resolve(PROJECT_ROOT, ".gitignore"), "utf-8");
      expect(content).toContain(".opencode-serve.json");
    });
  });

  describe("scripts/verify.mjs", () => {
    it("exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "scripts/verify.mjs"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("runs typecheck in sequence", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "scripts/verify.mjs"),
        "utf-8"
      );
      expect(content).toContain("typecheck");
    });

    it("runs test in sequence", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "scripts/verify.mjs"),
        "utf-8"
      );
      expect(content).toContain("test");
    });

    it("runs build in sequence", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "scripts/verify.mjs"),
        "utf-8"
      );
      expect(content).toContain("build");
    });

    it("runs smoke:fake in sequence", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "scripts/verify.mjs"),
        "utf-8"
      );
      expect(content).toContain("smoke:fake");
    });

    it("asserts no-endpoint blocker when OPENCODE_BASE_URL unset", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "scripts/verify.mjs"),
        "utf-8"
      );
      // Must check for the blocker scenario
      expect(content).toContain("OPENCODE_BASE_URL");
      // Must remove any inherited endpoint before running the blocker check.
      expect(content).toContain("delete blockerEnv.OPENCODE_BASE_URL");
      // Must exit with code 2 for blocker
      expect(content).toContain("2");
    });
  });

  describe("top-level docs", () => {
    it("AGENTS.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "AGENTS.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("ARCHITECTURE.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "ARCHITECTURE.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("DESIGN.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "DESIGN.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("QUALITY_SCORE.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "QUALITY_SCORE.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("RELIABILITY.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "RELIABILITY.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("SECURITY.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "SECURITY.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe("docs structure", () => {
    it("docs/harness.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "docs/harness.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("docs/testing-and-evals.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "docs/testing-and-evals.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("docs/plans/README.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "docs/plans/README.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("docs/debt/README.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "docs/debt/README.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });
  });

  describe("evals/ skeleton", () => {
    it("evals/README.md exists", async () => {
      const content = await readFile(
        resolve(PROJECT_ROOT, "evals/README.md"),
        "utf-8"
      );
      expect(content.length).toBeGreaterThan(0);
    });

    it("evals/cases/ directory exists", async () => {
      const s = await stat(resolve(PROJECT_ROOT, "evals/cases"));
      expect(s.isDirectory()).toBe(true);
    });

    it("evals/rubrics/ directory exists", async () => {
      const s = await stat(resolve(PROJECT_ROOT, "evals/rubrics"));
      expect(s.isDirectory()).toBe(true);
    });

    it("evals/goldens/ directory exists", async () => {
      const s = await stat(resolve(PROJECT_ROOT, "evals/goldens"));
      expect(s.isDirectory()).toBe(true);
    });

    it("evals/reports/ directory exists", async () => {
      const s = await stat(resolve(PROJECT_ROOT, "evals/reports"));
      expect(s.isDirectory()).toBe(true);
    });

    it("evals/datasets/ directory exists", async () => {
      const s = await stat(resolve(PROJECT_ROOT, "evals/datasets"));
      expect(s.isDirectory()).toBe(true);
    });
  });
});