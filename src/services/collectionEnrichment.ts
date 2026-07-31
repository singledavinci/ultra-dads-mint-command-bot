/**
 * Collection enrichment for premium whale alerts — Reservoir + OpenSea.
 * Best-effort: never throws; returns partial data when APIs fail.
 */

import { getReservoirApiKey, reservoirRequestHeaders } from '../config/reservoir';

export interface CollectionEnrichment {
    name?: string;
    symbol?: string;
    slug?: string;
    /** Prefer banner for Telegram photo when available */
    bannerUrl?: string;
    imageUrl?: string;
    floorEth?: number;
    volume1dEth?: number;
    volumeAllEth?: number;
    ownerCount?: number;
    tokenCount?: number;
    /** OpenSea favorites / likes when available */
    favorites?: number;
    verified?: boolean;
    openseaUrl?: string;
    blurUrl?: string;
}

const cache = new Map<string, { at: number; data: CollectionEnrichment }>();
const CACHE_TTL_MS = 120_000;

function num(v: unknown): number | undefined {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
    return undefined;
}

export async function fetchCollectionEnrichment(contract: string): Promise<CollectionEnrichment> {
    const key = (contract || '').toLowerCase();
    if (!key.startsWith('0x') || key.length < 42) return {};

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

    const [reservoir, opensea] = await Promise.all([
        fetchReservoirCollection(key),
        fetchOpenSeaByContract(key),
    ]);

    const merged: CollectionEnrichment = {
        name: reservoir.name || opensea.name,
        symbol: reservoir.symbol || opensea.symbol,
        slug: reservoir.slug || opensea.slug,
        bannerUrl: reservoir.bannerUrl || opensea.bannerUrl,
        imageUrl: reservoir.imageUrl || opensea.imageUrl,
        floorEth: reservoir.floorEth ?? opensea.floorEth,
        volume1dEth: reservoir.volume1dEth,
        volumeAllEth: reservoir.volumeAllEth,
        ownerCount: reservoir.ownerCount ?? opensea.ownerCount,
        tokenCount: reservoir.tokenCount ?? opensea.tokenCount,
        favorites: opensea.favorites ?? reservoir.favorites,
        verified: Boolean(reservoir.verified || opensea.verified),
        openseaUrl:
            opensea.openseaUrl ||
            (reservoir.slug || opensea.slug
                ? `https://opensea.io/collection/${reservoir.slug || opensea.slug}`
                : `https://opensea.io/assets/ethereum/${key}`),
        blurUrl: `https://blur.io/collection/${key}`,
    };

    cache.set(key, { at: Date.now(), data: merged });
    return merged;
}

async function fetchReservoirCollection(contract: string): Promise<CollectionEnrichment> {
    try {
        const headers: Record<string, string> = {
            accept: 'application/json',
            ...(reservoirRequestHeaders() || {}),
        };
        // Public rate-limited access works without a key for light traffic
        if (!getReservoirApiKey()) {
            /* still attempt */
        }
        const url = `https://api.reservoir.tools/collections/v7?contract=${encodeURIComponent(contract)}&limit=1`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(7000) });
        if (!res.ok) return {};
        const json = (await res.json()) as {
            collections?: Array<{
                name?: string;
                symbol?: string;
                slug?: string;
                image?: string;
                banner?: string;
                tokenCount?: string | number;
                ownerCount?: string | number;
                floorAsk?: { price?: { amount?: { native?: number } } };
                volume?: { '1day'?: number; allTime?: number };
                openseaVerificationStatus?: string;
                metadata?: { imageUrl?: string; bannerImageUrl?: string };
            }>;
        };
        const col = json.collections?.[0];
        if (!col) return {};
        return {
            name: col.name,
            symbol: col.symbol,
            slug: col.slug,
            imageUrl: col.image || col.metadata?.imageUrl,
            bannerUrl: col.banner || col.metadata?.bannerImageUrl,
            floorEth: num(col.floorAsk?.price?.amount?.native),
            volume1dEth: num(col.volume?.['1day']),
            volumeAllEth: num(col.volume?.allTime),
            ownerCount: num(col.ownerCount),
            tokenCount: num(col.tokenCount),
            verified:
                col.openseaVerificationStatus === 'verified' ||
                col.openseaVerificationStatus === 'safe',
        };
    } catch {
        return {};
    }
}

