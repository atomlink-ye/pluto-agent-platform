import { spawn } from "node:child_process";

/**
 * Minimal exec helpers. Pulled into its own module so unit tests can
 * inject a mock without touching the live adapter logic.
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ProcessRunner {
  exec(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string }): Promise<ExecResult>;
  /**
   * Stream stdout chunks. Each line is delivered to `onLine`. Returns a
   * disposer that kills the child process and resolves once the process exits.
   */
  follow(cmd: string, args: string[], opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onLine: (line: string) => void;
  }): { dispose: () => Promise<void> };
}

export const DEFAULT_RUNNER: ProcessRunner = {
  async exec(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (b) => (stdout += b.toString("utf8")));
      child.stderr.on("data", (b) => (stderr += b.toString("utf8")));
      child.on("error", reject);
      child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
      if (opts.input !== undefined) {
        child.stdin.write(opts.input);
      }
      child.stdin.end();
    });
  },
  follow(cmd, args, opts) {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    child.stdout.on("data", (b) => {
      buf += b.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.length > 0) opts.onLine(line);
      }
    });
    const closed = new Promise<void>((resolve) => {
      child.on("close", () => {
        if (buf.length > 0) {
          for (const line of buf.split("\n")) {
            if (line.length > 0) opts.onLine(line);
          }
          buf = "";
        }
        resolve();
      });
    });
    return {
      dispose: async () => {
        if (!child.killed) child.kill("SIGTERM");
        await closed;
      },
    };
  },
};
