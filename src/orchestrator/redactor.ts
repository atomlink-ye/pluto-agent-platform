import { isAbsolute, win32 } from "node:path";

const SECRET_PATTERNS = [
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:sk|pk)[_-][A-Za-z0-9_-]{16,}\b/gi,
  /\b(?:api|key|token|secret|bearer|auth)[_-]?[A-Za-z0-9]{16,}\b/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
  /\bxoxb-[A-Za-z0-9-]+\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}/g,
];

const KNOWN_SECRET_ENV_NAMES = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENCODE_API_KEY",
  "OPENROUTER_API_KEY",
  "DAYTONA_API_KEY",
  "DATABASE_URL",
  "LARK_APP_ID",
  "FEISHU_APP_SECRET",
  "OPENAI_BASE_URL",
];

const ENV_ASSIGNMENT_RE = /\b([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+)/g;
const SECRET_ENV_SUFFIX_RE = /(?:_TOKEN|_API_KEY|_SECRET|_ID|_PASSWORD|_CREDENTIAL)$/;
const STDERR_KEY_RE = /(?:^|_)(?:stderr|debug)(?:$|_)/i;
const ABSOLUTE_PATH_KEY_RE = /(?:^|_)(?:path|paths|cwd)$|^(?:workspacePath|artifactPath)$/i;

function shouldRedactEnvAssignment(key: string): boolean {
  return (
    KNOWN_SECRET_ENV_NAMES.includes(key) ||
    SECRET_ENV_SUFFIX_RE.test(key)
  );
}

function redactEnvAssignments(text: string): string {
  return text.replace(ENV_ASSIGNMENT_RE, (match, key: string) => {
    if (!shouldRedactEnvAssignment(key)) return match;
    return "[REDACTED]";
  });
}

export function redactString(text: string): string {
  let result = text;

  for (const name of KNOWN_SECRET_ENV_NAMES) {
    const envVal = process.env[name];
    if (envVal && envVal.length > 4) {
      result = result.replaceAll(envVal, "[REDACTED]");
    }
  }

  result = redactEnvAssignments(result);

  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), "[REDACTED]");
  }

  return result;
}

export function summarizeProviderStderr(text: string): string {
  const redacted = redactString(text).replace(/\r\n/g, "\n").trim();
  if (!redacted) return "";

  const lines = redacted
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  const firstLine = lines[0]!.replace(/\s+/g, " ").slice(0, 240);
  return lines.length === 1 ? firstLine : `${firstLine} [stderr ${lines.length} lines]`;
}

function redactValue(value: unknown, parentKey?: string): unknown {
  if (typeof value === "string") {
    if (parentKey && ABSOLUTE_PATH_KEY_RE.test(parentKey)) {
      const redacted = redactString(value);
      if (isAbsolute(redacted) || win32.isAbsolute(redacted)) {
        return parentKey === "workspacePath"
          ? "[REDACTED:workspace-path]"
          : "[REDACTED:path]";
      }
      return redacted;
    }
    return parentKey && STDERR_KEY_RE.test(parentKey)
      ? summarizeProviderStderr(value)
      : redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, parentKey));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, key)]),
    );
  }

  return value;
}

export function redactObject(value: unknown): unknown {
  return redactValue(value);
}

export function redactWorkspacePath(workspacePath: string): string {
  const redacted = redactString(workspacePath);
  if (isAbsolute(redacted) || win32.isAbsolute(redacted)) return "[REDACTED:workspace-path]";
  return redacted;
}
