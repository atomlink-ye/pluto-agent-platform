import { FourLayerLoaderError, type MutableRecord } from "./loader-shared.js";

type YamlLine = { raw: string; indent: number; trimmed: string };

interface YamlState {
  lines: YamlLine[];
  index: number;
  filePath: string;
}

export function parseYaml(source: string, filePath = "<inline>"): unknown {
  const lines = source.split(/\r?\n/).map<YamlLine>((raw) => ({
    raw,
    indent: raw.match(/^\s*/)?.[0].length ?? 0,
    trimmed: raw.trim(),
  }));

  const state: YamlState = { lines, index: 0, filePath };
  skipIgnorable(state);
  if (state.index >= lines.length) {
    return {};
  }
  return parseBlock(state, lines[state.index]!.indent);
}

function skipIgnorable(state: Pick<YamlState, "lines" | "index">): void {
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]!;
    if (line.trimmed === "" || line.trimmed.startsWith("#")) {
      state.index += 1;
      continue;
    }
    break;
  }
}

function parseBlock(state: YamlState, indent: number): unknown {
  const line = state.lines[state.index]!;
  if (line.trimmed.startsWith("- ")) {
    return parseSequence(state, indent);
  }
  return parseMapping(state, indent);
}

function parseMapping(state: YamlState, indent: number): MutableRecord {
  const result: MutableRecord = {};

  while (state.index < state.lines.length) {
    skipIgnorable(state);
    if (state.index >= state.lines.length) break;
    const line = state.lines[state.index]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new FourLayerLoaderError(`invalid_yaml:${state.filePath}`, [`unexpected indentation at line ${state.index + 1}`]);
    }
    if (line.trimmed.startsWith("- ")) break;

    const separatorIndex = findKeySeparator(line.trimmed);
    if (separatorIndex < 0) {
      throw new FourLayerLoaderError(`invalid_yaml:${state.filePath}`, [`expected key:value at line ${state.index + 1}`]);
    }

    const key = line.trimmed.slice(0, separatorIndex).trim();
    const rest = line.trimmed.slice(separatorIndex + 1).trim();
    state.index += 1;

    if (rest === "|" || rest === "|-") {
      result[key] = parseBlockScalar(state, indent + 2);
      continue;
    }

    if (rest.length === 0) {
      skipIgnorable(state);
      if (state.index < state.lines.length && state.lines[state.index]!.indent > indent) {
        result[key] = parseBlock(state, state.lines[state.index]!.indent);
      } else {
        result[key] = null;
      }
      continue;
    }

    result[key] = parseScalar(rest, state.filePath, state.index);
  }

  return result;
}

function parseSequence(state: YamlState, indent: number): unknown[] {
  const result: unknown[] = [];

  while (state.index < state.lines.length) {
    skipIgnorable(state);
    if (state.index >= state.lines.length) break;
    const line = state.lines[state.index]!;
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.trimmed.startsWith("- ")) break;

    const rest = line.trimmed.slice(2).trim();
    state.index += 1;

    if (rest === "|" || rest === "|-") {
      result.push(parseBlockScalar(state, indent + 2));
      continue;
    }

    if (rest.length === 0) {
      skipIgnorable(state);
      if (state.index < state.lines.length && state.lines[state.index]!.indent > indent) {
        result.push(parseBlock(state, state.lines[state.index]!.indent));
      } else {
        result.push(null);
      }
      continue;
    }

    const separatorIndex = findKeySeparator(rest);
    const nextSignificantLine = peekNextSignificantLine(state);
    if (
      separatorIndex > 0
      && !rest.startsWith("{")
      && !rest.startsWith("[")
      && (
        rest.slice(separatorIndex + 1).trim().length > 0
        || (nextSignificantLine !== null && nextSignificantLine.indent > indent)
      )
    ) {
      const key = rest.slice(0, separatorIndex).trim();
      const valueText = rest.slice(separatorIndex + 1).trim();
      const item: MutableRecord = {
        [key]: valueText === "" ? null : parseScalar(valueText, state.filePath, state.index),
      };
      skipIgnorable(state);
      if (state.index < state.lines.length && state.lines[state.index]!.indent > indent) {
        const nested = parseBlock(state, state.lines[state.index]!.indent);
        if (!isRecord(nested)) {
          throw new FourLayerLoaderError(`invalid_yaml:${state.filePath}`, [`sequence mapping item at line ${state.index} must continue with mapping content`]);
        }
        Object.assign(item, nested);
      }
      result.push(item);
      continue;
    }

    result.push(parseScalar(rest, state.filePath, state.index));
  }

  return result;
}

function peekNextSignificantLine(state: Pick<YamlState, "lines" | "index">): YamlLine | null {
  let index = state.index;
  while (index < state.lines.length) {
    const line = state.lines[index]!;
    if (line.trimmed !== "" && !line.trimmed.startsWith("#")) {
      return line;
    }
    index += 1;
  }
  return null;
}

function parseBlockScalar(state: Pick<YamlState, "lines" | "index">, indent: number): string {
  const lines: string[] = [];
  while (state.index < state.lines.length) {
    const line = state.lines[state.index]!;
    if (line.trimmed !== "" && line.indent < indent) {
      break;
    }
    if (line.trimmed === "") {
      lines.push("");
      state.index += 1;
      continue;
    }
    lines.push(line.raw.slice(Math.min(indent, line.raw.length)));
    state.index += 1;
  }
  return lines.join("\n");
}

function parseScalar(value: string, filePath: string, lineNumber: number): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInline(value.slice(1, -1)).map((entry) => parseScalar(entry, filePath, lineNumber));
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const record: MutableRecord = {};
    for (const entry of splitInline(value.slice(1, -1))) {
      const separatorIndex = findKeySeparator(entry);
      if (separatorIndex < 0) {
        throw new FourLayerLoaderError(`invalid_yaml:${filePath}`, [`invalid inline mapping at line ${lineNumber}`]);
      }
      const key = entry.slice(0, separatorIndex).trim();
      record[key] = parseScalar(entry.slice(separatorIndex + 1).trim(), filePath, lineNumber);
    }
    return record;
  }
  return stripTrailingComment(value);
}

function stripTrailingComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
    if (char === "#" && !inSingle && !inDouble && index > 0 && /\s/.test(value[index - 1]!)) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function splitInline(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (const char of value) {
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (char === "[" || char === "{") depth += 1;
      if (char === "]" || char === "}") depth -= 1;
      if (char === "," && depth === 0) {
        if (current.trim().length > 0) result.push(current.trim());
        current = "";
        continue;
      }
    }
    current += char;
  }

  if (current.trim().length > 0) result.push(current.trim());
  return result;
}

function findKeySeparator(value: string): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (char === "[" || char === "{") depth += 1;
      if (char === "]" || char === "}") depth -= 1;
      if (char === ":" && depth === 0) return index;
    }
  }
  return -1;
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
