/**
 * Nonce Manager — per-wallet nonce tracking with TTL, reservation, and error recovery.
 *
 * Replaces the unbounded module-level `localNonceTracker` in mintCore.ts.
 * Prevents nonce collisions during burst broadcasts and self-heals after errors.
 *
 * Lifecycle:
 *   1. reserveNonce(address, rpcNonce) → returns the next nonce to use
 *   2. confirmNonce(address, nonce) → marks a nonce as successfully submitted
 *   3. resetNonce(address) → clears cache (e.g., after nonce-too-low error)
 */

const DEFAULT_TTL = 60_000; // 1 minute

function getTTL(): number {
    try {
        const ms = parseInt(process.env.NONCE_CACHE_TTL_MS || '', 10);
        return ms > 0 ? ms : DEFAULT_TTL;
    } catch {
        return DEFAULT_TTL;
    }
}

interface NonceEntry {
    /** Next nonce to assign */
    nextNonce: number;
    /** Last time this entry was touched */
    lastUsed: number;
    /** Highest confirmed nonce (successfully submitted) */
    lastConfirmed: number;
}

const cache = new Map<string, NonceEntry>();

function addrKey(address: string): string {
    return address.toLowerCase();
}

/**
 * Reserve the next nonce for a wallet.
 * Pass the freshly-fetched RPC pending nonce as `rpcNonce`.
 * The cache never goes backwards from the RPC value.
 */
export function reserveNonce(address: string, rpcNonce: number): number {
    const k = addrKey(address);
    const now = Date.now();
    const existing = cache.get(k);

    let next: number;

    if (existing && now - existing.lastUsed < getTTL()) {
        // Use the higher of RPC nonce or our tracked next
        next = Math.max(rpcNonce, existing.nextNonce);
    } else {
        // Expired or new — use RPC nonce
        next = rpcNonce;
    }

    cache.set(k, {
        nextNonce: next + 1,
        lastUsed: now,
        lastConfirmed: existing?.lastConfirmed ?? (next - 1),
    });

    return next;
}

/**
 * Confirm that a nonce was successfully submitted (tx broadcast accepted).
 * This helps track which nonces are "in flight".
 */
export function confirmNonce(address: string, nonce: number): void {
    const k = addrKey(address);
    const existing = cache.get(k);
    if (existing) {
        existing.lastConfirmed = Math.max(existing.lastConfirmed, nonce);
        existing.lastUsed = Date.now();
    }
}

/**
 * Reset the nonce cache for a wallet.
 * Call this after a "nonce too low" error to force re-fetch from RPC.
 */
export function resetNonce(address: string): void {
    cache.delete(addrKey(address));
}

/**
 * Handle a nonce-related error. Resets the cache so the next call
 * will re-fetch from the RPC.
 */
export function handleNonceError(address: string, error: string): void {
    const isNonceError = /nonce too low|replacement transaction underpriced|already known/i.test(error);
    if (isNonceError) {
        resetNonce(address);
    }
}

/**
 * Get the current cached nonce state for diagnostics.
 */
export function getNonceState(address: string): { nextNonce: number; lastConfirmed: number; ageMs: number } | null {
    const entry = cache.get(addrKey(address));
    if (!entry) return null;
    return {
        nextNonce: entry.nextNonce,
        lastConfirmed: entry.lastConfirmed,
        ageMs: Date.now() - entry.lastUsed,
    };
}

/** Prune entries older than TTL * 4. */
export function pruneStaleNonces(): number {
    const now = Date.now();
    const maxAge = getTTL() * 4;
    let pruned = 0;
    for (const [k, v] of cache) {
        if (now - v.lastUsed > maxAge) {
            cache.delete(k);
            pruned++;
        }
    }
    return pruned;
}

/** Clear all cached nonces (e.g., on shutdown). */
export function clearAllNonces(): void {
    cache.clear();
}
