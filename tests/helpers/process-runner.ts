import type { ProcessRunner } from "@/adapters/paseo-opencode/process-runner.js";

export type ProcessRunnerOverrides = {
  run?: (args: string[]) => { stdout?: string; stderr?: string; exitCode?: number | null };
  onArgs?: (cmd: string, args: string[]) => void;
  extra?: (cmd: string, args: string[]) => { stdout?: string; stderr?: string; exitCode?: number | null } | undefined;
  follow?: (cmd: string, args: string[], opts: { onLine: (line: string) => void }) => void;
};

export function makeProcessRunner(overrides: ProcessRunnerOverrides = {}): ProcessRunner {
  return {
    async exec(cmd, args) {
      overrides.onArgs?.(cmd, args);
      const subcommand = args[0];
      if (subcommand === "run") {
        const result = overrides.run?.(args) ?? {};
        return {
          stdout: result.stdout ?? `{"agentId":"agent-${args[args.length - 2] ?? "x"}"}`,
          stderr: result.stderr ?? "",
          exitCode: result.exitCode ?? 0,
        };
      }
      if (subcommand === "wait") {
        return { stdout: '{"status":"idle"}', stderr: "", exitCode: 0 };
      }
      if (subcommand === "send") {
        return { stdout: '{"sent":true}', stderr: "", exitCode: 0 };
      }
      if (subcommand === "logs") {
        const result = overrides.extra?.(cmd, args);
        return {
          stdout: result?.stdout ?? "[User] task\nworker output\n[Thought] done",
          stderr: result?.stderr ?? "",
          exitCode: result?.exitCode ?? 0,
        };
      }
      if (subcommand === "delete") {
        return { stdout: "DELETED", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: `unknown subcommand:${subcommand}`, exitCode: 1 };
    },
    follow(cmd, args, opts) {
      overrides.onArgs?.(cmd, args);
      overrides.follow?.(cmd, args, opts);
      return { dispose: async () => undefined };
    },
  };
}
