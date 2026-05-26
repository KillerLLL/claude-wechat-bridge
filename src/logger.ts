type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLevel: LogLevel = "INFO";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatLog(level: LogLevel, msg: string, data?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    msg,
  };
  if (data) Object.assign(entry, data);
  return JSON.stringify(entry);
}

export const logger = {
  debug(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog("DEBUG")) process.stderr.write(formatLog("DEBUG", msg, data) + "\n");
  },
  info(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog("INFO")) process.stderr.write(formatLog("INFO", msg, data) + "\n");
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog("WARN")) process.stderr.write(formatLog("WARN", msg, data) + "\n");
  },
  error(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog("ERROR")) process.stderr.write(formatLog("ERROR", msg, data) + "\n");
  },
};