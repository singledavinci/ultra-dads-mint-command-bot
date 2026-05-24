/**
 * Production-safe logging — avoids Railway 500 logs/sec cap.
 *
 * LOG_LEVEL=error|warn|info|debug (default: info in production, debug otherwise)
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

function resolveLevel(): LogLevel {
    const raw = (process.env.LOG_LEVEL || '').toLowerCase();
    if (raw === 'error' || raw === 'warn' || raw === 'info' || raw === 'debug') {
        return raw;
    }
    return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const activeLevel = resolveLevel();
const activeRank = LEVEL_RANK[activeLevel];

const lastKeyedLog = new Map<string, number>();

function shouldLog(level: LogLevel): boolean {
    return LEVEL_RANK[level] <= activeRank;
}

export function log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!shouldLog(level)) return;
    if (level === 'error') console.error(message, ...args);
    else if (level === 'warn') console.warn(message, ...args);
    else console.log(message, ...args);
}

/** Emit at most once per key per interval (drops duplicates silently). */
export function logRateLimited(
    key: string,
    intervalMs: number,
    level: LogLevel,
    message: string,
    ...args: unknown[]
): void {
    const now = Date.now();
    const last = lastKeyedLog.get(key) ?? 0;
    if (now - last < intervalMs) return;
    lastKeyedLog.set(key, now);
    log(level, message, ...args);
}

export function isDebugLogging(): boolean {
    return shouldLog('debug');
}
