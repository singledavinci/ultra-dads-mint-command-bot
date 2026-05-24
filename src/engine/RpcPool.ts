import type { Provider } from 'ethers';
import { getProvider, getUserProvider, getHealthStats, recordError, recordLatency } from '../services/rpcPool';
import {
    getCachedFeeData,
    isRateLimitedRpcError,
    rpcRetry,
    sleepRpcGap,
    withSemaphore,
    preflightSem,
    simulationSem,
} from '../services/rpcLimiter';
import { getRuntimeConfig, maskRpcUrl } from '../config/runtimeConfig';

export class EngineRpcPool {
    static getReadProvider(customUrl?: string | null): Provider {
        const cfg = getRuntimeConfig();
        if (customUrl?.trim()) return getUserProvider(customUrl);
        const urls = [...cfg.providerUrls, ...cfg.backupRpcUrls].filter(Boolean);
        return getProvider(urls.length ? urls.join(',') : cfg.providerUrls[0] || '');
    }

    static async getFeeData(provider: Provider) {
        await sleepRpcGap();
        return rpcRetry(() => getCachedFeeData(provider as any), 'engine/fee');
    }

    static async safeRead<T>(fn: () => Promise<T>, label: string): Promise<T> {
        return rpcRetry(fn, label);
    }

    static async safePreflight<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
        try {
            return await withSemaphore(preflightSem(), () => rpcRetry(fn, `preflight/${label}`));
        } catch (e) {
            if (isRateLimitedRpcError(e)) return null;
            throw e;
        }
    }

    static async safeSimulate<T>(fn: () => Promise<T>, label: string): Promise<T> {
        return withSemaphore(simulationSem(), () => rpcRetry(fn, `sim/${label}`));
    }

    static getHealth() {
        return getHealthStats().map(h => ({
            urls: h.urls.map(maskRpcUrl),
            errorCount: h.errorCount,
            lastLatencyMs: h.lastLatencyMs,
        }));
    }

    static recordSuccess(urls: string | string[], latencyMs: number): void {
        recordLatency(urls, latencyMs);
    }

    static recordFailure(urls: string | string[]): void {
        recordError(urls);
    }

    static isRateLimited(err: unknown): boolean {
        return isRateLimitedRpcError(err);
    }
}
