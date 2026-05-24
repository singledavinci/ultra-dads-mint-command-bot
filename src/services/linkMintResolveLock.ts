/**
 * Per-chat+contract in-flight guard and Telegram webhook update dedupe.
 */

export function contractKeyFromCandidate(target: string): string {
    const m = target.match(/0x[a-fA-F0-9]{40}/i);
    return (m ? m[0] : target.trim()).toLowerCase();
}

export function inflightResolveKey(chatId: string, contract: string): string {
    return `${chatId}:${contract.toLowerCase()}`;
}

export interface InFlightResolveEntry {
    statusMsgId?: number;
    startedAt: number;
}

const inFlightResolves = new Map<string, InFlightResolveEntry>();

export function tryAcquireResolveLock(
    key: string,
    statusMsgId?: number
): { acquired: true } | { acquired: false; entry: InFlightResolveEntry } {
    const existing = inFlightResolves.get(key);
    if (existing) return { acquired: false, entry: existing };
    inFlightResolves.set(key, { statusMsgId, startedAt: Date.now() });
    return { acquired: true };
}

export function releaseResolveLock(key: string): void {
    inFlightResolves.delete(key);
}

export function setResolveLockStatusMsg(key: string, statusMsgId: number): void {
    const entry = inFlightResolves.get(key);
    if (entry) entry.statusMsgId = statusMsgId;
}

const WEBHOOK_DEDUPE_TTL_MS = 120_000;
const seenWebhookUpdates = new Map<number, number>();

export function noteWebhookUpdate(updateId: number | undefined): 'new' | 'duplicate' {
    if (updateId === undefined) return 'new';
    const now = Date.now();
    if (seenWebhookUpdates.has(updateId)) return 'duplicate';
    seenWebhookUpdates.set(updateId, now);
    if (seenWebhookUpdates.size > 500) {
        for (const [id, at] of seenWebhookUpdates) {
            if (now - at > WEBHOOK_DEDUPE_TTL_MS) seenWebhookUpdates.delete(id);
        }
    }
    return 'new';
}
