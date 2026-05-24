/**
 * Scatter.art mint API — builds mint calldata for Scatter collections.
 * @see https://docs.scatter.art/api/getting-started
 */

import { Contract, MaxUint256, Wallet, type JsonRpcProvider } from 'ethers';
import { isEthereumChainId } from '../config/chains';

const SCATTER_API_BASE = 'https://api.scatter.art/v1';
const ERC20_ABI = [
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
];
const SCATTER_UNLIMITED = 4_294_967_295;

export interface ScatterCollection {
    slug: string;
    address: string;
    chainId: number;
    name?: string;
    maxItems?: number;
    numItems?: number;
}

export interface ScatterInviteList {
    id: string;
    name: string;
    token_price: string;
    currency_symbol?: string;
    start_time?: string;
    end_time?: string | null;
    wallet_limit: number;
    list_limit: number;
}

export interface ScatterMintTransaction {
    to: string;
    data: string;
    value: string;
}

export interface ScatterMintBuildResult {
    collection: ScatterCollection;
    list: ScatterInviteList;
    tx: ScatterMintTransaction;
    erc20Approvals: { address: string; amount: string }[];
    warnings: string[];
}

export function extractScatterSlug(input: string): string | null {
    const m = input.match(/scatter\.art\/collection\/([a-z0-9_-]+)/i);
    return m ? m[1].toLowerCase() : null;
}

export function chainIdToSlug(chainId: number): string {
    if (chainId === 8453) return 'base';
    if (chainId === 137) return 'polygon';
    if (chainId === 42161) return 'arbitrum';
    if (chainId === 10) return 'optimism';
    return 'ethereum';
}

function isListActive(list: ScatterInviteList, now = Date.now()): boolean {
    if (list.start_time) {
        const start = Date.parse(list.start_time);
        if (!Number.isNaN(start) && start > now) return false;
    }
    if (list.end_time) {
        const end = Date.parse(list.end_time);
        if (!Number.isNaN(end) && end <= now) return false;
    }
    return true;
}

function scatterPreferPaidList(): boolean {
    return process.env.SCATTER_PREFER_PAID_LIST === 'true';
}

/** Order lists for mint attempts (active only). */
export function orderScatterListsForMint(lists: ScatterInviteList[]): ScatterInviteList[] {
    const active = lists.filter(isListActive);
    if (!active.length) return [];

    const paid = active.filter(l => parseFloat(l.token_price || '0') > 0);
    const free = active.filter(l => parseFloat(l.token_price || '0') <= 0);

    const byPriceAsc = (a: ScatterInviteList, b: ScatterInviteList) => {
        const pa = parseFloat(a.token_price || '0') || 0;
        const pb = parseFloat(b.token_price || '0') || 0;
        return pa - pb;
    };
    paid.sort(byPriceAsc);
    free.sort(byPriceAsc);

    if (scatterPreferPaidList() && paid.length) {
        return [...paid, ...free];
    }
    return [...free, ...paid];
}

/** Pick the best eligible list (active; free first, then paid — unless SCATTER_PREFER_PAID_LIST=true). */
export function pickBestScatterList(lists: ScatterInviteList[]): ScatterInviteList | null {
    const ordered = orderScatterListsForMint(lists);
    return ordered[0] ?? null;
}