async function fetchOpenSeaByContract(contract: string): Promise<CollectionEnrichment> {
    try {
        const headers: Record<string, string> = { accept: 'application/json' };
        const apiKey = process.env.OPENSEA_API_KEY?.trim();
        if (apiKey) headers['x-api-key'] = apiKey;

        const contractUrl = `https://api.opensea.io/api/v2/chain/ethereum/contract/${encodeURIComponent(contract)}`;
        const res = await fetch(contractUrl, { headers, signal: AbortSignal.timeout(7000) });
        if (!res.ok) return {};
        const json = (await res.json()) as {
            collection?: string;
            name?: string;
            contract_standard?: string;
        };
        const slug = json.collection;
        if (!slug) {
            return { name: json.name };
        }

        const colRes = await fetch(
            `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`,
            { headers, signal: AbortSignal.timeout(7000) }
        );
        if (!colRes.ok) {
            return {
                name: json.name,
                slug,
                openseaUrl: `https://opensea.io/collection/${slug}`,
            };
        }
        const col = (await colRes.json()) as {
            name?: string;
            description?: string;
            image_url?: string;
            banner_image_url?: string;
            safelist_status?: string;
            total_supply?: number;
            owners?: number;
            // some payloads expose stats inline
            stats?: {
                total?: { floor_price?: number; num_owners?: number; total_supply?: number };
                intervals?: Array<{ interval?: string; volume?: number }>;
            };
            // legacy / alternate
            favorites_count?: number;
            twitter_follower_count?: number;
        };

        // Optional stats endpoint for floor + favorites-like social proof
        let favorites: number | undefined = num(col.favorites_count);
        let floorEth: number | undefined = num(col.stats?.total?.floor_price);
        let ownerCount: number | undefined = num(col.owners) ?? num(col.stats?.total?.num_owners);

        try {
            const statsRes = await fetch(
                `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}/stats`,
                { headers, signal: AbortSignal.timeout(5000) }
            );
            if (statsRes.ok) {
                const stats = (await statsRes.json()) as {
                    total?: {
                        floor_price?: number;
                        num_owners?: number;
                        market_cap?: number;
                        sales?: number;
                        volume?: number;
                    };
                    intervals?: Array<{ interval?: string; volume?: number }>;
                };
                floorEth = num(stats.total?.floor_price) ?? floorEth;
                ownerCount = num(stats.total?.num_owners) ?? ownerCount;
            }
        } catch {
            /* ignore */
        }

        // OpenSea doesn't always expose favorites on v2 — use twitter followers as social signal fallback label elsewhere
        if (favorites === undefined) {
            favorites = num(col.twitter_follower_count);
        }

        return {
            name: col.name || json.name,
            slug,
            imageUrl: col.image_url,
            bannerUrl: col.banner_image_url,
            floorEth,
            ownerCount,
            tokenCount: num(col.total_supply) ?? num(col.stats?.total?.total_supply),
            favorites,
            verified: col.safelist_status === 'verified' || col.safelist_status === 'approved',
            openseaUrl: `https://opensea.io/collection/${slug}`,
        };
    } catch {
        return {};
    }
}

export function formatEthCompact(n: number | undefined, digits = 3): string {
    if (n === undefined || !Number.isFinite(n)) return '—';
    if (n === 0) return '0';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    if (n >= 100) return n.toFixed(1);
    if (n >= 1) return n.toFixed(Math.min(digits, 2));
    return n.toFixed(digits);
}

export function formatCountCompact(n: number | undefined): string {
    if (n === undefined || !Number.isFinite(n)) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${Math.round(n / 1000)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(Math.round(n));
}
