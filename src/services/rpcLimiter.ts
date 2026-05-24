/**
 * RPC Rate Limiter — prevents 429 errors from killing entire batches.
 *
 * Concurrency + retry settings are read from getRuntimeConfig() (single source of truth).
 */

import type { FeeData, JsonRpcProvider } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { logRateLimited } from '../utils/logger';

class Semaphore {
    private queue: Array<() => void> = [];
    private running = 0;

    constructor(private max: number) {}

    async acquire(): Promise<void> {
        if (this.running < this.max) {
            this.running++;
            return;
        }
        return new Promise(resolve => this.queue.push(resolve));
    }

    release(): void {
        this.running--;
        const next = this.queue.shift();
        if (next) {
            this.running++;
            next();
        }
    }
}

let preflightSemaphore: Semaphore | null = null;
let simulationSemaphore: Semaphore | null = null;

export function preflightSem(): Semaphore {
    if (!preflightSemaphore) {
        preflightSemaphore = new Semaphore(getRuntimeConfig().preflightConcurrency);
    }
    return preflightSemaphore;
}

export function simulationSem(): Semaphore {
    if (!simulationSemaphore) {
        simulationSemaphore = new Semaphore(getRuntimeConfig().simulationConcurrency);
    }
    return simulationSemaphore;
}

/** Clear lazy semaphores (tests only). */
export function resetRpcLimiterForTests(): void {
    preflightSemaphore = null;
    simulationSemaphore = null;
}

export async function withSemaphore<T>(sem: Semaphore, fn: () => Promise<T>): Promise<T> {
    await sem.acquire();
    try {
        return await fn();
    } finally {
        sem.release();
    }
}

export function isRateLimitedRpcError(err: unknown): boolean {
    const e = err as any;

    const nestedText = (() => {
        const chunks: string[] = [];
        const walk = (x: any, d: number) => {
            if (d > 8 || x == null) return;
            if (typeof x === 'string') {
                chunks.push(x);
                return;
            }
            if (typeof x !== 'object') return;
            for (const k of ['message', 'shortMessage', 'reason']) {
                const v = (x as any)[k];
                if (typeof v === 'string') chunks.push(v);
            }
            if (typeof (x as any).code === 'number') chunks.push(String((x as any).code));
            walk((x as any).error, d + 1);
            walk((x as any).info, d + 1);
            walk((x as any).info?.error, d + 1);
        };
        walk(e, 0);
        try {
            chunks.push(JSON.stringify(e));
        } catch {
            /* ignore */
        }
        return chunks.join('\n').toLowerCase();
    })();

    const codes: number[] = [];
    const codeWalk = (x: any, d: number) => {
        if (d > 8 || !x || typeof x !== 'object') return;
        const c = (x as any).code;
        if (typeof c === 'number') codes.push(c);
        codeWalk((x as any).error, d + 1);
        codeWalk((x as any).info, d + 1);
        codeWalk((x as any).info?.error, d + 1);
    };
    codeWalk(e, 0);

    if (codes.some(c => c === 429 || c === -32007)) return true;

    return (
        nestedText.includes('429') ||
        nestedText.includes('-32007') ||
        nestedText.includes('32007') ||
        nestedText.includes('rate limit') ||
        nestedText.includes('request limit') ||
        nestedText.includes('too many requests') ||
        nestedText.includes('/second') ||
        nestedText.includes('compute units') ||
        nestedText.includes('exceeded its compute units') ||
        /\b15\s*\/\s*second\b/.test(nestedText)
    );
}

function is429(err: any): boolean {
    return isRateLimitedRpcError(err);
}

export async function rpcRetry<T>(fn: () => Promise<T>, label = 'rpc'): Promise<T> {
    const cfg = getRuntimeConfig();
    let lastErr: any;
    for (let attempt = 0; attempt < cfg.rpcRetryAttempts; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastErr = err;
            if (!is429(err) || attempt === cfg.rpcRetryAttempts - 1) throw err;
            const jitter = Math.random() * 200;
            const delay = cfg.rpcRetryBaseMs * Math.pow(2, attempt) + jitter;
            logRateLimited(
                `rpc-429:${label}`,
                15_000,
                'debug',
                `[RPC/${label}] 429 retry ${attempt + 1}/${cfg.rpcRetryAttempts} in ${Math.round(delay)}ms`
            );
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastErr;
}

const FEE_CACHE_TTL = parseInt(process.env.FEE_DATA_CACHE_TTL_MS || '3000', 10);
let cachedFeeData: { data: FeeData; fetchedAt: number } | null = null;

export async function getCachedFeeData(provider: JsonRpcProvider): Promise<FeeData> {
    const now = Date.now();
    if (cachedFeeData && now - cachedFeeData.fetchedAt < FEE_CACHE_TTL) {
        return cachedFeeData.data;
    }

    const data = await rpcRetry(() => provider.getFeeData(), 'feeData');
    cachedFeeData = { data, fetchedAt: now };
    return data;
}

export async function safePreflightWallet(
    fn: () => Promise<any>,
    walletLabel: string
): Promise<any | null> {
    const cfg = getRuntimeConfig();
    try {
        return await withSemaphore(preflightSem(), () => rpcRetry(fn, `preflight/${walletLabel}`));
    } catch (err: any) {
        if (is429(err)) {
            logRateLimited(
                `preflight-429:${walletLabel}`,
                30_000,
                'warn',
                `[Preflight] Skipping ${walletLabel}: RPC 429 after ${cfg.rpcRetryAttempts} retries`
            );
            return null;
        }
        throw err;
    }
}

let rpcSerialTail: Promise<void> = Promise.resolve();

export async function withSerializedRpc<T>(fn: () => Promise<T>): Promise<T> {
    const queued = rpcSerialTail.then(async () => fn());
    rpcSerialTail = queued.then(
        () => undefined,
        () => undefined
    );
    return queued;
}

export function getLinkMintRpcGapMs(): number {
    const v = parseInt(process.env.LINK_MINT_RPC_GAP_MS || '220', 10);
    return Number.isFinite(v) && v >= 0 ? v : 220;
}

export async function sleepRpcGap(ms?: number): Promise<void> {
    const gap = ms !== undefined ? ms : getLinkMintRpcGapMs();
    if (gap <= 0) return;
    await new Promise(r => setTimeout(r, gap));
}
