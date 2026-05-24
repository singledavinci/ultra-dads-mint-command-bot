/**
 * dropResolver.ts
 * Resolves OpenSea collection URLs / slugs / contract addresses
 * into a usable contract address + collection label for drop minting.
 */

import { getReservoirApiKey, reservoirRequestHeaders } from '../config/reservoir';
import { chainIdToSlug, extractScatterSlug, fetchScatterCollection } from '../services/scatterMint';
import { resolveManifoldContractFromUrl } from '../services/manifoldResolver';
import { resolveThirdwebContractFromUrl, isThirdwebPageUrl } from '../services/thirdwebResolver';
import { resolveZoraContractFromUrl, isZoraPageUrl } from '../services/zoraResolver';
import { resolvePlatformContractFromUrl } from '../services/platformLinkResolver';

export interface DropInfo {
    contract: string;
    label: string;
    chainSlug: string; // "ethereum", "base", "polygon", etc.
}

/**
 * Try to extract a contract address directly from an OpenSea asset URL.
 * Handles:
 *   https://opensea.io/assets/ethereum/0xABC.../1
 *   https://opensea.io/assets/ether/0xABC...
 */
function extractFromAssetUrl(url: string): DropInfo | null {
    const match = url.match(/opensea\.io\/assets\/([a-z0-9_-]+)\/(0x[a-fA-F0-9]{40})/i);
    if (match) {
        return {
            contract: match[2].toLowerCase(),
            label: match[2].slice(0, 8) + '...',
            chainSlug: match[1].toLowerCase()
        };
    }
    return null;
}

/**
 * Extracts slug from collection URL:
 *   https://opensea.io/collection/azuki
 */
function extractSlug(url: string): string | null {
    const match = url.match(/opensea\.io\/collection\/([a-z0-9_-]+)/i);
    return match ? match[1] : null;
}

/**
 * Resolve a raw 0x contract address typed directly.
 * Also handles Etherscan and CatchMint URLs containing addresses.
 */
function extractRawAddress(input: string): DropInfo | null {
    // 1. Raw Address
    const rawMatch = input.match(/^(0x[a-fA-F0-9]{40})$/);
    if (rawMatch) {
        return {
            contract: rawMatch[1].toLowerCase(),
            label: rawMatch[1].slice(0, 8) + '...',
            chainSlug: 'ethereum'
        };
    }

    // 2. Etherscan (Address or Token)
    const etherMatch = input.match(/etherscan\.io\/(address|token)\/(0x[a-fA-F0-9]{40})/i);
    if (etherMatch) {
        return {
            contract: etherMatch[2].toLowerCase(),
            label: 'Etherscan Drop',
            chainSlug: 'ethereum'
        };
    }

    // 3. CatchMint (Aggregator)
    const catchMatch = input.match(/catchmint\.xyz\/(collections|mints|address)\/(0x[a-fA-F0-9]{40})/i);
    if (catchMatch) {
        return {
            contract: catchMatch[2].toLowerCase(),
            label: 'CatchMint Drop',
            chainSlug: 'ethereum'
        };
    }

    return null;
}

/**
 * Use Reservoir API (free, no key needed for basic) to resolve a collection slug
 * into a contract address and name.
 */
async function resolveSlugViaReservoir(slug: string): Promise<DropInfo | null> {
    const reservoirHeaders = reservoirRequestHeaders();
    if (!getReservoirApiKey()) return null;

    try {
        const url = `https://api.reservoir.tools/collections/v7?slug=${encodeURIComponent(slug)}&limit=1`;
        const res = await fetch(url, {
            headers: reservoirHeaders,
        });
        if (!res.ok) throw new Error(`Reservoir HTTP ${res.status}`);
        const json = await res.json() as any;
        const col = json?.collections?.[0];
        if (!col?.primaryContract) return null;
        return {
            contract: col.primaryContract.toLowerCase(),
            label: col.name || slug,
            chainSlug: col.chainId === 8453 ? 'base' : col.chainId === 137 ? 'polygon' : 'ethereum'
        };
    } catch (e) {
        return null;
    }
}

