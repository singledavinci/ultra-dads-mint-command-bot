/**
 * Deduplication service — prevents the same whale tx from triggering
 * multiple copy-trade broadcasts when detected via both pending + confirmed paths.
 *
 * Uses a time-bounded LRU cache. Entries expire after DEDUPE_TTL_MS.
 * Persists to data/seen-whale-txs.json so deploy restarts do not replay old mints.
 */

import fs from 'fs-extra';
import path from 'path';

const DEFAULT_TTL = 300_000; // 5 minutes
const MAX_ENTRIES = 2000;
const SEEN_TX_LEDGER_FILE = path.join(process.cwd(), 'data', 'seen-whale-txs.json');

function getTTL(): number {
    try {
        const ms = parseInt(process.env.DEDUPE_TTL_MS || '', 10);
        return ms > 0 ? ms : DEFAULT_TTL;
    } catch {
        return DEFAULT_TTL;
    }
}

function persistEnabled(): boolean {
    return process.env.TRACKER_SEEN_TX_PERSIST !== 'false';
}

interface DedupeEntry {
    seenAt: number;
    source: 'pending' | 'confirmed' | 'manual';
}

const seenTxs = new Map<string, DedupeEntry>();
let ledgerLoaded = false;

async function loadLedgerFromDisk(): Promise<void> {
    if (ledgerLoaded || !persistEnabled()) {
        ledgerLoaded = true;
        return;
    }
    ledgerLoaded = true;
    const ttl = getTTL();
    const now = Date.now();
    try {
        if (await fs.pathExists(SEEN_TX_LEDGER_FILE)) {
            const raw = await fs.readJson(SEEN_TX_LEDGER_FILE);
            if (raw && typeof raw === 'object') {
                let loaded = 0;
                for (const [hash, seenAt] of Object.entries(raw)) {
                    const t = Number(seenAt);
                    if (!hash || !Number.isFinite(t) || now - t > ttl) continue;
                    const key = hash.toLowerCase();
                    if (!seenTxs.has(key)) {
                        seenTxs.set(key, { seenAt: t, source: 'confirmed' });
                        loaded++;
                    }
                }
                if (loaded > 0) {
                    console.log(`[Dedupe] Restored ${loaded} seen tx hash(es) from ledger (deploy replay guard).`);
                }
            }
        }
    } catch (err) {
        console.warn('[Dedupe] Failed to load seen-tx ledger:', (err as Error).message);
        try {
            await fs.remove(SEEN_TX_LEDGER_FILE);
        } catch {
            // ignore
        }
    }
}

function schedulePersistLedger(): void {
    if (!persistEnabled()) return;
    void (async () => {
        try {
            const ttl = getTTL();
            const now = Date.now();
            const out: Record<string, number> = {};
            for (const [hash, entry] of seenTxs) {
                if (now - entry.seenAt <= ttl) out[hash] = entry.seenAt;
            }
            await fs.ensureDir(path.dirname(SEEN_TX_LEDGER_FILE));
            await fs.writeJson(SEEN_TX_LEDGER_FILE, out);
        } catch {
            // non-fatal
        }
    })();
}

/** Call once at bot boot before tracker starts. */
export async function warmDedupeLedger(): Promise<void> {
    await loadLedgerFromDisk();
    try {
        const { StateManager } = await import('../bot/stateManager.js');
        if (StateManager.isConnected()) {
            const hashes = await StateManager.loadSeenWhaleTxHashes(getTTL());
            let added = 0;
            for (const hash of hashes) {
                if (!seenTxs.has(hash)) {
                    seenTxs.set(hash, { seenAt: Date.now(), source: 'confirmed' });
                    added++;
                }
            }
            if (added > 0) {
                console.log(`[Dedupe] Restored ${added} seen tx hash(es) from MongoDB.`);
            }
        }
    } catch (err) {
        console.warn('[Dedupe] Mongo warm load skipped:', (err as Error).message);
    }
}

function persistSeenToMongo(txHash: string): void {
    void import('../bot/stateManager.js')
        .then(({ StateManager }) => StateManager.persistSeenWhaleTx(txHash))
        .catch(() => {});
}

/**
 * Atomically mark a tx as seen. Returns true only for the first caller (not a duplicate).
 * Use this instead of separate check+mark to avoid pending/confirmed double-fire races.
 */
export function markTxSeenIfNew(
    txHash: string,
    source: 'pending' | 'confirmed' | 'manual' = 'confirmed'
): boolean {
    if (!ledgerLoaded) {
        void loadLedgerFromDisk();
    }
    const key = txHash.toLowerCase();
    const now = Date.now();
    const ttl = getTTL();
    const existing = seenTxs.get(key);

    if (existing) {
        if (now - existing.seenAt <= ttl) {
            return false;
        }
        seenTxs.delete(key);
    }

    seenTxs.set(key, { seenAt: now, source });
    schedulePersistLedger();
    persistSeenToMongo(key);

    if (seenTxs.size > MAX_ENTRIES) {
        const firstKey = seenTxs.keys().next().value;
        if (firstKey) seenTxs.delete(firstKey);
    }

    return true;
}

/**
 * Check if a tx hash has already been processed.
 * If not seen, marks it and returns false (not duplicate).
 * If already seen, returns true (duplicate).
 */
export function isDuplicateTx(txHash: string, source: 'pending' | 'confirmed' | 'manual' = 'confirmed'): boolean {
    return !markTxSeenIfNew(txHash, source);
}

/**
 * Check if a tx was already seen WITHOUT marking it.
 * Useful for checking before expensive operations.
 */
export function wasSeen(txHash: string): boolean {
    const key = txHash.toLowerCase();
    const existing = seenTxs.get(key);
    if (!existing) return false;
    if (Date.now() - existing.seenAt > getTTL()) {
        seenTxs.delete(key);
        return false;
    }
    return true;
}

/**
 * Per-contract execution lock — prevents overlapping auto-mints
 * for the same contract within a time window.
 */
const LOCK_TTL = 120_000; // 2 minutes
const executionLocks = new Map<string, number>();

function executionLockKey(contract: string, sourceTxHash?: string): string {
    if (sourceTxHash) {
        return `mint:${sourceTxHash.toLowerCase()}`;
    }
    return `contract:${contract.toLowerCase()}`;
}

/** Per whale-tx lock when sourceTxHash is set; per-contract lock otherwise. */
export function tryAcquireExecutionLock(contract: string, sourceTxHash?: string): boolean {
    const key = executionLockKey(contract, sourceTxHash);
    const now = Date.now();
    const existing = executionLocks.get(key);

    if (existing && now - existing < LOCK_TTL) {
        return false;
    }

    executionLocks.set(key, now);
    return true;
}

export function releaseExecutionLock(contract: string, sourceTxHash?: string): void {
    executionLocks.delete(executionLockKey(contract, sourceTxHash));
}

/** Prune expired entries from both caches. */
export function pruneAll(): { txsPruned: number; locksPruned: number } {
    const now = Date.now();
    const ttl = getTTL();
    let txsPruned = 0;
    let locksPruned = 0;

    for (const [k, v] of seenTxs) {
        if (now - v.seenAt > ttl) {
            seenTxs.delete(k);
            txsPruned++;
        }
    }

    for (const [k, ts] of executionLocks) {
        if (now - ts > LOCK_TTL) {
            executionLocks.delete(k);
            locksPruned++;
        }
    }

    return { txsPruned, locksPruned };
}

/** Get deduplication stats. */
export function getDedupeStats(): { size: number; locksActive: number } {
    return { size: seenTxs.size, locksActive: executionLocks.size };
}
