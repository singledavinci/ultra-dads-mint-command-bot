import { getRuntimeConfig } from '../config/runtimeConfig';

const sourceTxLocks = new Map<string, number>();
let queueDepth = 0;
let paused = false;
let panic = false;

export class ExecutionQueue {
    static isPaused(): boolean {
        return paused || panic;
    }

    /** Soft pause only (e.g. /pause). */
    static isSoftPaused(): boolean {
        return paused;
    }

    /** Hard stop (e.g. /panic, kill switch). */
    static isPanic(): boolean {
        return panic;
    }

    static pause(): void {
        paused = true;
    }

    /**
     * Clears both soft pause and panic so auto-mint can run again.
     * Without clearing panic, /resume would leave the engine permanently blocked.
     */
    static resume(): void {
        paused = false;
        panic = false;
    }

    static panic(): void {
        panic = true;
        paused = true;
        queueDepth = 0;
    }

    static depth(): number {
        return queueDepth;
    }

    static async acquire(params: {
        sourceTxHash?: string;
        contract: string;
        /** Per-user scope — prevents user B blocked when user A minted same whale tx */
        scopeId?: string;
    }): Promise<{ ok: boolean; reason?: string }> {
        if (panic) return { ok: false, reason: 'panic_stop' };
        if (paused) return { ok: false, reason: 'engine_paused' };

        const cfg = getRuntimeConfig();
        const now = Date.now();
        const scope = params.scopeId ? `${params.scopeId}:` : '';

        if (params.sourceTxHash) {
            const k = `${scope}${params.sourceTxHash.toLowerCase()}`;
            const until = sourceTxLocks.get(k);
            if (until && until > now) {
                return { ok: false, reason: 'source_tx_cooldown' };
            }
            sourceTxLocks.set(k, now + cfg.perSourceTxCooldownMs);
        }

        queueDepth++;
        return { ok: true };
    }

    static release(): void {
        queueDepth = Math.max(0, queueDepth - 1);
    }

    static async runWithConcurrency<T>(
        items: T[],
        concurrency: number,
        fn: (item: T, index: number) => Promise<void>
    ): Promise<void> {
        const cfg = getRuntimeConfig();
        const limit = concurrency || cfg.executionConcurrency;
        let idx = 0;

        async function worker() {
            while (idx < items.length) {
                const i = idx++;
                await fn(items[i], i);
            }
        }

        const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
        await Promise.all(workers);
    }
}
