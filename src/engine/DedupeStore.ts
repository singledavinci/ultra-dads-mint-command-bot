import { getRuntimeConfig } from '../config/runtimeConfig';

interface DedupeEntry {
    key: string;
    reason: string;
    firstSeenAt: number;
    expiresAt: number;
    executionId?: string;
}

const store = new Map<string, DedupeEntry>();

function ttlMs(): number {
    return getRuntimeConfig().dedupeTtlMs;
}

function prune(): void {
    const now = Date.now();
    for (const [k, e] of store) {
        if (e.expiresAt <= now) store.delete(k);
    }
}

export class DedupeStore {
    private static contractKey(to: string, data: string, value: string): string {
        return `contract:${to.toLowerCase()}:${data.toLowerCase()}:${value}`;
    }

    static isDuplicate(key: string): boolean {
        prune();
        const e = store.get(key);
        return !!e && e.expiresAt > Date.now();
    }

    static markSeen(key: string, reason: string, executionId?: string): void {
        const now = Date.now();
        store.set(key, {
            key,
            reason,
            firstSeenAt: now,
            expiresAt: now + ttlMs(),
            executionId,
        });
    }

    static markExecuted(executionId: string, to: string, data: string, value: string): void {
        DedupeStore.markSeen(DedupeStore.contractKey(to, data, value), 'executed', executionId);
    }

    static explainDuplicate(key: string): string | null {
        prune();
        return store.get(key)?.reason ?? null;
    }

    static sourceTxKey(hash: string, scopeId?: string): string {
        const h = hash.toLowerCase();
        return scopeId ? `tx:${scopeId}:${h}` : `tx:${h}`;
    }

    static checkSourceTx(hash?: string, scopeId?: string): boolean {
        if (!hash) return false;
        return DedupeStore.isDuplicate(DedupeStore.sourceTxKey(hash, scopeId));
    }

    static markSourceTx(hash: string, executionId: string, scopeId?: string): void {
        DedupeStore.markSeen(DedupeStore.sourceTxKey(hash, scopeId), 'source_tx', executionId);
    }

    static checkContractExecution(to: string, data: string, value: string): boolean {
        return DedupeStore.isDuplicate(DedupeStore.contractKey(to, data, value));
    }

    static size(): number {
        prune();
        return store.size;
    }
}
