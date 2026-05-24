/**
 * Pure helpers for /dropmint scheduling (no bot/env imports).
 */

export const DROP_MINT_CATCHUP_GRACE_MS = parseInt(
    process.env.DROP_MINT_CATCHUP_GRACE_MS || '600000',
    10
);

export type ScheduledMintLike = {
    id: string;
    label: string;
    contract: string;
    valueEth: string;
    scheduledAt: number;
    addedBy: string;
    addedByUsername?: string;
    addedByFirstName?: string;
    fired?: boolean;
    missed?: boolean;
    gasTierId?: string;
    gasBribeGwei?: string;
    priorityBoostEth?: string;
};

/** Parse `now | +5m | +2h | 14:30` (UTC) into unix ms. */
export function parseDropMintTimeArg(timeArg: string, nowMs = Date.now()): number | { error: string } {
    const t = timeArg.trim().toLowerCase();
    if (t === 'now') return nowMs + 2000;

    if (t.startsWith('+')) {
        const relMatch = t.match(/\+(\d+)(m|s|h)/i);
        if (!relMatch) return { error: 'Invalid relative time. Use +5m, +30s, or +2h' };
        const amount = parseInt(relMatch[1], 10);
        const unit = relMatch[2].toLowerCase();
        const ms = unit === 'h' ? amount * 3_600_000 : unit === 'm' ? amount * 60_000 : amount * 1000;
        return nowMs + ms;
    }

    if (/^\d{1,2}:\d{2}$/.test(t)) {
        const [hh, mm] = t.split(':').map(Number);
        const target = new Date(nowMs);
        target.setUTCHours(hh, mm, 0, 0);
        if (target.getTime() <= nowMs) target.setUTCDate(target.getUTCDate() + 1);
        return target.getTime();
    }

    return { error: 'Invalid time format. Use: now | +5m | +2h | 14:30 (UTC)' };
}

export function pendingScheduledMints(
    scheduledMints: ScheduledMintLike[] | undefined,
    opts?: { userId?: string; adminUserId?: string; includePast?: boolean }
): ScheduledMintLike[] {
    const now = Date.now();
    return (scheduledMints || []).filter(s => {
        if (s.fired || s.missed) return false;
        if (!opts?.includePast && s.scheduledAt <= now) return false;
        if (opts?.userId && opts.adminUserId && opts.userId !== opts.adminUserId) {
            return s.addedBy === opts.userId;
        }
        return true;
    });
}