/**
 * Use OpenSea API v2 (no API key for collection lookup).
 */
async function resolveSlugViaOpenSea(slug: string): Promise<DropInfo | null> {
    try {
        const url = `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`;
        const res = await fetch(url, {
            headers: {
                'accept': 'application/json',
                // No key needed for collection metadata endpoint on v2 (rate limited only)
            }
        });
        if (!res.ok) throw new Error(`OpenSea HTTP ${res.status}`);
        const json = await res.json() as any;
        const contracts = json?.contracts;
        if (!contracts || contracts.length === 0) return null;
        // Prefer Ethereum mainnet contract
        const eth = contracts.find((c: any) => c.chain === 'ethereum' || c.chain === 'base') || contracts[0];
        return {
            contract: eth.address.toLowerCase(),
            label: json.name || slug,
            chainSlug: eth.chain || 'ethereum'
        };
    } catch (e) {
        return null;
    }
}

/**
 * Main entry point. Accepts:
 * - Full OpenSea asset URL
 * - Full OpenSea collection URL
 * - Raw 0x contract address
 * - Collection slug string
 */
export async function resolveDropTarget(input: string): Promise<DropInfo | null> {
    const trimmed = input.trim();

    // 1. Raw address
    const raw = extractRawAddress(trimmed);
    if (raw) return raw;

    // 1b. Manifold page slug (no 0x in URL)
    const manifold = await resolveManifoldContractFromUrl(trimmed);
    if (manifold) {
        return {
            contract: manifold.contract,
            label: manifold.label,
            chainSlug: 'ethereum',
        };
    }

    // 1b2. Zora collect/mint pages (ETH only)
    if (isZoraPageUrl(trimmed) && !resolvePlatformContractFromUrl(trimmed)) {
        const zora = await resolveZoraContractFromUrl(trimmed);
        if (zora) {
            return {
                contract: zora.contract,
                label: zora.label,
                chainSlug: 'ethereum',
            };
        }
    }

    // 1b3. Thirdweb dashboard / drop pages (ETH only)
    if (isThirdwebPageUrl(trimmed) && !resolvePlatformContractFromUrl(trimmed)) {
        const thirdweb = await resolveThirdwebContractFromUrl(trimmed);
        if (thirdweb) {
            return {
                contract: thirdweb.contract,
                label: thirdweb.label,
                chainSlug: 'ethereum',
            };
        }
    }

    // 1c. Zora / Manifold / Thirdweb URLs with embedded contract (ETH only)
    const platform = resolvePlatformContractFromUrl(trimmed);
    if (platform) {
        return {
            contract: platform.contract,
            label: platform.label,
            chainSlug: platform.chainSlug,
        };
    }

    // 2. OpenSea asset URL with address embedded
    const fromAsset = extractFromAssetUrl(trimmed);
    if (fromAsset) return fromAsset;

    // 2b. Scatter.art collection URL
    const scatterSlug = extractScatterSlug(trimmed);
    if (scatterSlug) {
        const col = await fetchScatterCollection(scatterSlug);
        if (col) {
            return {
                contract: col.address,
                label: col.name || scatterSlug,
                chainSlug: chainIdToSlug(col.chainId),
            };
        }
    }

    // 3. OpenSea collection URL → extract slug → API resolve
    const slug = extractSlug(trimmed) || trimmed; // fallback: treat whole string as slug

    // Try Reservoir first (more reliable, no key needed)
    const fromReservoir = await resolveSlugViaReservoir(slug);
    if (fromReservoir) return fromReservoir;

    // Fallback: OpenSea API
    const fromOpenSea = await resolveSlugViaOpenSea(slug);
    return fromOpenSea;
}
