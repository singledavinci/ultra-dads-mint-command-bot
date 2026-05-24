const seen = new Map<string, number>();
const DEFAULT_TTL_MS = parseInt(process.env.CONTRACT_MINT_DEDUPE_TTL_MS || '300000', 10);

function prune(ttlMs: number): void {
    const now = Date.now();
    for (const [k, exp] of seen) {
        if (exp <= now) seen.delete(k);
    }
}

export function idempotencyKey(parts: string[]): string {
    return parts.filter(Boolean).join(':').toLowerCase();
}

export function shouldProcess(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
    prune(ttlMs);
    const exp = seen.get(key);
    if (exp && exp > Date.now()) return false;
    seen.set(key, Date.now() + ttlMs);
    return true;
}

export function wasSeen(key: string): boolean {
    prune(DEFAULT_TTL_MS);
    const exp = seen.get(key);
    return !!exp && exp > Date.now();
}

export function resetIdempotencyForTests(): void {
    seen.clear();
}
