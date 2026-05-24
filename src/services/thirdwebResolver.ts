/**
 * Resolve thirdweb.com links to Ethereum mainnet NFT contracts.
 * Path URLs (ethereum/0x…) are parsed without network; slug pages use HTML metadata.
 */

import { isEthereumChainSlug } from '../config/chains';

/** explore/{chain}/{address} or {chain}/{address} */
const THIRDWEB_PATH_CONTRACT =
    /thirdweb\.com\/(?:explore\/)?([a-z0-9_-]+)\/(0x[a-fA-F0-9]{40})(?:\/|$|\?|#)/i;

/** Numeric chain id paths: thirdweb.com/1/0x… */
const THIRDWEB_CHAIN_ID_PATH = /thirdweb\.com\/(?:explore\/)?(\d{1,6})\/(0x[a-fA-F0-9]{40})(?:\/|$|\?|#)/i;

const THIRDWEB_DROP_SLUG = /thirdweb\.com\/(?:drop|drops)\/([a-z0-9_-]+)/i;

const THIRDWEB_PAGE_HOST = /thirdweb\.com/i;

const ETH_CHAIN_ALIASES = new Set(['ethereum', 'eth', 'mainnet', 'homestead', '1']);

const CHAIN_ID_TO_SLUG: Record<number, string> = {
    1: 'ethereum',
    8453: 'base',
    10: 'optimism',
    42161: 'arbitrum',
    137: 'polygon',
    7777777: 'zora',
};

const THIRDWEB_SYSTEM_CONTRACTS = new Set(
    [
        '0x00000000000000adc04c56bf30ac9d3c0aaf14dc',
        '0x0000000000664ceffed39244a8312556a900b938',
    ].map(a => a.toLowerCase())
);

function normalizeChainSlug(raw: string): string {
    const s = raw.toLowerCase();
    if (ETH_CHAIN_ALIASES.has(s)) return 'ethereum';
    if (/^\d+$/.test(s)) {
        const id = parseInt(s, 10);
        return CHAIN_ID_TO_SLUG[id] || `chain-${id}`;
    }
    return s;
}

function pickContractFromJsonBlob(blob: string): string | null {
    const patterns = [
        /"contractAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"contract"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"tokenAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"nftContract"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"collectionAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"address"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
    ];
    for (const re of patterns) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(blob)) !== null) {
            const addr = match[1].toLowerCase();
            if (!THIRDWEB_SYSTEM_CONTRACTS.has(addr)) return addr;
        }
    }
    return null;
}

function extractFromNextData(html: string): string | null {
    const script = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!script?.[1]) return null;
    return pickContractFromJsonBlob(script[1]);
}

function htmlLooksNonEthereum(html: string): boolean {
    if (/\"chainId\"\s*:\s*\"?(8453|10|137|42161|7777777|56|43114)/i.test(html)) return true;
    if (
        /thirdweb\.com\/(?:explore\/)?(base|polygon|optimism|arbitrum|zora|avalanche|bnb|binance|linea|scroll|blast)\//i.test(
            html
        )
    ) {
        return true;
    }
    return false;
}

/**
 * Parse contract + chain from Thirdweb dashboard URLs (no network).
 */
export function extractThirdwebContractFromUrl(input: string): {
    contract: string;
    chainSlug: string;
} | null {
    const trimmed = input.trim();
    let m = trimmed.match(THIRDWEB_PATH_CONTRACT);
    if (m) {
        const chainSlug = normalizeChainSlug(m[1]);
        const contract = m[2].toLowerCase();
        if (THIRDWEB_SYSTEM_CONTRACTS.has(contract)) return null;
        return { contract, chainSlug };
    }
    m = trimmed.match(THIRDWEB_CHAIN_ID_PATH);
    if (m) {
        const chainSlug = normalizeChainSlug(m[1]);
        const contract = m[2].toLowerCase();
        if (THIRDWEB_SYSTEM_CONTRACTS.has(contract)) return null;
        return { contract, chainSlug };
    }
    return null;
}

export function isThirdwebPageUrl(input: string): boolean {
    return THIRDWEB_PAGE_HOST.test(input);
}

export function isThirdwebDropSlugUrl(input: string): boolean {
    return THIRDWEB_DROP_SLUG.test(input.trim());
}

/**
 * Resolve a Thirdweb page to an Ethereum NFT contract (mainnet execution only).
 */
export async function resolveThirdwebContractFromUrl(
    input: string
): Promise<{ contract: string; slug: string; label: string } | null> {
    const trimmed = input.trim();
    if (!isThirdwebPageUrl(trimmed)) return null;

    const fromPath = extractThirdwebContractFromUrl(trimmed);
    if (fromPath) {
        if (!isEthereumChainSlug(fromPath.chainSlug)) return null;
        return {
            contract: fromPath.contract,
            slug: fromPath.contract.slice(0, 10),
            label: `Thirdweb ${fromPath.contract.slice(0, 8)}…`,
        };
    }

    if (process.env.THIRDWEB_RESOLVE_ENABLED === 'false') return null;

    const pageUrl = trimmed.startsWith('http') ? trimmed.split('?')[0] : `https://${trimmed}`;

    try {
        const res = await fetch(pageUrl, {
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'user-agent': 'UltraDadsMinterBot/1.0 (link-mint resolver)',
            },
            signal: AbortSignal.timeout(
                parseInt(process.env.THIRDWEB_RESOLVE_TIMEOUT_MS || '12000', 10)
            ),
            redirect: 'follow',
        });
        if (!res.ok) return null;
        const html = await res.text();

        if (htmlLooksNonEthereum(html)) return null;

        const slugMatch = trimmed.match(THIRDWEB_DROP_SLUG);
        const slug = slugMatch?.[1] || 'thirdweb';

        let contract = extractFromNextData(html) || pickContractFromJsonBlob(html);
        if (!contract) {
            const pathHit = html.match(
                /thirdweb\.com\/(?:explore\/)?(?:ethereum|eth|1)\/(0x[a-fA-F0-9]{40})/i
            );
            if (pathHit) contract = pathHit[1].toLowerCase();
        }
        if (!contract || THIRDWEB_SYSTEM_CONTRACTS.has(contract)) return null;

        const title =
            html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]?.trim() ||
            `Thirdweb ${slug}`;

        return { contract, slug, label: title };
    } catch {
        return null;
    }
}
