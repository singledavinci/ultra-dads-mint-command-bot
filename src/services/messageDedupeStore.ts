import fs from 'fs-extra';
import path from 'node:path';

interface DedupeEntry {
    sentAt: number;
}

const memory = new Map<string, DedupeEntry>();
let duplicatesSuppressed = 0;
let sentCount = 0;

const DEFAULT_TTL_MS = parseInt(process.env.MESSAGE_DEDUPE_TTL_MS || '300000', 10);

function dataDir(): string | null {
    const dir = process.env.DATA_DIR?.trim();
    if (dir) return dir;
    const fallback = path.join(process.cwd(), 'data');
    try {
        if (fs.existsSync(fallback)) return fallback;
    } catch {
        /* ignore */
    }
    return null;
}

function persistPath(): string | null {
    const dir = dataDir();
    return dir ? path.join(dir, 'message-dedupe.json') : null;
}

async function loadPersisted(): Promise<void> {
    const file = persistPath();
    if (!file) return;
    try {
        if (!(await fs.pathExists(file))) return;
        const raw = (await fs.readJson(file)) as Record<string, number>;
        const now = Date.now();
        for (const [key, sentAt] of Object.entries(raw)) {
            if (now - sentAt < DEFAULT_TTL_MS * 4) {
                memory.set(key, { sentAt });
            }
        }
    } catch {
        /* ignore corrupt file */
    }
}

async function persist(): Promise<void> {
    const file = persistPath();
    if (!file) return;
    try {
        const now = Date.now();
        const out: Record<string, number> = {};
        for (const [key, entry] of memory) {
            if (now - entry.sentAt < DEFAULT_TTL_MS * 4) {
                out[key] = entry.sentAt;
            }
        }
        await fs.ensureDir(path.dirname(file));
        await fs.writeJson(file, out);
    } catch {
        /* ignore */
    }
}

let loaded = false;

async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    await loadPersisted();
}

function pruneExpired(ttlMs: number): void {
    const now = Date.now();
    for (const [key, entry] of memory) {
        if (now - entry.sentAt >= ttlMs) memory.delete(key);
    }
}

/**
 * Returns true if the message should be sent (not a duplicate within TTL).
 */
export function shouldSendMessage(key: string, ttlMs: number = DEFAULT_TTL_MS): boolean {
    void ensureLoaded();
    pruneExpired(ttlMs);
    const entry = memory.get(key);
    if (!entry) return true;
    if (Date.now() - entry.sentAt >= ttlMs) return true;
    duplicatesSuppressed++;
    return false;
}

export function recordSent(key: string): void {
    memory.set(key, { sentAt: Date.now() });
    sentCount++;
    void persist();
}

export function getStats(): {
    duplicatesSuppressed: number;
    sentCount: number;
    activeKeys: number;
} {
    return {
        duplicatesSuppressed,
        sentCount,
        activeKeys: memory.size,
    };
}

export async function shouldSendMessageAsync(
    key: string,
    ttlMs: number = DEFAULT_TTL_MS
): Promise<boolean> {
    await ensureLoaded();
    return shouldSendMessage(key, ttlMs);
}
