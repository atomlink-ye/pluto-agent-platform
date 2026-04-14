import { spawnSync } from "node:child_process";

export function isCommandAvailable(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookupCommand, [trimmed], { stdio: "ignore" });
  return result.status === 0;
}