export async function fetchScatterCollection(slug: string): Promise<ScatterCollection | null> {
    try {
        const res = await fetch(`${SCATTER_API_BASE}/collection/${encodeURIComponent(slug)}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as {
            slug?: string;
            address?: string;
            chain_id?: number;
            name?: string;
            max_items?: number;
            num_items?: number;
        };
        if (!json.address || !json.chain_id) return null;
        return {
            slug: json.slug || slug,
            address: json.address.toLowerCase(),
            chainId: json.chain_id,
            name: json.name,
            maxItems: json.max_items,
            numItems: json.num_items,
        };
    } catch {
        return null;
    }
}

export async function fetchEligibleScatterLists(
    slug: string,
    walletAddress?: string
): Promise<ScatterInviteList[]> {
    try {
        const qs = walletAddress ? `?walletAddress=${walletAddress}` : '';
        const res = await fetch(
            `${SCATTER_API_BASE}/collection/${encodeURIComponent(slug)}/eligible-invite-lists${qs}`,
            { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) }
        );
        if (!res.ok) return [];
        const json = (await res.json()) as ScatterInviteList[];
        return Array.isArray(json) ? json : [];
    } catch {
        return [];
    }
}

function formatScatterValue(value: string): string {
    if (!value || value === '0') return '0x0';
    if (value.startsWith('0x')) return value;
    return '0x' + BigInt(value).toString(16);
}

export async function buildScatterMintForWallet(params: {
    collection: ScatterCollection;
    minterAddress: string;
    listId: string;
    quantity: number;
    affiliateAddress?: string;
}): Promise<ScatterMintBuildResult | null> {
    const body: Record<string, unknown> = {
        collectionAddress: params.collection.address,
        chainId: params.collection.chainId,
        minterAddress: params.minterAddress,
        lists: [{ id: params.listId, quantity: params.quantity }],
    };
    const affiliate = params.affiliateAddress?.trim();
    if (affiliate) body.affiliateAddress = affiliate;

    try {
        const res = await fetch(`${SCATTER_API_BASE}/mint`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            console.warn(
                `[Scatter] mint API ${res.status} list=${params.listId} minter=${params.minterAddress.slice(0, 10)}… ${errBody.slice(0, 120)}`
            );
            return null;
        }
        const json = (await res.json()) as {
            mintTransaction?: { to?: string; data?: string; value?: string };
            erc20s?: { address: string; amount: string }[];
        };
        const mt = json.mintTransaction;
        if (!mt?.to || !mt?.data) return null;

        const warnings: string[] = [
            `Scatter list: ${params.listId}`,
            `Scatter mint via API → <code>${mt.to.slice(0, 10)}…</code>`,
        ];
        const erc20s = json.erc20s || [];
        if (erc20s.length) {
            warnings.push(`ERC20 mint (${erc20s.length} token(s)) — bot will approve on collection if needed`);
        }
        if (
            params.collection.maxItems != null &&
            params.collection.numItems != null &&
            params.collection.numItems >= params.collection.maxItems
        ) {
            warnings.push('⚠️ Collection may be sold out on Scatter');
        }

        return {
            collection: params.collection,
            list: { id: params.listId, name: '', token_price: '0', wallet_limit: SCATTER_UNLIMITED, list_limit: SCATTER_UNLIMITED },
            tx: {
                to: mt.to.toLowerCase(),
                data: mt.data,
                value: formatScatterValue(mt.value ?? '0'),
            },
            erc20Approvals: erc20s,
            warnings,
        };
    } catch {
        return null;
    }
}

export interface ScatterWalletMint {
    to: string;
    data: string;
    value: string;
    chainId: number;
    collectionAddress: string;
    erc20Approvals: { address: string; amount: string }[];
    warnings: string[];
}

export function scatterChainSupported(chainId: number): boolean {
    return isEthereumChainId(chainId);
}

/** Per-wallet mint tx (Scatter proofs are address-specific). */
export async function buildScatterCalldataForWallet(params: {
    slug: string;
    walletAddress: string;
    quantity: number;
    affiliateAddress?: string;
}): Promise<ScatterWalletMint | null> {
    const built = await resolveScatterLinkMint({
        slug: params.slug,
        minterAddress: params.walletAddress,
        quantity: params.quantity,
        affiliateAddress: params.affiliateAddress,
    });
    if (!built) return null;
    if (!scatterChainSupported(built.collection.chainId)) {
        return null;
    }
    return {
        to: built.tx.to,
        data: built.tx.data,
        value: built.tx.value,
        chainId: built.collection.chainId,
        collectionAddress: built.collection.address,
        erc20Approvals: built.erc20Approvals,
        warnings: built.warnings,
    };
}

/**
 * Approve Scatter-required ERC20s on the collection contract before mint.
 * Returns human-readable status lines for Telegram logs.
 */
export async function ensureScatterErc20Approvals(params: {
    provider: JsonRpcProvider;
    signer: Wallet;
    collectionAddress: string;
    erc20s: { address: string; amount: string }[];
}): Promise<{ ok: boolean; messages: string[]; error?: string }> {
    if (!params.erc20s.length) return { ok: true, messages: [] };

    const owner = params.signer.address.toLowerCase();
    const spender = params.collectionAddress.toLowerCase();
    const messages: string[] = [];

    try {
        let nonce = await params.provider.getTransactionCount(params.signer.address, 'pending');

        for (const erc20 of params.erc20s) {
            const token = new Contract(erc20.address, ERC20_ABI, params.signer);
            const needed = BigInt(erc20.amount || '0');
            const allowance = (await token.allowance(owner, spender)) as bigint;
            if (allowance >= needed) {
                messages.push(`ERC20 ${erc20.address.slice(0, 8)}… already approved`);
                continue;
            }

            const tx = await token.approve(spender, MaxUint256, { nonce: nonce++ });
            messages.push(`ERC20 approve submitted: ${tx.hash.slice(0, 14)}…`);
            const receipt = await tx.wait(1);
            if (!receipt || receipt.status === 0) {
                return { ok: false, messages, error: `ERC20 approve reverted for ${erc20.address}` };
            }
        }

        return { ok: true, messages };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, messages, error: msg.slice(0, 200) };
    }
}

export async function resolveScatterLinkMint(params: {
    slug: string;
    minterAddress: string;
    quantity: number;
    affiliateAddress?: string;
}): Promise<ScatterMintBuildResult | null> {
    const collection = await fetchScatterCollection(params.slug);
    if (!collection) return null;

    let lists = await fetchEligibleScatterLists(params.slug, params.minterAddress);
    if (!lists.length) {
        lists = await fetchEligibleScatterLists(params.slug);
    }
    const ordered = orderScatterListsForMint(lists);
    if (!ordered.length) return null;

    for (const list of ordered) {
        const built = await buildScatterMintForWallet({
            collection,
            minterAddress: params.minterAddress,
            listId: list.id,
            quantity: params.quantity,
            affiliateAddress: params.affiliateAddress,
        });
        if (!built) continue;

        built.list = list;
        built.warnings.unshift(
            `Scatter: <b>${collection.name || params.slug}</b> — <code>${list.name || list.id}</code> (${list.token_price === '0' ? 'FREE' : `${list.token_price} ${list.currency_symbol || 'ETH'}`})`
        );
        return built;
    }

    return null;
}
