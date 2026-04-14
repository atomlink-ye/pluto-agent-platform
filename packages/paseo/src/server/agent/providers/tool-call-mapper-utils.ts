type ReadChunkLike = { text?: string; content?: string; output?: string };

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const CODEX_SHELL_ENVELOPE_HEADER_LINES = new Set([
  "chunk id:",
  "wall time:",
  "process exited with code",
  "original token count:",
]);

function isCodexShellEnvelopeHeaderLine(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  for (const prefix of CODEX_SHELL_ENVELOPE_HEADER_LINES) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

function looksLikeCodexShellEnvelope(lines: string[]): boolean {
  if (lines.length === 0) return false;
  const first = lines[0]?.trim().toLowerCase() ?? "";
  if (!first.startsWith("chunk id:")) return false;
  const headerWindow = lines.slice(0, 8).map((line) => line.trim().toLowerCase());
  return (
    headerWindow.some((line) => line.startsWith("wall time:")) &&
    headerWindow.some((line) => line.startsWith("process exited with code"))
  );
}

export function extractCodexShellOutput(value: string | undefined): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (!looksLikeCodexShellEnvelope(lines)) return text;
  const outputLineIndex = lines.findIndex((line) => line.trim() === "Output:");
  if (outputLineIndex >= 0) {
    return nonEmptyString(lines.slice(outputLineIndex + 1).join("\n"));
  }
  let firstBodyLineIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (!isCodexShellEnvelopeHeaderLine(lines[index] ?? "")) {
      firstBodyLineIndex = index;
      break;
    }
  }
  return firstBodyLineIndex === -1 ? undefined : nonEmptyString(lines.slice(firstBodyLineIndex).join("\n"));
}

export function flattenReadContent<Chunk extends ReadChunkLike>(
  value: string | Chunk | Chunk[] | undefined,
): string | undefined {
  if (typeof value === "string") return nonEmptyString(value);
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const parts = value
      .map((chunk) => nonEmptyString(chunk.text) ?? nonEmptyString(chunk.content) ?? nonEmptyString(chunk.output))
      .filter((part): part is string => typeof part === "string");
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return nonEmptyString(value.text) ?? nonEmptyString(value.content) ?? nonEmptyString(value.output);
}

export function truncateDiffText(text: string | undefined, maxChars: number = 12_000): string | undefined {
  if (typeof text !== "string") return undefined;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}
