import type { RedactionSummaryV0 } from "../contracts/observability.js";
import type { ObservabilityRecordV0 } from "./query.js";

export interface ObservabilityPersistenceRedactionResultV0 {
  record: ObservabilityRecordV0;
  changed: boolean;
  redactionCount: number;
  redactedPaths: string[];
}

export interface ObservabilityRedactionResultV0<T extends ObservabilityRecordV0> {
  value: T;
  summary: RedactionSummaryV0;
}

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
const SESSION_ID_RE = /\b(?:ses|sess|session|agent|run)_[A-Za-z0-9-]{6,}\b/g;
const CREDENTIAL_KEY_RE = /token|secret|api[_-]?key|credential|password|authorization|cookie|session/i;
const STDERR_KEY_RE = /stderr|debug|trace/i;
const DOTENV_KEY_RE = /(?:env|dotenv|environment)/i;
const EXTERNAL_PAYLOAD_KEY_RE = /external.*payload|provider.*payload|request.*payload|response.*payload|request.*body|response.*body|raw.*payload|raw.*response|payload$|response$/i;
const SUMMARY_LIMIT = 160;

export function redactObservabilityRecordForPersistence(record: ObservabilityRecordV0): ObservabilityPersistenceRedactionResultV0 {
  const state = { redactionCount: 0, redactedPaths: new Set<string>() };
  const redacted = redactUnknown(record, state, []);
  const persisted = applyAuditSummaries(redacted as ObservabilityRecordV0, state);
  return {
    record: persisted,
    changed: state.redactionCount > 0,
    redactionCount: state.redactionCount,
    redactedPaths: Array.from(state.redactedPaths).sort((left, right) => left.localeCompare(right)),
  };
}

export function redactObservabilityRecordV0<T extends ObservabilityRecordV0>(record: T): ObservabilityRedactionResultV0<T> {
  const result = redactObservabilityRecordForPersistence(record);
  return {
    value: result.record as T,
    summary: result.record.audit.redaction,
  };
}

function redactUnknown(
  value: unknown,
  state: { redactionCount: number; redactedPaths: Set<string> },
  path: string[],
): unknown {
  if (typeof value === "string") {
    return redactStringValue(value, state, path);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => redactUnknown(entry, state, [...path, String(index)]));
  }

  if (typeof value === "object" && value !== null) {
    const objectPath = path.join(".");
    const leaf = path[path.length - 1] ?? "";
    if (EXTERNAL_PAYLOAD_KEY_RE.test(leaf)) {
      noteRedaction(state, objectPath);
      return summarizeExternalPayload(value);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactUnknown(entry, state, [...path, key])]),
    );
  }

  return value;
}

function redactStringValue(
  value: string,
  state: { redactionCount: number; redactedPaths: Set<string> },
  path: string[],
): string {
  const joinedPath = path.join(".");
  const leaf = path[path.length - 1] ?? "";
  const normalizedLeaf = leaf.toLowerCase();

  if (EXTERNAL_PAYLOAD_KEY_RE.test(normalizedLeaf)) {
    noteRedaction(state, joinedPath);
    return "[REDACTED:external-payload]";
  }

  if (STDERR_KEY_RE.test(normalizedLeaf)) {
    noteRedaction(state, joinedPath);
    return summarizeProviderStderr(value);
  }

  if (DOTENV_KEY_RE.test(normalizedLeaf) && looksLikeDotenvPayload(value)) {
    noteRedaction(state, joinedPath);
    return "[REDACTED]";
  }

  if (CREDENTIAL_KEY_RE.test(normalizedLeaf)) {
    noteRedaction(state, joinedPath);
    return containsSessionId(value) ? "[REDACTED:session]" : "[REDACTED]";
  }

  const dotenvMatch = DOTENV_ASSIGNMENT_RE.exec(value.trim());
  if (dotenvMatch) {
    const envName = dotenvMatch[1] ?? "";
    const envValue = dotenvMatch[2] ?? "";
    if (SECRET_ENV_SUFFIX_RE.test(envName) || isKnownSecretEnvName(envName) || containsHighConfidenceToken(envValue)) {
      noteRedaction(state, joinedPath);
      return "[REDACTED]";
    }
  }

  let result = value;
  let changed = false;

  result = result.replace(SECRET_ENV_NAME_RE, () => {
    changed = true;
    return "[REDACTED]";
  });

  result = result.replace(TOKEN_PAIR_RE, (match) => {
    changed = true;
    const separator = match.includes(":") ? ":" : "=";
    const key = match.slice(0, match.indexOf(separator)).trim();
    return `${key}${separator}[REDACTED]`;
  });

  result = result.replace(SESSION_ID_RE, () => {
    changed = true;
    return "[REDACTED:session]";
  });

  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, () => {
      changed = true;
      return "[REDACTED]";
    });
  }

  if (changed) {
    noteRedaction(state, joinedPath);
  }

  return result;
}

