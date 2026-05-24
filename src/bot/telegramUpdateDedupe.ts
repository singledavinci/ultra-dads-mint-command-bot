/**
 * Drop duplicate Telegram update_id deliveries (webhook retries, overlapping replicas).
 */
const seen = new Map<number, number>();
const MAX_ENTRIES = 8000;
const TTL_MS = 3_600_000;

export function isDuplicateTelegramUpdate(updateId: number | undefined): boolean {
    if (updateId === undefined) return false;
    if (seen.has(updateId)) return true;
    seen.set(updateId, Date.now());
    if (seen.size > MAX_ENTRIES) prune();
    return false;
}

function prune(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, at] of seen) {
        if (at < cutoff) seen.delete(id);
    }
    if (seen.size > MAX_ENTRIES) {
        const drop = seen.size - MAX_ENTRIES;
        let n = 0;
        for (const id of seen.keys()) {
            seen.delete(id);
            if (++n >= drop) break;
        }
    }
}
