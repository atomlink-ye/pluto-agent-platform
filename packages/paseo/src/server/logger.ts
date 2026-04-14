import pino from "pino";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LogFormat = "pretty" | "json";

export interface ResolvedLogConfig {
  level: LogLevel;
  console: {
    level: LogLevel;
    format: LogFormat;
  };
}

type LoggerConfigInput =
  | {
      level?: LogLevel;
      format?: LogFormat;
      log?: {
        level?: LogLevel;
        format?: LogFormat;
        console?: {
          level?: LogLevel;
          format?: LogFormat;
        };
      };
    }
  | undefined;

type ResolveLogConfigOptions = {
  env?: NodeJS.ProcessEnv;
};

const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const LOG_FORMATS: LogFormat[] = ["pretty", "json"];

const DEFAULT_CONSOLE_LEVEL: LogLevel = "info";
const DEFAULT_CONSOLE_FORMAT: LogFormat = "pretty";

function parseLogLevel(value: string | undefined): LogLevel | undefined {
  if (!value || !LOG_LEVELS.includes(value as LogLevel)) {
    return undefined;
  }
  return value as LogLevel;
}

function parseLogFormat(value: string | undefined): LogFormat | undefined {
  if (!value || !LOG_FORMATS.includes(value as LogFormat)) {
    return undefined;
  }
  return value as LogFormat;
}

export function resolveLogConfig(
  configInput?: LoggerConfigInput,
  options?: ResolveLogConfigOptions,
): ResolvedLogConfig {
  const env = options?.env ?? process.env;
  const persistedLog = configInput?.log;

  const envGlobalLevel = parseLogLevel(env.PASEO_LOG);
  const persistedGlobalLevel = persistedLog?.level ?? configInput?.level;

  const consoleLevel: LogLevel =
    parseLogLevel(env.PASEO_LOG_CONSOLE_LEVEL) ??
    envGlobalLevel ??
    persistedLog?.console?.level ??
    persistedGlobalLevel ??
    DEFAULT_CONSOLE_LEVEL;

  const consoleFormat: LogFormat =
    parseLogFormat(env.PASEO_LOG_FORMAT) ??
    persistedLog?.console?.format ??
    persistedLog?.format ??
    configInput?.format ??
    DEFAULT_CONSOLE_FORMAT;

  return {
    level: consoleLevel,
    console: {
      level: consoleLevel,
      format: consoleFormat,
    },
  };
}

export function createRootLogger(configInput?: LoggerConfigInput, options?: ResolveLogConfigOptions) {
  const config = resolveLogConfig(configInput, options);
  return pino({
    level: config.level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
