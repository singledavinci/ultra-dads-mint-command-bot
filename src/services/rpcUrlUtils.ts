/** Pure RPC URL normalization — no env load (safe for unit tests). */

export function normalizeUserRpcUrl(url: string): string {
    let u = url.trim();
    if (u.startsWith('wss://')) return `https://${u.slice(6)}`;
    if (u.startsWith('ws://')) return `http://${u.slice(5)}`;
    return u;
}

export function isHttpRpcUrl(url: string): boolean {
    const n = normalizeUserRpcUrl(url);
    return n.startsWith('https://') || n.startsWith('http://');
}
