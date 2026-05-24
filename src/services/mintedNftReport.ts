/**
 * Post-mint NFT reporting — parse Transfer logs, resolve token metadata, format Telegram messages.
 */
import { Contract, Interface, JsonRpcProvider, type TransactionReceipt } from 'ethers';
import { fetchNFTMetadata } from '../utils/nftMetadata';

const ERC721_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const ERC721_META_ABI = [
    'function tokenURI(uint256 tokenId) view returns (string)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

export interface MintedToken {
    contract: string;
    tokenId: string;
    to: string;
    txHash: string;
    name?: string;
    imageUrl?: string;
}

export interface UserMintOutcome {
    uid: string;
    success: number;
    failed: number;
    tokens: MintedToken[];
    txLinks: string[];
    errors: string[];
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ipfsToHttp(uri: string): string {
    if (!uri) return '';
    if (uri.startsWith('ipfs://')) {
        return `https://cloudflare-ipfs.com/ipfs/${uri.slice(7)}`;
    }
    if (uri.startsWith('ipfs/')) {
        return `https://cloudflare-ipfs.com/${uri}`;
    }
    return uri;
}

export function extractAlchemyApiKey(providerUrl?: string): string | null {
    if (!providerUrl) return null;
    const raw = providerUrl.trim();
    if (!raw.includes('/') && /^[a-zA-Z0-9_-]{20,}$/.test(raw)) {
        return raw;
    }
    const first = raw.split(',')[0].trim();
    const m = first.match(/alchemy\.com\/v2\/([^/?]+)/i);
    return m?.[1] || null;
}

async function fetchAlchemyNftMeta(
    contract: string,
    tokenId: string,
    apiKey: string
): Promise<{ name?: string; imageUrl?: string } | null> {
    try {
        const url =
            `https://eth-mainnet.g.alchemy.com/nft/v3/${apiKey}/getNFTMetadata` +
            `?contractAddress=${contract}&tokenId=${tokenId}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const data = (await res.json()) as {
            name?: string;
            title?: string;
            image?: { cachedUrl?: string; originalUrl?: string };
            raw?: { metadata?: { name?: string; image?: string } };
        };
        const name = data.name || data.title || data.raw?.metadata?.name;
        const imageUrl =
            data.image?.cachedUrl ||
            data.image?.originalUrl ||
            ipfsToHttp(data.raw?.metadata?.image || '');
        return { name, imageUrl: imageUrl || undefined };
    } catch {
        return null;
    }
}

async function fetchTokenUriMeta(
    contract: string,
    tokenId: string,
    provider: JsonRpcProvider
): Promise<{ name?: string; imageUrl?: string } | null> {
    try {
        const c = new Contract(contract, ERC721_META_ABI, provider);
        const uri: string = await c.tokenURI(tokenId);
        const httpUri = ipfsToHttp(uri);
        if (!httpUri.startsWith('http')) return null;
        const res = await fetch(httpUri, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const json = (await res.json()) as { name?: string; image?: string };
        return {
            name: json.name,
            imageUrl: ipfsToHttp(json.image || ''),
        };
    } catch {
        return null;
    }
}

/** Parse ERC-721 Transfer logs from a mint receipt (mints: from = 0x0). */
export function extractMintedTokensFromReceipt(
    receipt: TransactionReceipt,
    opts?: { contractHint?: string; recipientHint?: string }
): Omit<MintedToken, 'name' | 'imageUrl'>[] {
    const iface = new Interface(ERC721_META_ABI);
    const out: Omit<MintedToken, 'name' | 'imageUrl'>[] = [];
    const contractHint = opts?.contractHint?.toLowerCase();
    const recipientHint = opts?.recipientHint?.toLowerCase();

    for (const log of receipt.logs || []) {
        if (log.topics[0]?.toLowerCase() !== ERC721_TRANSFER) continue;
        const contract = log.address.toLowerCase();
        if (contractHint && contract !== contractHint) continue;

        let parsed: { args: { from: string; to: string; tokenId: bigint } };
        try {
            parsed = iface.parseLog({ topics: log.topics as string[], data: log.data }) as unknown as typeof parsed;
        } catch {
            continue;
        }

        const from = parsed.args.from.toLowerCase();
        if (from !== '0x0000000000000000000000000000000000000000') continue;

        const to = parsed.args.to.toLowerCase();
        if (recipientHint && to !== recipientHint) continue;

        out.push({
            contract,
            tokenId: parsed.args.tokenId.toString(),
            to,
            txHash: receipt.hash,
        });
    }
    return out;
}

export async function enrichMintedTokens(
    tokens: Omit<MintedToken, 'name' | 'imageUrl'>[],
    provider: JsonRpcProvider,
    providerUrl?: string
): Promise<MintedToken[]> {
    const apiKey = extractAlchemyApiKey(providerUrl || process.env.PROVIDER_URL);
    const cache = new Map<string, { name?: string; imageUrl?: string }>();
    const enriched: MintedToken[] = [];

    for (const t of tokens) {
        const key = `${t.contract}:${t.tokenId}`;
        let meta = cache.get(key);
        if (!meta) {
            meta =
                (apiKey ? await fetchAlchemyNftMeta(t.contract, t.tokenId, apiKey) : null) ||
                (await fetchTokenUriMeta(t.contract, t.tokenId, provider)) ||
                {};
            cache.set(key, meta);
        }
        enriched.push({ ...t, name: meta.name, imageUrl: meta.imageUrl });
    }
    return enriched;
}

export function openseaTokenUrl(contract: string, tokenId: string): string {
    return `https://opensea.io/assets/ethereum/${contract}/${tokenId}`;
}

export function shortAddr(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatEthLine(valueEth?: string): string {
    if (valueEth === undefined || valueEth === '') return '';
    const n = parseFloat(valueEth);
    if (Number.isNaN(n) || n === 0) return ' · Free mint';
    return ` · ${valueEth} ETH`;
}

function formatTokenRollup(tokens: MintedToken[], max = 4): string {
    if (tokens.length === 0) return '';
    const shown = tokens.slice(0, max);
    const labels = shown.map(t => (t.name ? escapeHtml(t.name) : `#${t.tokenId}`));
    let line = labels.join(', ');
    if (tokens.length > max) line += `, <i>+${tokens.length - max}</i>`;
    return line;
}

/** Personal DM after successful mint(s) — clean, minimal. */
export function formatUserMintSuccessDm(
    outcomes: UserMintOutcome,
    collection?: { name: string; symbol: string }
): { text: string; imageUrl?: string } {
    const collName = collection?.name && collection.name !== 'Unknown' ? collection.name : 'Collection';
    const sym =
        collection?.symbol && collection.symbol !== 'Unknown'
            ? `\n<code>${escapeHtml(collection.symbol)}</code>`
            : '';

    let text = `<b>${escapeHtml(collName)}</b>${sym}\n`;
    text += `<i>Mint confirmed</i>\n\n`;

    if (outcomes.tokens.length > 0) {
        text += `${formatTokenRollup(outcomes.tokens, 6)}\n`;
        const t = outcomes.tokens[0];
        text += `\n<a href="${openseaTokenUrl(t.contract, t.tokenId)}">View on OpenSea</a>`;
        if (outcomes.tokens.length === 1) {
            text += ` · <a href="https://etherscan.io/tx/${t.txHash}">Transaction</a>`;
        }
        text += '\n';
    } else if (outcomes.success > 0) {
        text += `<b>${outcomes.success}</b> wallet${outcomes.success === 1 ? '' : 's'} confirmed\n`;
        if (outcomes.txLinks.length === 1) {
            text += `<a href="${outcomes.txLinks[0]}">Transaction</a>\n`;
        } else {
            outcomes.txLinks.slice(0, 5).forEach((link, i) => {
                text += `<a href="${link}">Wallet ${i + 1}</a>\n`;
            });
            if (outcomes.txLinks.length > 5) {
                text += `<i>+${outcomes.txLinks.length - 5} more</i>\n`;
            }
        }
    }

    if (outcomes.failed > 0) {
        text += `\n<b>${outcomes.failed}</b> reverted`;
        if (outcomes.errors[0]) {
            text += ` — <i>${escapeHtml(outcomes.errors[0].slice(0, 56))}</i>`;
        }
        text += '\n';
    }

    const imageUrl = outcomes.tokens.find(t => t.imageUrl)?.imageUrl;
    return { text, imageUrl };
}

/** Collection banner / OpenGraph image via Alchemy (no token id required). */
export async function fetchCollectionImageUrl(contract: string, providerUrl?: string): Promise<string | null> {
    const apiKey = extractAlchemyApiKey(providerUrl || process.env.PROVIDER_URL);
    if (!apiKey) return null;
    try {
        const url =
            `https://eth-mainnet.g.alchemy.com/nft/v3/${apiKey}/getContractMetadata` +
            `?contractAddress=${contract}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const data = (await res.json()) as {
            openSeaMetadata?: { imageUrl?: string };
            contractMetadata?: { image?: string };
        };
        return (
            data.openSeaMetadata?.imageUrl ||
            data.contractMetadata?.image ||
            null
        );
    } catch {
        return null;
    }
}

/** Admin / group channel — aggregated stats only (no per-user dump). */
export function formatCompactGlobalMintReport(params: {
    collectionName: string;
    collectionSymbol?: string;
    contract: string;
    successCount: number;
    failCount: number;
    walletTotal: number;
    participantCount: number;
    tokens: MintedToken[];
    valueEth?: string;
    /** Telegram user who initiated the mint (non-admin cross-user visibility). */
    mintedByLabel?: string;
}): string {
    const {
        collectionName,
        collectionSymbol,
        contract,
        successCount,
        failCount,
        walletTotal,
        participantCount,
        tokens,
        valueEth,
        mintedByLabel,
    } = params;

    const name = escapeHtml(collectionName !== 'Unknown' ? collectionName : 'Mint');
    const sym =
        collectionSymbol && collectionSymbol !== 'Unknown'
            ? ` <code>${escapeHtml(collectionSymbol)}</code>`
            : '';
    const rate = walletTotal > 0 ? Math.round((successCount / walletTotal) * 100) : 0;
    const status =
        successCount === walletTotal ? 'Complete' : successCount > 0 ? 'Partial' : 'Failed';

    let msg = `<b>${name}</b>${sym}\n`;
    msg += `<code>${contract}</code>\n`;
    if (mintedByLabel) msg += `\nMinted by ${mintedByLabel}\n`;
    msg += '\n';

    msg += `<b>${status}</b>  ·  <b>${successCount}</b> confirmed`;
    if (failCount > 0) msg += `  ·  <b>${failCount}</b> reverted`;
    msg += `\n${walletTotal} wallets`;
    if (participantCount > 1) msg += `  ·  ${participantCount} users`;
    msg += `  ·  ${rate}% hit rate`;
    msg += `${formatEthLine(valueEth)}\n`;

    const rollup = formatTokenRollup(tokens, 4);
    if (rollup) msg += `\n${rollup}\n`;

    msg += `\n<a href="https://opensea.io/assets/ethereum/${contract}">Collection</a>`;
    msg += ` · <a href="https://etherscan.io/address/${contract}">Etherscan</a>`;

    if (failCount > 0) {
        msg += `\n\n<i>Wallet-level detail was sent privately.</i>`;
    }

    return msg;
}

export async function loadCollectionMeta(
    contract: string,
    provider: JsonRpcProvider
): Promise<{ name: string; symbol: string }> {
    const meta = await fetchNFTMetadata(contract, provider);
    return { name: meta.name, symbol: meta.symbol };
}
