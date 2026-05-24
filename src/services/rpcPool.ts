/**
 * RPC Provider Pool — singleton per URL set.
 *
 * Replaces the pattern of `new JsonRpcProvider(url)` on every command/callback.
 * Providers are cached by URL key and reused across the entire process lifetime.
 * Supports:
 *   - Single HTTP URL
 *   - Comma-separated URLs → ethers FallbackProvider
 *   - WebSocket URLs (wss://) → WebSocketProvider with auto-reconnect
 *   - Health scoring: tracks latency and error count per provider
 */

import { JsonRpcProvider, WebSocketProvider, FallbackProvider } from 'ethers';
import type { Provider } from 'ethers';
import { loadEnv } from '../config/env';
import { isHttpRpcUrl, normalizeUserRpcUrl } from './rpcUrlUtils.js';

export { normalizeUserRpcUrl, isHttpRpcUrl } from './rpcUrlUtils.js';

const env = loadEnv();

interface ProviderEntry {
    provider: Provider;
    urls: string[];
    createdAt: number;
    errorCount: number;
    lastLatencyMs: number;
    lastErrorAt: number;
}

const cache = new Map<string, ProviderEntry>();

/** Normalize a URL set into a stable cache key. */
function cacheKey(urls: string[]): string {
    return urls.map(u => u.trim().toLowerCase()).sort().join('|');
}

function createSingleProvider(url: string): Provider {
    const trimmed = url.trim();
    if (trimmed.startsWith('wss://')) {
        return new WebSocketProvider(trimmed);
    }
    return new JsonRpcProvider(trimmed, undefined, {
        staticNetwork: true,
        batchMaxCount: 10,
    });
}

/**
 * Get or create a cached provider for the given URL(s).
 * Pass a comma-separated string or an array.
 */
export function getProvider(urlInput: string | string[]): Provider {
    const urls = Array.isArray(urlInput)
        ? urlInput
        : urlInput.split(',').map(u => u.trim()).filter(Boolean);

    if (urls.length === 0) {
        throw new Error('[RPC] No provider URLs configured.');
    }

    const key = cacheKey(urls);
    const existing = cache.get(key);
    if (existing) return existing.provider;

    let provider: Provider;
    if (urls.length === 1) {
        provider = createSingleProvider(urls[0]);
    } else {
        // FallbackProvider with priority ordering (first URL = highest priority)
        const providers = urls.map((url, i) => ({
            provider: createSingleProvider(url) as JsonRpcProvider,
            priority: i + 1,
            stallTimeout: env.RPC_TIMEOUT_MS,
            weight: 1,
        }));
        provider = new FallbackProvider(
            providers.map(p => p.provider),
            undefined,
            { quorum: 1 }
        );
    }

    cache.set(key, {
        provider,
        urls,
        createdAt: Date.now(),
        errorCount: 0,
        lastLatencyMs: 0,
        lastErrorAt: 0,
    });

    return provider;
}

/** Get the default provider from PROVIDER_URL env. */
export function getDefaultProvider(): Provider {
    return getProvider(env.PROVIDER_URLS);
}

/** Get a user-specific provider (custom RPC + system fallbacks, or default). */
export function getUserProvider(userRpcUrl: string | undefined | null): Provider {
    const urls = resolveUserRpcUrlList(userRpcUrl);
    if (urls.length === 0) return getDefaultProvider();
    if (urls.length === 1) return getProvider(urls[0]);
    return getProvider(urls.join(','));
}

/** Record an error against a provider (for health scoring). */
export function recordError(urlInput: string | string[]): void {
    const urls = Array.isArray(urlInput)
        ? urlInput
        : urlInput.split(',').map(u => u.trim()).filter(Boolean);
    const key = cacheKey(urls);
    const entry = cache.get(key);
    if (entry) {
        entry.errorCount++;
        entry.lastErrorAt = Date.now();
    }
}

/** Record latency for a provider. */
export function recordLatency(urlInput: string | string[], ms: number): void {
    const urls = Array.isArray(urlInput)
        ? urlInput
        : urlInput.split(',').map(u => u.trim()).filter(Boolean);
    const key = cacheKey(urls);
    const entry = cache.get(key);
    if (entry) {
        entry.lastLatencyMs = ms;
    }
}

/** Get health stats for all cached providers. */
export function getHealthStats(): Array<{
    urls: string[];
    errorCount: number;
    lastLatencyMs: number;
    lastErrorAt: number;
    ageMs: number;
}> {
    const now = Date.now();
    return [...cache.values()].map(e => ({
        urls: e.urls,
        errorCount: e.errorCount,
        lastLatencyMs: e.lastLatencyMs,
        lastErrorAt: e.lastErrorAt,
        ageMs: now - e.createdAt,
    }));
}

/** Measure current latency of the default provider. */
export async function measureLatency(): Promise<number> {
    const provider = getDefaultProvider() as JsonRpcProvider;
    const start = Date.now();
    try {
        await provider.getBlockNumber();
        const ms = Date.now() - start;
        recordLatency(env.PROVIDER_URLS, ms);
        return ms;
    } catch {
        recordError(env.PROVIDER_URLS);
        return -1;
    }
}

export interface RpcProbeResult {
    url: string;
    hostname: string;
    /** Median of successful rounds; -1 if all failed */
    latencyMs: number;
    ok: boolean;
    error?: string;
    primary: boolean;
}

export function maskRpcHostname(url: string): string {
    try {
        return new URL(url.trim()).hostname;
    } catch {
        return url.trim().slice(0, 28);
    }
}

