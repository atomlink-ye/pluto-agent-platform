import type {
  DataSensitivityClassLikeV0,
  RedactionResultV0,
  RedactionRuleV0,
  SecurityReasonCodeLikeV0,
} from "../contracts/security.js";

export type RedactionStageV0 = "persistence" | "display" | "export" | "audit" | "evidence_seal";

export type RedactionCategoryV0 =
  | "token"
  | "secret_env_name"
  | "dotenv_assignment"
  | "provider_stderr"
  | "private_runtime_ref"
  | "transcript_summary";

export interface ApplyRedactionPolicyInputV0 {
  workspaceId: string;
  sourceSensitivity: DataSensitivityClassLikeV0;
  stage: RedactionStageV0;
  value: unknown;
  now: string;
}

export interface ApplyRedactionPolicyResultV0 {
  blocked: boolean;
  value: unknown;
  summary: {
    hitCount: number;
    categories: RedactionCategoryV0[];
  };
  record: RedactionResultV0;
}

const POLICY_ID = "local-v0-conservative-redaction";
const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|pk)[-_][A-Za-z0-9_-]{16,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g,
  /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\b/g,
];
const TOKEN_PAIR_RE = /\b(?:token|secret|api[_-]?key|bearer|authorization)\s*(?:=|:)\s*[^\s]+/gi;
const DOTENV_ASSIGNMENT_RE = /^([A-Z][A-Z0-9_]*)\s*=\s*(.+)$/;
const SECRET_ENV_NAME_RE = /\b(?:ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|DATABASE_PASSWORD|DATABASE_URL|DAYTONA_API_KEY|FEISHU_APP_SECRET|GITHUB_TOKEN|OPENAI_API_KEY|OPENAI_BASE_URL|OPENCODE_API_KEY|OPENROUTER_API_KEY|SESSION_TOKEN|SLACK_BOT_TOKEN)\b/g;
const SECRET_ENV_SUFFIX_RE = /(?:_TOKEN|_API_KEY|_SECRET|_PASSWORD|_CREDENTIAL|_COOKIE|_SESSION)$/;
const PRIVATE_RUNTIME_ID_RE = /\b(?:run|ses|session|agent|paseo|rt)_[A-Za-z0-9-]{6,}\b/g;
const PRIVATE_RUNTIME_KEY_RE = /(?:^|_)(?:runtime|session|agent|paseo)(?:$|_)/i;
const STDERR_KEY_RE = /(?:^|_)(?:stderr|debug|trace)(?:$|_)/i;
const TRANSCRIPT_KEY_RE = /(?:^|_)(?:transcript|messages)(?:$|_)/i;
const SUMMARY_SNIPPET_LIMIT = 160;

export function applyRedactionPolicyV0(input: ApplyRedactionPolicyInputV0): ApplyRedactionPolicyResultV0 {
  const categories = new Set<RedactionCategoryV0>();
  const state = { hitCount: 0, categories };
  const blocked = isSealingStage(input.stage) && containsHighConfidenceToken(input.value);
  const value = redactUnknown(input.value, state, undefined);
  const reasonCodes: SecurityReasonCodeLikeV0[] = state.hitCount > 0 || blocked ? ["policy_required"] : [];
  const record: RedactionResultV0 = {
    schemaVersion: 0,
    kind: "redaction_result",
    workspaceId: input.workspaceId,
    resultId: `${POLICY_ID}:${input.stage}:${input.now}`,
    policyId: POLICY_ID,
    redactedAt: input.now,
    sourceSensitivity: input.sourceSensitivity,
    resultSensitivity: blocked ? "internal" : input.sourceSensitivity,
    outcome: blocked ? "blocked" : state.hitCount > 0 ? "redacted" : "unchanged",
    redactionCount: state.hitCount,
    reasonCodes,
  };

  return {
    blocked,
    value,
    summary: {
      hitCount: state.hitCount,
      categories: Array.from(categories).sort((left, right) => left.localeCompare(right)),
    },
    record,
  };
}

export function summarizeTranscriptV0(lines: string[]): string {
  const snippets = lines
    .map((line) => redactInlineString(line))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .slice(0, SUMMARY_SNIPPET_LIMIT)
    .trim();
  return snippets.length > 0
    ? `[transcript summary: ${lines.length} lines] ${snippets}`
    : `[transcript summary: ${lines.length} lines]`;
}

export function assertSealableRedactionV0(value: unknown): void {
  if (containsHighConfidenceToken(value)) {
    throw new Error("security_redaction_blocked");
  }
}