function applyAuditSummaries(
  record: ObservabilityRecordV0,
  state: { redactionCount: number; redactedPaths: Set<string> },
): ObservabilityRecordV0 {
  if (state.redactionCount === 0) {
    return record;
  }

  const redactedPaths = Array.from(new Set([...record.audit.redaction.redactedPaths, ...state.redactedPaths]))
    .sort((left, right) => left.localeCompare(right));
  const auditRedaction = mergeRedactionSummary(record.audit.redaction, redactedPaths, true);

  if (record.kind === "redacted_trace") {
    return {
      ...record,
      audit: { ...record.audit, redaction: auditRedaction },
      redaction: mergeRedactionSummary(record.redaction, redactedPaths, true),
    };
  }

  return {
    ...record,
    audit: { ...record.audit, redaction: auditRedaction },
  };
}

function mergeRedactionSummary(
  summary: RedactionSummaryV0,
  redactedPaths: string[],
  containsSensitiveData: boolean,
): RedactionSummaryV0 {
  return {
    containsSensitiveData: summary.containsSensitiveData || containsSensitiveData,
    state: redactedPaths.length > 0 && summary.state === "clear" ? "redacted" : summary.state,
    redactionCount: Math.max(summary.redactionCount, redactedPaths.length),
    redactedPaths,
  };
}

function summarizeProviderStderr(value: string): string {
  const firstLine = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => redactInlineString(line).trim())
    .find((line) => line.length > 0);
  const preview = firstLine?.slice(0, SUMMARY_LIMIT) ?? "provider stderr redacted";
  const lineCount = value.length === 0 ? 0 : value.replace(/\r\n/g, "\n").split("\n").length;
  return `${preview} [stderr ${lineCount} lines]`;
}

function summarizeExternalPayload(value: object): string {
  const keys = Object.keys(value).slice(0, 3).join(",");
  return keys.length > 0 ? `[REDACTED:external-payload keys=${keys}]` : "[REDACTED:external-payload]";
}

function redactInlineString(value: string): string {
  let result = value.replace(SECRET_ENV_NAME_RE, "[REDACTED]");
  result = result.replace(TOKEN_PAIR_RE, (match) => {
    const separator = match.includes(":") ? ":" : "=";
    const key = match.slice(0, match.indexOf(separator)).trim();
    return `${key}${separator}[REDACTED]`;
  });
  result = result.replace(SESSION_ID_RE, "[REDACTED:session]");
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function containsHighConfidenceToken(value: string): boolean {
  return TOKEN_PATTERNS.some((pattern) => {
    const matched = pattern.test(value);
    pattern.lastIndex = 0;
    return matched;
  });
}

function containsSessionId(value: string): boolean {
  const matched = SESSION_ID_RE.test(value);
  SESSION_ID_RE.lastIndex = 0;
  return matched;
}

function isKnownSecretEnvName(value: string): boolean {
  const matched = SECRET_ENV_NAME_RE.test(value);
  SECRET_ENV_NAME_RE.lastIndex = 0;
  return matched;
}

function looksLikeDotenvPayload(value: string): boolean {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => DOTENV_ASSIGNMENT_RE.test(line.trim()));
}

function noteRedaction(
  state: { redactionCount: number; redactedPaths: Set<string> },
  path: string,
): void {
  state.redactionCount += 1;
  if (path.length > 0) {
    state.redactedPaths.add(path);
  }
}
