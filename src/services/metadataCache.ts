/**
 * NFT metadata cache with TTL.
 *
 * Prevents repeated on-chain calls to name()/symbol()/totalSupply() for the
 * same contract within a short window. Particularly useful when multiple whale
 * txs hit the same collection in rapid succession.
 */

import type { NFTMetadata } from '../utils/nftMetadata';

const DEFAULT_TTL = 300_000; // 5 minutes

function getTTL(): number {
    try {
        const { loadEnv } = require('../config/env');
        return loadEnv().SIMULATION_CACHE_TTL_MS;
    } catch {
        return DEFAULT_TTL;
    }
}

interface CacheEntry {
    data: NFTMetadata;
    fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Get cached metadata for a contract address, or null if expired/missing.
 */
export function getCachedMetadata(address: string): NFTMetadata | null {
    const key = address.toLowerCase();
    const entry = cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.fetchedAt;
    if (age > getTTL()) {
        cache.delete(key);
        return null;
    }

    return entry.data;
}

/**
 * Store metadata in the cache.
 */
export function setCachedMetadata(address: string, data: NFTMetadata): void {
    cache.set(address.toLowerCase(), {
        data,
        fetchedAt: Date.now(),
    });
}

/**
 * Prune expired entries. Call periodically to prevent unbounded growth.
 */
export function pruneMetadataCache(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of cache) {
        if (now - entry.fetchedAt > getTTL()) {
            cache.delete(key);
            pruned++;
        }
    }
    return pruned;
}

/** Current cache size (for diagnostics). */
export function metadataCacheSize(): number {
    return cache.size;
}
