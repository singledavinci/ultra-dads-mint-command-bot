/**
 * Link-mint dedupe — separate from whale tx dedupe.
 * Preview/resolve does NOT mark; only successful "Mint Now" / auto-execute marks.
 */

const recentAttempts = new Map<string, number>();

export function linkMintDedupeKey(contract: string, calldata?: string): string {
    return `${contract.toLowerCase()}:${(calldata || '').toLowerCase()}`;
}

/** True when this contract+calldata was minted recently via link mint. */
export function shouldBlockLinkMintRetry(key: string, ttlMs: number): boolean {
    if (ttlMs <= 0) return false;
    const ts = recentAttempts.get(key.toLowerCase());
    if (!ts) return false;
    if (Date.now() - ts >= ttlMs) {
        recentAttempts.delete(key.toLowerCase());
        return false;
    }
    return true;
}

export function markLinkMintExecuted(key: string): void {
    recentAttempts.set(key.toLowerCase(), Date.now());
}

export function clearLinkMintDedupe(key: string): void {
    recentAttempts.delete(key.toLowerCase());
}
