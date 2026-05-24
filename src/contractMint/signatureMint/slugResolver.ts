/**
 * Resolve OpenSea collection slug from NFT contract (for Drops mint API).
 */

import { getReservoirApiKey, reservoirRequestHeaders } from '../../config/reservoir.js';

const slugCache = new Map<string, { slug: string; at: number }>();
const TTL = 3600_000;

export async function resolveOpenSeaSlugFromContract(
    contract: string,
    chainId = 1
): Promise<string | null> {
    const key = `${chainId}:${contract.toLowerCase()}`;
    const hit = slugCache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.slug;

    const chain =
        chainId === 8453 ? 'base' : chainId === 137 ? 'polygon' : chainId === 42161 ? 'arbitrum' : 'ethereum';

    try {
        const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${contract.toLowerCase()}`;
        const headers: Record<string, string> = { accept: 'application/json' };
        const apiKey = process.env.OPENSEA_API_KEY?.trim();
        if (apiKey) headers['x-api-key'] = apiKey;

        const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
        if (!res.ok) return null;
        const json = (await res.json()) as { collection?: string };
        const slug = json?.collection?.trim();
        if (slug) {
            slugCache.set(key, { slug, at: Date.now() });
            return slug;
        }
    } catch {
        /* fall through */
    }

    const reservoirHeaders = reservoirRequestHeaders();
    if (getReservoirApiKey() && reservoirHeaders) {
    try {
        const url = `https://api.reservoir.tools/collections/v7?contract=${contract.toLowerCase()}&limit=1`;
        const res = await fetch(url, {
            headers: reservoirHeaders,
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { collections?: { slug?: string }[] };
        const slug = json?.collections?.[0]?.slug?.trim();
        if (slug) {
            slugCache.set(key, { slug, at: Date.now() });
            return slug;
        }
    } catch {
        /* ignore */
    }
    }

    return null;
}
