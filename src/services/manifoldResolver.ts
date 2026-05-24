/**
 * Resolve Manifold.xyz collection URLs to Ethereum NFT contracts (mainnet only).
 */

import { isEthereumChainSlug } from '../config/chains';
import {
    extractManifoldInstanceIdFromUrl,
    resolveManifoldProductByInstanceId,
} from './manifoldStudioClient';

const MANIFOLD_PAGE_SLUG =
    /(?:https?:\/\/)?(?:www\.)?app\.manifold\.xyz\/c\/(?:[a-z0-9_-]+\/)?([a-z0-9_-]+)/i;

/** Known Manifold system contracts — never treat as the NFT collection. */
const MANIFOLD_SYSTEM_CONTRACTS = new Set(
    [
        '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', // Seaport
        '0x0000000000664ceffed39244a8312556a900b938',
    ].map(a => a.toLowerCase())
);

export function extractManifoldPageSlug(input: string): string | null {
    const m = input.trim().match(MANIFOLD_PAGE_SLUG);
    return m ? m[1].toLowerCase() : null;
}

function pickContractFromJsonBlob(blob: string): string | null {
    const patterns = [
        /"contractAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"contract"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"tokenAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"nftContract"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"collectionAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
    ];
    for (const re of patterns) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(blob)) !== null) {
            const addr = match[1].toLowerCase();
            if (!MANIFOLD_SYSTEM_CONTRACTS.has(addr)) return addr;
        }
    }
    return null;
}

/** Extract Manifold instance id from embedded Next.js payload (for API fallback). */
export function extractManifoldInstanceId(html: string): string | null {
    const script = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!script?.[1]) return null;
    const m =
        script[1].match(/"instanceId"\s*:\s*"?(\d+)"?/i) ||
        script[1].match(/"instance_id"\s*:\s*"?(\d+)"?/i);
    return m ? m[1] : null;
}

function extractFromNextData(html: string): string | null {
    const script = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!script?.[1]) return null;
    try {
        return pickContractFromJsonBlob(script[1]);
    } catch {
        return null;
    }
}

/** Manifold Creator API fallbacks when HTML scrape misses contract address. */
async function resolveManifoldViaCreatorApi(
    slug: string,
    instanceId?: string | null
): Promise<{ contract: string; label: string } | null> {
    const candidates: string[] = [];
    if (instanceId) {
        candidates.push(`https://apps.manifold.xyz/public/instance/${instanceId}`);
        candidates.push(`https://app.manifold.xyz/api/creator/instance/${instanceId}`);
    }
    candidates.push(`https://app.manifold.xyz/api/creator/instance/slug/${slug}`);

    for (const url of candidates) {
        try {
            const res = await fetch(url, {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) continue;
            const text = await res.text();
            const contract = pickContractFromJsonBlob(text);
            if (!contract) continue;
            let label = `Manifold ${slug}`;
            try {
                const json = JSON.parse(text) as { title?: string; name?: string };
                label = json.title || json.name || label;
            } catch {
                /* keep default */
            }
            return { contract, label };
        } catch {
            /* try next URL */
        }
    }
    return null;
}

/**
 * Fetch Manifold page HTML and extract the NFT contract (Ethereum listings only).
 */
export async function resolveManifoldContractFromUrl(
    input: string
): Promise<{ contract: string; slug: string; label: string } | null> {
    const slug = extractManifoldPageSlug(input);
    const instanceIdFromUrl = extractManifoldInstanceIdFromUrl(input);

    if (!slug && instanceIdFromUrl) {
        const fromStudio = await resolveManifoldProductByInstanceId(instanceIdFromUrl);
        if (fromStudio) {
            return {
                contract: fromStudio.contract,
                slug: fromStudio.slug || instanceIdFromUrl,
                label: fromStudio.label,
            };
        }
        return null;
    }

    if (!slug) return null;

    const pageUrl = input.startsWith('http') ? input.split('?')[0] : `https://app.manifold.xyz/c/${slug}`;

    try {
        const res = await fetch(pageUrl, {
            headers: {
                accept: 'text/html',
                'user-agent': 'UltraDadsMinterBot/1.0 (link-mint resolver)',
            },
            signal: AbortSignal.timeout(12_000),
            redirect: 'follow',
        });
        if (!res.ok) return null;
        const html = await res.text();

        if (/\"chain\"\s*:\s*\"(base|polygon|optimism|arbitrum|zora)\"/i.test(html)) {
            const chainHit = html.match(/\"chain\"\s*:\s*\"([a-z]+)\"/i);
            const chain = chainHit?.[1]?.toLowerCase();
            if (chain && !isEthereumChainSlug(chain)) return null;
        }

        const instanceId =
            extractManifoldInstanceId(html) || extractManifoldInstanceIdFromUrl(input) || null;
        let contract = extractFromNextData(html) || pickContractFromJsonBlob(html);
        let label =
            html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]?.trim() ||
            `Manifold ${slug}`;

        if (!contract && instanceId) {
            const fromStudio = await resolveManifoldProductByInstanceId(instanceId);
            if (fromStudio) {
                contract = fromStudio.contract;
                label = fromStudio.label;
            }
        }

        if (!contract) {
            const fromApi = await resolveManifoldViaCreatorApi(slug, instanceId);
            if (!fromApi) return null;
            contract = fromApi.contract;
            label = fromApi.label;
        }

        return { contract, slug, label };
    } catch {
        return null;
    }
}
