/**
 * Central RPC / WebSocket URL resolution for tracker vs execution budgets.
 */

export function splitRpcUrls(raw?: string): string[] {
    if (!raw?.trim()) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/** Tracker block polling + reads — TRACKER_RPC_URL, else PROVIDER_URL. */
export function resolveTrackerHttpUrls(): string[] {
    const fromTracker = splitRpcUrls(process.env.TRACKER_RPC_URL);
    if (fromTracker.length) return fromTracker;
    return splitRpcUrls(process.env.PROVIDER_URL);
}

/** Pending mempool path — TRACKER_WS_RPC_URL, else WS_RPC_URL. */
export function resolveTrackerWsUrl(): string | undefined {
    const tracker = process.env.TRACKER_WS_RPC_URL?.trim();
    if (tracker) return tracker;
    return process.env.WS_RPC_URL?.trim() || undefined;
}

/** Mint execution broadcasts — EXECUTION_RPC_URL + BACKUP_RPC_URLS, else PROVIDER_URL. */
export function resolveExecutionUrls(): string[] {
    const primary = splitRpcUrls(process.env.EXECUTION_RPC_URL);
    const backups = splitRpcUrls(process.env.BACKUP_RPC_URLS);
    const combined = [...primary, ...backups];
    if (combined.length) return combined;
    return splitRpcUrls(process.env.PROVIDER_URL);
}

export function toHttpRpcUrl(url: string): string {
    return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

export function getTrackerHttpUrl(): string | null {
    const raw = resolveTrackerHttpUrls()[0]?.trim();
    if (!raw) return null;
    return toHttpRpcUrl(raw);
}
