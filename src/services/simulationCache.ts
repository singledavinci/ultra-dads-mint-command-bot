/**
 * Simulation Cache — stores successful simulation results per (target + calldata).
 *
 * Keys include whale calldata because many mints share the same `to` router
 * (e.g. SeaDrop) while encoding a different NFT contract inside `data`.
 */

import { createHash } from 'node:crypto';

interface CachedSimulation {
    targetAddress: string;
    selector: string;
    data: string;
    value: string;
    quantity: number;
    cachedAt: number;
}

const DEFAULT_TTL = 300_000; // 5 minutes
const MAX_ENTRIES = 500;

function getTTL(): number {
    try {
        const ms = parseInt(process.env.SIMULATION_CACHE_TTL_MS || '', 10);
        return ms > 0 ? ms : DEFAULT_TTL;
    } catch {
        return DEFAULT_TTL;
    }
}

const cache = new Map<string, CachedSimulation>();
/** Latest successful sim per contract (link mint / pasted URLs). */
const byContract = new Map<string, string>();

function cacheKey(targetAddress: string, whaleCalldata: string): string {
    return createHash('sha256')
        .update(targetAddress.toLowerCase() + '\n' + whaleCalldata.toLowerCase())
        .digest('hex')
        .slice(0, 40);
}

/**
 * Get a cached simulation result for this target tx shape.
 * Returns null if expired or not found.
 */
export function getCachedSimulation(targetAddress: string, whaleCalldata: string): CachedSimulation | null {
    const k = cacheKey(targetAddress, whaleCalldata);
    const entry = cache.get(k);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > getTTL()) {
        cache.delete(k);
        return null;
    }

    return entry;
}

/**
 * Store a successful simulation result.
 */
export function setCachedSimulation(
    targetAddress: string,
    whaleCalldata: string,
    result: { selector: string; data: string; value: string; quantity: number }
): void {
    const k = cacheKey(targetAddress, whaleCalldata);
    const entry: CachedSimulation = {
        targetAddress: targetAddress.toLowerCase(),
        ...result,
        cachedAt: Date.now(),
    };
    cache.set(k, entry);
    byContract.set(targetAddress.toLowerCase(), k);

    while (cache.size > MAX_ENTRIES) {
        const first = cache.keys().next().value;
        if (first) {
            const evicted = cache.get(first);
            cache.delete(first);
            if (evicted && byContract.get(evicted.targetAddress) === first) {
                byContract.delete(evicted.targetAddress);
            }
        } else break;
    }
}

/**
 * Latest cached whale/calldata shape for a contract (from automint sim success).
 * Used by link mint when on-chain detection is uncertain.
 */
export function findCachedByContract(contractAddress: string): CachedSimulation | null {
    const k = byContract.get(contractAddress.toLowerCase());
    if (!k) return null;
    const entry = cache.get(k);
    if (!entry) {
        byContract.delete(contractAddress.toLowerCase());
        return null;
    }
    if (Date.now() - entry.cachedAt > getTTL()) {
        cache.delete(k);
        byContract.delete(contractAddress.toLowerCase());
        return null;
    }
    return entry;
}

/**
 * Invalidate cache for a specific target + calldata pair.
 */
export function invalidateSimulation(targetAddress: string, whaleCalldata: string): void {
    cache.delete(cacheKey(targetAddress, whaleCalldata));
}

/** Prune expired entries. */
export function pruneSimulationCache(): number {
    const now = Date.now();
    const ttl = getTTL();
    let pruned = 0;
    for (const [k, v] of cache) {
        if (now - v.cachedAt > ttl) {
            cache.delete(k);
            pruned++;
        }
    }
    return pruned;
}

/** Current cache size. */
export function simulationCacheSize(): number {
    return cache.size;
}
