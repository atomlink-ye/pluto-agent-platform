/**
 * Log text parsing utilities for extracting assistant text from Paseo logs.
 *
 * The CLI emits plain text in the format:
 *   [User] <prompt>
 *   <assistant text...>
 *   [Thought] <reasoning>
 *
 * We strip lines that start with `[Tag]` and keep the rest. If multiple
 * user/assistant turns exist, we slice from the LAST `[User] ...` marker.
 */

export interface ExtractAssistantTextFromLogsInput {
  rawLogs: string;
  echoedPrompt?: string;
}

/**
 * Extract assistant text from raw `paseo logs --filter text` output.
 *
 * @param rawLogs - Raw stdout from the CLI
 * @param echoedPrompt - Optional prompt that was sent to the agent (for stripping)
 * @returns Extracted assistant text
 */
export function extractAssistantTextFromLogs(rawLogs: string, echoedPrompt?: string): string {
  const lines = rawLogs.split(/\r?\n/);
  // Find the index of the last [User] line; assistant text is after it.
  let lastUserIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.startsWith("[User]")) {
      lastUserIdx = i;
      break;
    }
  }
  const slice = lastUserIdx >= 0 ? lines.slice(lastUserIdx + 1) : lines;
  const kept: string[] = [];
  for (const line of slice) {
    if (/^\[[A-Za-z][^\]]*\]/.test(line)) {
      if (kept.length > 0) break;
      continue;
    }
    kept.push(line);
  }
  const stripped = stripEchoedPromptPrefix(kept, echoedPrompt);
  // Trim trailing blank lines without collapsing meaningful blanks inside.
  while (stripped.length > 0 && stripped[stripped.length - 1]!.trim().length === 0) {
    stripped.pop();
  }
  return stripped.join("\n").trimStart();
}

/**
 * Strip the echoed prompt prefix from assistant text.
 *
 * Real paseo/OpenCode logs sometimes put the first user-prompt line on the
 * `[User] ...` marker itself and then echo the rest of the worker prompt as
 * plain text. Strip this protocol header even when it is not an exact full
 * prompt match; otherwise worker contributions leak "Instructions from the
 * Team Lead" into summaries and artifacts.
 */
export function stripEchoedPromptPrefix(lines: string[], echoedPrompt?: string): string[] {
  const firstContentIdx = lines.findIndex((line) => line.trim().length > 0);
  const normalizedLines = firstContentIdx >= 0 ? lines.slice(firstContentIdx) : [];

  // Real paseo/OpenCode logs sometimes put the first user-prompt line on the
  // `[User] ...` marker itself and then echo the rest of the worker prompt as
  // plain text. Strip this protocol header even when it is not an exact full
  // prompt match; otherwise worker contributions leak "Instructions from the
  // Team Lead" into summaries and artifacts.
  const protocolEndIdx = normalizedLines.findIndex((line) =>
    line.startsWith("Reply with your contribution only"),
  );
  if (
    protocolEndIdx >= 0 &&
    normalizedLines
      .slice(0, protocolEndIdx + 1)
      .some((line) => line === "Instructions from the Team Lead:")
  ) {
    let next = protocolEndIdx + 1;
    while (next < normalizedLines.length && normalizedLines[next]!.trim() === "") next++;
    return normalizedLines.slice(next);
  }

  if (!echoedPrompt) return [...normalizedLines];
  const promptLines = echoedPrompt.split(/\r?\n/);
  const compactPromptHead = echoedPrompt.split(" | ")[0];
  const instructionIdx = promptLines.findIndex((line) => line === "Instructions from the Team Lead:");
  const instructionSuffix = instructionIdx >= 0 ? promptLines.slice(instructionIdx) : [];
  const candidates = [
    promptLines,
    instructionSuffix,
    compactPromptHead ? [compactPromptHead] : [],
  ].filter((candidate) => candidate.length > 0);

  for (const candidate of candidates) {
    if (candidate.length > normalizedLines.length) continue;
    let matches = true;
    for (let i = 0; i < candidate.length; i++) {
      if ((normalizedLines[i] ?? "") !== candidate[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      let next = candidate.length;
      while (next < normalizedLines.length && normalizedLines[next]!.trim() === "") next++;
      return normalizedLines.slice(next);
    }
  }
  return [...normalizedLines];
}