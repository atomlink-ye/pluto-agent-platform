import { resolve } from "node:path";
import process from "node:process";

export type ParsedSubcommandArgs = {
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
};

type FlagDefinition<T extends object> = {
  key: keyof T;
  parse?: (value: string | undefined) => T[keyof T];
};

export type KeyValueFlagSpec<T extends object> = {
  defaults?: Partial<T>;
  flags: Record<string, FlagDefinition<T>>;
  required?: Array<keyof T>;
};

export function parseKeyValueFlags<T extends object>(
  argv: string[],
  spec: KeyValueFlagSpec<T>,
): T {
  const parsed = Object.assign({} as Partial<T>, spec.defaults ?? {});

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }

    const inlineValueIndex = arg?.indexOf("=") ?? -1;
    const flagName = inlineValueIndex > 0 ? arg?.slice(0, inlineValueIndex) : arg;
    const inlineValue = inlineValueIndex > 0 ? arg?.slice(inlineValueIndex + 1) : undefined;
    const definition = flagName ? spec.flags[flagName] : undefined;
    if (!definition) {
      if (arg?.startsWith("--")) {
        throw new Error(`unknown_flag:${arg}`);
      }
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    parsed[definition.key] = definition.parse ? definition.parse(value) : value as T[keyof T];
    if (inlineValue === undefined) {
      index += 1;
    }
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

    const inlineValueIndex = arg.indexOf("=");
    if (inlineValueIndex > -1) {
      flags[arg.slice(2, inlineValueIndex)] = arg.slice(inlineValueIndex + 1);
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