/** Live probe before saving /setrpc — returns normalized URL on success. */
export async function validateUserRpcUrl(
    rawUrl: string
): Promise<{ ok: true; url: string; latencyMs: number } | { ok: false; error: string }> {
    const url = normalizeUserRpcUrl(rawUrl);
    if (!isHttpRpcUrl(url)) {
        return { ok: false, error: 'URL must be http(s):// or wss:// (converted to https)' };
    }
    try {
        new URL(url);
    } catch {
        return { ok: false, error: 'invalid URL format' };
    }
    const probe = await jsonRpcBlockNumber(url);
    if (probe.ms < 0) {
        return { ok: false, error: probe.error || 'RPC unreachable' };
    }
    return { ok: true, url, latencyMs: probe.ms };
}

/** Personal RPC first, then system PROVIDER_URL fallbacks (deduped). */
export function resolveUserRpcUrlList(customUrl?: string | null): string[] {
    const primary = customUrl?.trim() ? normalizeUserRpcUrl(customUrl) : '';
    const system = resolveRpcUrlList(null);
    if (!primary) return system;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of [primary, ...system]) {
        const key = u.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(u.trim());
    }
    return out;
}

/** URLs for a user: personal /setrpc or system PROVIDER_URL list. */
export function resolveRpcUrlList(customUrl?: string | null): string[] {
    const raw = (customUrl && customUrl.trim()) || env.PROVIDER_URL || '';
    return raw.split(',').map(u => u.trim()).filter(Boolean);
}

function median(nums: number[]): number {
    const s = [...nums].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? -1;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function humanizeRpcError(code: number | undefined, message: string): string {
    const msg = message || '';
    if (code === -32003 || msg.toLowerCase().includes('rate limit')) {
        return 'rate limited — too many requests for this plan';
    }
    if (code === 429 || msg.includes('429')) return 'HTTP 429 rate limit';
    if (code === -32600) return 'invalid request';
    if (msg.toLowerCase().includes('timeout')) return 'timeout';
    if (msg.toLowerCase().includes('coalesce')) {
        return 'RPC error (use raw probe — redeploy if this persists)';
    }
    return msg.slice(0, 72);
}

/** Single JSON-RPC eth_blockNumber (no ethers network detection). */
async function jsonRpcBlockNumber(url: string): Promise<{ ms: number; error?: string }> {
    const timeoutMs = env.RPC_TIMEOUT_MS;
    const t0 = Date.now();
    try {
        const res = await fetch(url.trim(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const body = (await res.json()) as { error?: { code?: number; message?: string }; result?: string };
        const ms = Date.now() - t0;
        if (body.error) {
            recordError(url);
            return {
                ms: -1,
                error: humanizeRpcError(body.error.code, body.error.message || ''),
            };
        }
        if (!res.ok) {
            return { ms: -1, error: `HTTP ${res.status}` };
        }
        if (!body.result) {
            return { ms: -1, error: 'empty result' };
        }
        return { ms };
    } catch (e) {
        recordError(url);
        return { ms: -1, error: humanizeRpcError(undefined, (e as Error).message || 'network error') };
    }
}

/** Latency via the same FallbackProvider the bot uses for mints. */
export async function measurePooledLatency(urlInput?: string | string[]): Promise<number> {
    const urls = urlInput
        ? Array.isArray(urlInput)
            ? urlInput
            : urlInput.split(',').map(u => u.trim()).filter(Boolean)
        : env.PROVIDER_URLS;
    if (urls.length === 0) return -1;
    const provider = getProvider(urls) as JsonRpcProvider;
    const t0 = Date.now();
    try {
        await provider.getBlockNumber();
        const ms = Date.now() - t0;
        recordLatency(urls, ms);
        return ms;
    } catch {
        recordError(urls);
        return -1;
    }
}

/** Live eth_blockNumber ping per endpoint (raw HTTP, not ethers per-URL). */
export async function probeRpcEndpoints(
    urls: string[],
    rounds = 2
): Promise<RpcProbeResult[]> {
    const results: RpcProbeResult[] = [];
    const gapMs = parseInt(process.env.RPC_PROBE_GAP_MS || '350', 10);

    for (let i = 0; i < urls.length; i++) {
        if (i > 0 && gapMs > 0) {
            await new Promise(r => setTimeout(r, gapMs));
        }
        const url = urls[i];
        const hostname = maskRpcHostname(url);
        const samples: number[] = [];
        let lastError = '';

        for (let r = 0; r < rounds; r++) {
            if (r > 0) await new Promise(res => setTimeout(res, 120));
            const probe = await jsonRpcBlockNumber(url);
            if (probe.ms > 0) samples.push(probe.ms);
            else lastError = probe.error || 'failed';
        }

        const latencyMs = samples.length > 0 ? median(samples) : -1;
        if (latencyMs > 0) recordLatency(url, latencyMs);

        results.push({
            url,
            hostname,
            latencyMs,
            ok: samples.length > 0,
            error: samples.length > 0 ? undefined : escapeHtml(lastError || 'unreachable'),
            primary: i === 0,
        });
    }

    return results;
}

/** One-shot WS latency (connect + eth_blockNumber). Returns ms or -1. */
export async function probeWebSocketLatency(wsUrl: string): Promise<number> {
    const trimmed = wsUrl.trim();
    if (!trimmed.startsWith('wss://') && !trimmed.startsWith('ws://')) return -1;

    const timeoutMs = parseInt(process.env.RPC_WS_PROBE_TIMEOUT_MS || '12000', 10);
    const provider = new WebSocketProvider(trimmed);
    try {
        const t0 = Date.now();
        await Promise.race([
            (async () => {
                await provider.ready;
                await provider.getBlockNumber();
            })(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), timeoutMs)
            ),
        ]);
        return Date.now() - t0;
    } catch {
        return -1;
    } finally {
        try {
            provider.destroy();
        } catch {
            // ignore
        }
    }
}
