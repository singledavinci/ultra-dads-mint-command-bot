import crypto from 'crypto';

/** Constant-time string compare for API secrets. */
export function safeCompare(a: string, b: string): boolean {
    if (!a || !b) return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export function apiPathRequiresAuth(method: string, path: string): boolean {
    if (method !== 'GET') return true;
    return path.startsWith('/debug') || path.startsWith('/engine');
}
