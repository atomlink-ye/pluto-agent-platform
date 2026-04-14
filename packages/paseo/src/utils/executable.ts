import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path, { extname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function pickBestWindowsCandidate(lines: string[]): string | null {
  const candidates = lines.filter((line) => line.length > 0);
  if (candidates.length === 0) return null;

  for (const ext of [".exe", ".cmd", ".ps1"]) {
    const match = candidates.find((candidate) => candidate.toLowerCase().endsWith(ext));
    if (match) return match;
  }

  return candidates[0] ?? null;
}

function resolveExecutableFromWhichOutput(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const candidate = lines.at(-1);
  return candidate && path.isAbsolute(candidate) ? candidate : null;
}

export function executableExists(executablePath: string): string | null {
  if (existsSync(executablePath)) return executablePath;
  if (process.platform === "win32" && !extname(executablePath)) {
    for (const ext of [".exe", ".cmd", ".ps1"]) {
      const candidate = executablePath + ext;
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export async function findExecutable(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return executableExists(trimmed);
  }

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", [trimmed], {
        encoding: "utf8",
        windowsHide: true,
      });
      return pickBestWindowsCandidate(
        stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => line.trim()),
      );
    } catch {
      return null;
    }
  }

  try {
    const { stdout } = await execFileAsync("which", [trimmed], { encoding: "utf8" });
    return resolveExecutableFromWhichOutput(stdout.trim());
  } catch {
    return null;
  }
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  return (await findExecutable(command)) !== null;
}

function escapeWindowsCmdValue(value: string): string {
  if (process.platform !== "win32") return value;
  const isQuoted = value.startsWith('"') && value.endsWith('"');
  const unquoted = isQuoted ? value.slice(1, -1) : value;
  const escaped = unquoted.replace(/%/g, "%%").replace(/([&|^<>()!])/g, "^$1");
  if (isQuoted || escaped.includes(" ")) {
    return `"${escaped}"`;
  }
  return escaped;
}

export function quoteWindowsCommand(command: string): string {
  return escapeWindowsCmdValue(command);
}

export function quoteWindowsArgument(argument: string): string {
  return escapeWindowsCmdValue(argument);
}
