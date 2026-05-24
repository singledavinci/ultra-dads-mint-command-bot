import { createHash } from 'node:crypto';
import { FallbackProvider, JsonRpcProvider, WebSocketProvider } from 'ethers';
import {
    getTrackerHttpUrl,
    resolveExecutionUrls,
    resolveTrackerHttpUrls,
    resolveTrackerWsUrl,
} from '../config/rpcEndpoints.js';
import { isRateLimitedRpcError } from './rpcLimiter';

export { getTrackerHttpUrl } from '../config/rpcEndpoints.js';

let trackerProvider: JsonRpcProvider | WebSocketProvider | FallbackProvider | null = null;
let executionProvider: JsonRpcProvider | FallbackProvider | null = null;

let rpc429Count = 0;
let readCount = 0;
let readErrors = 0;

function fingerprintUrl(url: string): string {
    try {
        const u = new URL(url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
        const host = u.hostname;
        const path = u.pathname;
        const tail = path.length > 6 ? path.slice(-6) : path;
        const hash = createHash('sha256').update(url).digest('hex').slice(-6);
        return `${host}…${tail || hash}`;
    } catch {
        return 'invalid-url';
    }
}

function buildFallback(urls: string[]): JsonRpcProvider | FallbackProvider {
    if (urls.length === 1) return new JsonRpcProvider(urls[0]);
    const providers = urls.map(
        (url, i) => new JsonRpcProvider(url, undefined, { staticNetwork: true, batchMaxCount: 1 })
    );
    return new FallbackProvider(
        providers.map((p, i) => ({ provider: p, priority: i + 1, stallTimeout: 2000 }))
    );
}

export function getTrackerProvider(): JsonRpcProvider | WebSocketProvider | FallbackProvider {
    if (trackerProvider) return trackerProvider;

    const ws = resolveTrackerWsUrl();
    if (ws && process.env.USE_STATE_RPC !== 'false') {
        try {
            trackerProvider = new WebSocketProvider(ws);
            return trackerProvider;
        } catch {
            /* fall through to HTTP */
        }
    }

    const urls = resolveTrackerHttpUrls();
    if (!urls.length) {
        throw new Error('No TRACKER_RPC_URL or PROVIDER_URL configured');
    }
    trackerProvider = buildFallback(urls);
    return trackerProvider;
}

export function getExecutionProvider(): JsonRpcProvider | FallbackProvider {
    if (executionProvider) return executionProvider;
    const urls = resolveExecutionUrls();
    if (!urls.length) {
        throw new Error('No EXECUTION_RPC_URL or PROVIDER_URL configured');
    }
    executionProvider = buildFallback(urls);
    return executionProvider;
}

export function record429(): void {
    rpc429Count++;
}

/**
 * Rate-limited read wrapper with 429 backoff.
 */
export async function rateLimitedRead<T>(fn: () => Promise<T>, label = 'read'): Promise<T> {
    readCount++;
    const attempts = parseInt(process.env.RPC_RETRY_ATTEMPTS || '4', 10);
    let delay = parseInt(process.env.RPC_RETRY_BASE_MS || '400', 10);

    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            if (isRateLimitedRpcError(err) && i < attempts - 1) {
                record429();
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 12_000);
                continue;
            }
            readErrors++;
            throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
                rpcLabel: label,
            });
        }
    }
    readErrors++;
    throw new Error(`RPC read exhausted retries (${label})`);
}

export function getDebugStats(): {
    rpc429Count: number;
    readCount: number;
    readErrors: number;
    trackerFingerprint: string;
    executionFingerprint: string;
} {
    const trackerUrls = resolveTrackerHttpUrls();
    const execUrls = resolveExecutionUrls();
    return {
        rpc429Count,
        readCount,
        readErrors,
        trackerFingerprint: trackerUrls[0] ? fingerprintUrl(trackerUrls[0]) : 'none',
        executionFingerprint: execUrls[0] ? fingerprintUrl(execUrls[0]) : 'none',
    };
}

export function resetProvidersForTests(): void {
    trackerProvider = null;
    executionProvider = null;
    rpc429Count = 0;
    readCount = 0;
    readErrors = 0;
}
