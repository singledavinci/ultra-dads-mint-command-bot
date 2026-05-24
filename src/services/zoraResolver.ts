/**
 * Resolve Zora.co links to Ethereum mainnet NFT contracts.
 * Collect URLs with chain:address are parsed from the path; mint/slug pages use HTML metadata.
 */

import { isEthereumChainSlug } from '../config/chains';

/** collect/{chain}:{address} or collect/{chain}/{address} with optional /tokenId */
const ZORA_COLLECT_IN_PATH =
    /zora\.co\/collect\/([a-z0-9]+)\s*[:/]\s*(0x[a-fA-F0-9]{40})(?:\/\d+)?/i;

const ZORA_MINT_SLUG_PAGE = /zora\.co\/mint\/([a-z0-9_-]+)/i;

const ZORA_PAGE_HOST = /zora\.co/i;

/** Zora system / marketplace contracts — never treat as the collection. */
const ZORA_SYSTEM_CONTRACTS = new Set(
    [
        '0x00000000000000adc04c56bf30ac9d3c0aaf14dc',
        '0x0000000000664ceffed39244a8312556a900b938',
    ].map(a => a.toLowerCase())
);

const ETH_CHAIN_ALIASES = new Set(['ethereum', 'eth', 'mainnet', 'homestead']);

function normalizeChainSlug(raw: string): string {
    const s = raw.toLowerCase();
    if (ETH_CHAIN_ALIASES.has(s)) return 'ethereum';
    return s;
}

function pickContractFromJsonBlob(blob: string): string | null {
    const patterns = [
        /"contractAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"collectionAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"nftContract"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"tokenContract"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
        /"address"\s*:\s*"(0x[a-fA-F0-9]{40})"/gi,
    ];
    for (const re of patterns) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(blob)) !== null) {
            const addr = match[1].toLowerCase();
            if (!ZORA_SYSTEM_CONTRACTS.has(addr)) return addr;
        }
    }
    return null;
}

function extractFromNextData(html: string): string | null {
    const script = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!script?.[1]) return null;
    return pickContractFromJsonBlob(script[1]);
}

/**
 * Parse contract from Zora collect URLs (no network): eth:0x…, ethereum:0x…, etc.
 */
export function extractZoraCollectContractFromUrl(input: string): {
    contract: string;
    chainSlug: string;
} | null {
    const m = input.trim().match(ZORA_COLLECT_IN_PATH);
    if (!m) return null;
    const chainSlug = normalizeChainSlug(m[1]);
    const contract = m[2].toLowerCase();
    if (ZORA_SYSTEM_CONTRACTS.has(contract)) return null;
    return { contract, chainSlug };
}

export function isZoraPageUrl(input: string): boolean {
    return ZORA_PAGE_HOST.test(input);
}

export function isZoraMintSlugUrl(input: string): boolean {
    return ZORA_MINT_SLUG_PAGE.test(input.trim());
}

/**
 * Resolve a Zora page to an Ethereum NFT contract (mainnet execution only).
 */
export async function resolveZoraContractFromUrl(
    input: string
): Promise<{ contract: string; slug: string; label: string } | null> {
    const trimmed = input.trim();
    if (!isZoraPageUrl(trimmed)) return null;

    const fromPath = extractZoraCollectContractFromUrl(trimmed);
    if (fromPath) {
        if (!isEthereumChainSlug(fromPath.chainSlug)) return null;
        return {
            contract: fromPath.contract,
            slug: fromPath.contract.slice(0, 10),
            label: `Zora ${fromPath.contract.slice(0, 8)}…`,
        };
    }

    if (process.env.ZORA_RESOLVE_ENABLED === 'false') return null;

    const pageUrl = trimmed.startsWith('http') ? trimmed.split('?')[0] : `https://${trimmed}`;

    try {
        const res = await fetch(pageUrl, {
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'user-agent': 'UltraDadsMinterBot/1.0 (link-mint resolver)',
            },
            signal: AbortSignal.timeout(parseInt(process.env.ZORA_RESOLVE_TIMEOUT_MS || '12000', 10)),
            redirect: 'follow',
        });
        if (!res.ok) return null;
        const html = await res.text();

        if (/\"chain(?:Id|)\"\s*:\s*\"?(8453|10|137|42161|7777777)/i.test(html)) {
            return null;
        }
        if (/collect\/(base|polygon|optimism|arbitrum|zora)[:/]/i.test(html)) {
            return null;
        }

        const slugMatch = trimmed.match(ZORA_MINT_SLUG_PAGE);
        const slug = slugMatch?.[1] || 'zora';

        let contract = extractFromNextData(html) || pickContractFromJsonBlob(html);
        if (!contract) {
            const pathHit = html.match(/collect\/[a-z0-9]+\s*[:/]\s*(0x[a-fA-F0-9]{40})/i);
            if (pathHit) contract = pathHit[1].toLowerCase();
        }
        if (!contract || ZORA_SYSTEM_CONTRACTS.has(contract)) return null;

        const title =
            html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1]?.trim() ||
            `Zora ${slug}`;

        return { contract, slug, label: title };
    } catch {
        return null;
    }
}
