import { AbiCoder, type JsonRpcProvider } from 'ethers';
import type { MintIntent } from '../types/mintIntent';
import { getRuntimeConfig } from '../config/runtimeConfig';
import {
    findSeaDropPublicDrop,
    getSeaDropRemainingMintsWithDrop,
    isSeaDropPublicSelector,
    type SeaDropPublicDropInfo,
} from './seaDropBuilder';

export type AutomintQuantityMode = 'max_per_wallet' | 'match_whale';

/** Decode quantity from common mint calldata (SeaDrop public, etc.). */
export function decodeWhaleMintQuantity(txData: string): number {
    if (!txData || txData.length < 10) return 1;
    const selector = txData.slice(0, 10).toLowerCase();
    try {
        const coder = AbiCoder.defaultAbiCoder();
        const payload = ('0x' + txData.slice(10)) as `0x${string}`;
        if (isSeaDropPublicSelector(selector)) {
            const [, , , qty] = coder.decode(
                ['address', 'address', 'address', 'uint256'],
                payload
            );
            const n = Number(qty);
            return n > 0 ? n : 1;
        }
    } catch {
        /* fall through */
    }
    return 1;
}

function readGlobalQuantityCap(): number {
    const n = parseInt(process.env.COPY_MINT_MAX_QUANTITY || '50', 10);
    return Number.isFinite(n) && n > 0 ? n : 50;
}

function readQuantityMode(): AutomintQuantityMode {
    const m = (process.env.AUTOMINT_QUANTITY_MODE || 'max_per_wallet').toLowerCase();
    return m === 'match_whale' ? 'match_whale' : 'max_per_wallet';
}

function isSeaDropPublicRoute(routeType: MintIntent['routeType']): boolean {
    return routeType === 'seadrop_public';
}

/**
 * True when WalletPreflight must run estimateGas per wallet (Scatter/SeaDrop rebuild in preflight).
 * Fast path is unsafe when quantity differs from the whale tx or SeaDrop/Scatter rebuild is needed.
 */
export function automintRequiresForceGasEstimate(opts?: {
    seaDropNftContract?: string;
    scatterSlug?: string;
    routeType?: string;
    mintQty?: number;
    whaleQty?: number;
    skipSeaDropRebuild?: boolean;
}): boolean {
    if (opts?.skipSeaDropRebuild) {
        const mintQty = opts?.mintQty ?? 1;
        const whaleQty = opts?.whaleQty ?? 1;
        return mintQty > 1 || mintQty !== whaleQty;
    }
    if (opts?.seaDropNftContract?.trim() || opts?.scatterSlug?.trim()) return true;
    const route = (opts?.routeType || '').toLowerCase();
    if (route.startsWith('seadrop_')) return true;
    const mintQty = opts?.mintQty ?? 1;
    const whaleQty = opts?.whaleQty ?? 1;
    if (mintQty > 1 || mintQty !== whaleQty) return true;
    return false;
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    let idx = 0;
    const limit = Math.max(1, Math.min(concurrency, items.length));

    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            results[i] = await fn(items[i], i);
        }
    }

    await Promise.all(Array.from({ length: limit }, () => worker()));
    return results;
}

/**
 * How many NFTs to mint for this wallet on automint (per-wallet cap when SeaDrop public).
 */
export async function resolveAutomintQuantity(params: {
    provider: JsonRpcProvider;
    walletAddress: string;
    mintIntent: Pick<MintIntent, 'routeType' | 'targetContract' | 'quantity' | 'sourceQuantity'>;
    whaleTxData: string;
    mode?: AutomintQuantityMode;
    cap?: number;
    /** Cached public drop info — avoids repeated router lookups across wallets. */
    seaDropPublicDrop?: SeaDropPublicDropInfo | null;
}): Promise<number> {
    const cap = params.cap ?? readGlobalQuantityCap();
    const mode = params.mode ?? readQuantityMode();
    const whaleQty =
        decodeWhaleMintQuantity(params.whaleTxData) ||
        params.mintIntent.sourceQuantity ||
        params.mintIntent.quantity ||
        1;

    if (mode === 'match_whale') {
        return Math.max(1, Math.min(whaleQty, cap));
    }

    if (isSeaDropPublicRoute(params.mintIntent.routeType) && params.mintIntent.targetContract) {
        const contract = params.mintIntent.targetContract;
        let drop = params.seaDropPublicDrop;
        if (drop === undefined) {
            drop = await findSeaDropPublicDrop(contract, params.provider);
        }
        if (drop) {
            const stats = await getSeaDropRemainingMintsWithDrop(
                drop,
                contract,
                params.walletAddress,
                params.provider
            );
            if (stats) {
                if (stats.remaining <= 0) return 0;
                return Math.max(1, Math.min(stats.remaining, cap));
            }
        }
    }

    return Math.max(1, Math.min(whaleQty, cap));
}

export type AutomintWalletQuantity = {
    maxQty: number;
    /** Wallet with the highest remaining mint capacity (for calldata / SeaDrop checks). */
    leadWalletAddress: string | null;
};

/** Scan all user wallets in parallel — do not gate automint on wallet #1 only. */
export async function resolveAutomintQuantityAcrossWallets(params: {
    provider: JsonRpcProvider;
    walletAddresses: string[];
    mintIntent: Pick<MintIntent, 'routeType' | 'targetContract' | 'quantity' | 'sourceQuantity'>;
    whaleTxData: string;
    mode?: AutomintQuantityMode;
    cap?: number;
    /** Preloaded from whale-level cache — skips findSeaDropPublicDrop per user. */
    seaDropPublicDrop?: SeaDropPublicDropInfo | null;
}): Promise<AutomintWalletQuantity> {
    const cfg = getRuntimeConfig();
    const concurrency = cfg.preflightConcurrency;

    let seaDropPublicDrop: SeaDropPublicDropInfo | null | undefined = params.seaDropPublicDrop;
    if (
        seaDropPublicDrop === undefined &&
        isSeaDropPublicRoute(params.mintIntent.routeType) &&
        params.mintIntent.targetContract
    ) {
        seaDropPublicDrop = await findSeaDropPublicDrop(
            params.mintIntent.targetContract,
            params.provider
        );
    }

    const scans = await mapWithConcurrency(
        params.walletAddresses,
        concurrency,
        async walletAddress =>
            resolveAutomintQuantity({
                provider: params.provider,
                walletAddress,
                mintIntent: params.mintIntent,
                whaleTxData: params.whaleTxData,
                mode: params.mode,
                cap: params.cap,
                seaDropPublicDrop,
            })
    );

    let maxQty = 0;
    let leadWalletAddress: string | null = null;
    for (let i = 0; i < params.walletAddresses.length; i++) {
        const qty = scans[i];
        if (qty > maxQty) {
            maxQty = qty;
            leadWalletAddress = params.walletAddresses[i];
        }
    }

    return { maxQty, leadWalletAddress };
}

/** Scale tx value from a per-unit price and quantity. */
export function scaleMintValueWei(unitWei: string, quantity: number): string {
    if (quantity <= 1) return unitWei;
    try {
        return (BigInt(unitWei || '0') * BigInt(quantity)).toString();
    } catch {
        return unitWei;
    }
}

export function mintIntentUnitPriceWei(intent: Pick<MintIntent, 'totalValueWei' | 'unitPriceWei' | 'quantity'>): string {
    if (intent.unitPriceWei) return intent.unitPriceWei;
    const qty = Math.max(1, intent.quantity || 1);
    try {
        return (BigInt(intent.totalValueWei || '0') / BigInt(qty)).toString();
    } catch {
        return intent.totalValueWei || '0';
    }
}
