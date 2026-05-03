import { resolve } from "node:path";
import process from "node:process";

export type ParsedSubcommandArgs = {
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

type FlagDefinition<T> = {
  key: keyof T;
  parse?: (value: string | undefined) => T[keyof T];
};

export type KeyValueFlagSpec<T extends Record<string, unknown>> = {
  defaults?: Partial<T>;
  flags: Record<string, FlagDefinition<T>>;
  required?: Array<keyof T>;
};

export function parseKeyValueFlags<T extends Record<string, unknown>>(
  argv: string[],
  spec: KeyValueFlagSpec<T>,
): T {
  const parsed: Partial<T> = { ...(spec.defaults ?? {}) };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }

    const definition = arg ? spec.flags[arg] : undefined;
    if (!definition) {
      if (arg?.startsWith("--")) {
        throw new Error(`unknown_flag:${arg}`);
      }
      continue;
    }

    const value = argv[index + 1];
    parsed[definition.key] = definition.parse ? definition.parse(value) : value as T[keyof T];
    index += 1;
  }

  for (const key of spec.required ?? []) {
    if (parsed[key] !== undefined) {
      continue;
    }

    const flag = Object.entries(spec.flags).find(([, definition]) => definition.key === key)?.[0] ?? String(key);
    throw new Error(`missing_required_flag: ${flag} is required`);
  }

  return parsed as T;
}

export function parseSubcommandArgs(argv: string[]): ParsedSubcommandArgs {
  const subcommand = argv[0] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) {
      if (arg) {
        positional.push(arg);
      }
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
      continue;
    }

    flags[key] = true;
  }

  return { subcommand, positional, flags };
}

export function resolvePlutoDataDir(): string {
  return resolve(process.env["PLUTO_DATA_DIR"] ?? ".pluto");
}