function redactUnknown(
  value: unknown,
  state: { hitCount: number; categories: Set<RedactionCategoryV0> },
  parentKey?: string,
): unknown {
  if (typeof value === "string") {
    return redactStringValue(value, state, parentKey);
  }

  if (Array.isArray(value)) {
    if (parentKey && TRANSCRIPT_KEY_RE.test(parentKey) && value.every((entry) => typeof entry === "string")) {
      state.hitCount += 1;
      state.categories.add("transcript_summary");
      return summarizeTranscriptV0(value as string[]);
    }
    return value.map((entry) => redactUnknown(entry, state, parentKey));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactUnknown(entry, state, key)]),
    );
  }

  return value;
}

function redactStringValue(
  value: string,
  state: { hitCount: number; categories: Set<RedactionCategoryV0> },
  parentKey?: string,
): string {
  if (parentKey && STDERR_KEY_RE.test(parentKey)) {
    state.hitCount += 1;
    state.categories.add("provider_stderr");
    return summarizeProviderStderr(value, state);
  }

  if (parentKey && PRIVATE_RUNTIME_KEY_RE.test(parentKey) && PRIVATE_RUNTIME_ID_RE.test(value)) {
    PRIVATE_RUNTIME_ID_RE.lastIndex = 0;
    state.hitCount += 1;
    state.categories.add("private_runtime_ref");
    return "[REDACTED]";
  }
  PRIVATE_RUNTIME_ID_RE.lastIndex = 0;

  const dotenvMatch = DOTENV_ASSIGNMENT_RE.exec(value.trim());
  if (dotenvMatch) {
    const key = dotenvMatch[1]!;
    const assignedValue = dotenvMatch[2]!;
    if (SECRET_ENV_SUFFIX_RE.test(key) || isKnownSecretEnvName(key) || containsHighConfidenceToken(assignedValue)) {
      state.hitCount += 1;
      state.categories.add("dotenv_assignment");
      if (SECRET_ENV_SUFFIX_RE.test(key) || isKnownSecretEnvName(key)) {
        state.categories.add("secret_env_name");
      }
      if (containsHighConfidenceToken(assignedValue)) {
        state.categories.add("token");
      }
      return "[REDACTED]";
    }
  }

  let result = value;

  result = result.replace(SECRET_ENV_NAME_RE, () => {
    state.hitCount += 1;
    state.categories.add("secret_env_name");
    return "[REDACTED]";
  });

  result = result.replace(PRIVATE_RUNTIME_ID_RE, () => {
    state.hitCount += 1;
    state.categories.add("private_runtime_ref");
    return "[REDACTED]";
  });

  result = result.replace(TOKEN_PAIR_RE, (match) => {
    state.hitCount += 1;
    state.categories.add("token");
    const separator = match.includes(":") ? ":" : "=";
    const key = match.slice(0, match.indexOf(separator)).trim();
    return `${key}${separator}[REDACTED]`;
  });

  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, () => {
      state.hitCount += 1;
      state.categories.add("token");
      return "[REDACTED]";
    });
  }

  return result;
}

function summarizeProviderStderr(
  value: string,
  state: { hitCount: number; categories: Set<RedactionCategoryV0> },
): string {
  const lines = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => redactInlineString(line))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  if (lines.some((line) => line.includes("[REDACTED]"))) {
    state.categories.add("token");
  }
  if (lines.some((line) => line.includes("ses_") || line.includes("run_"))) {
    state.categories.add("private_runtime_ref");
  }

  const first = lines[0]!.slice(0, SUMMARY_SNIPPET_LIMIT).trim();
  return `${first || "provider stderr redacted"} [stderr ${lines.length} lines]`;
}

function redactInlineString(value: string): string {
  let result = value.replace(SECRET_ENV_NAME_RE, "[REDACTED]");
  result = result.replace(PRIVATE_RUNTIME_ID_RE, "[REDACTED]");
  result = result.replace(TOKEN_PAIR_RE, (match) => {
    const separator = match.includes(":") ? ":" : "=";
    const key = match.slice(0, match.indexOf(separator)).trim();
    return `${key}${separator}[REDACTED]`;
  });
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function containsHighConfidenceToken(value: unknown): boolean {
  if (typeof value === "string") {
    return TOKEN_PATTERNS.some((pattern) => {
      const matched = pattern.test(value);
      pattern.lastIndex = 0;
      return matched;
    });
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsHighConfidenceToken(entry));
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([key, entry]) => containsHighConfidenceToken(key) || containsHighConfidenceToken(entry));
  }

  return false;
}

function isSealingStage(stage: RedactionStageV0): boolean {
  return stage === "export" || stage === "evidence_seal";
}

function isKnownSecretEnvName(value: string): boolean {
  SECRET_ENV_NAME_RE.lastIndex = 0;
  return SECRET_ENV_NAME_RE.test(value);
}

export const DEFAULT_REDACTION_RULES_V0: RedactionRuleV0[] = [
  {
    path: "**",
    action: "mask",
    minSensitivity: "internal",
    reasonCode: "policy_required",
  },
];
