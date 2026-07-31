/**
 * Wallet-grade network gas estimation (MintDash parity).
 *
 * eth_feeHistory percentile tip + next-block base fee.
 * Network tiers send maxFee = nextBase * headroom + tip (LOW headroom = 1×).
 */

import { JsonRpcProvider, parseUnits } from 'ethers';

export type NetworkGasTier = 'LOW' | 'MARKET' | 'FAST';

export type NetworkGasEstimate = {
    baseFeeWei: bigint;
    maxPriorityFeePerGasWei: bigint;
    maxFeePerGasWei: bigint;
};

const GWEI = 1_000_000_000n;

function clampPercentile(p: number): number {
    if (!Number.isFinite(p)) return 50;
    if (p < 1) return 1;
    if (p > 99) return 99;
    return Math.floor(p);
}

const FEE_HISTORY_BLOCKS = Math.max(1, Number(process.env.GAS_FEEHISTORY_BLOCKS ?? process.env.MINT_GAS_FEEHISTORY_BLOCKS ?? 20));

const TIER_PERCENTILE: Record<NetworkGasTier, number> = {
    LOW: clampPercentile(Number(process.env.GAS_PERCENTILE_LOW ?? process.env.MINT_GAS_PERCENTILE_LOW ?? 10)),
    MARKET: clampPercentile(
        Number(process.env.GAS_PERCENTILE_MARKET ?? process.env.MINT_GAS_PERCENTILE_MARKET ?? 50)
    ),
    FAST: clampPercentile(Number(process.env.GAS_PERCENTILE_HIGH ?? process.env.MINT_GAS_PERCENTILE_HIGH ?? 90)),
};

function maxFeeHeadroomMultiplier(tier: NetworkGasTier): bigint {
    if (tier === 'LOW') return 1n;
    const raw = Number(process.env.GAS_MAXFEE_HEADROOM_MULT ?? process.env.MINT_GAS_MAXFEE_HEADROOM_MULT ?? 2);
    const mult = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw * 100), 400) : 200;
    return BigInt(mult) / 100n;
}

/** Genuine protocol floors only — ETH defaults to 0 (no artificial buffer). */
function minPriorityFloorWei(): bigint {
    const gwei = Number(process.env.ETH_MIN_PRIORITY_GWEI ?? process.env.MINT_ETH_MIN_PRIORITY_GWEI ?? 0);
    return BigInt(Math.max(0, Math.floor(gwei))) * GWEI;
}

function staticTierFloorWei(tier: NetworkGasTier): bigint {
    // Tiny fallbacks when feeHistory rewards are empty — not competitive bribes.
    if (tier === 'LOW') return parseUnits('0.01', 'gwei');
    if (tier === 'FAST') return parseUnits('0.5', 'gwei');
    return parseUnits('0.05', 'gwei');
}

function median(values: bigint[]): bigint {
    if (values.length === 0) return 0n;
    const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid]!;
    return (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

async function resolveNextBaseFee(
    provider: JsonRpcProvider,
    baseFees: readonly string[] | undefined
): Promise<bigint> {
    if (baseFees && baseFees.length > 0) {
        const last = baseFees[baseFees.length - 1]!;
        const v = BigInt(last);
        if (v > 0n) return v;
    }
    try {
        const block = await provider.getBlock('latest');
        if (block?.baseFeePerGas && block.baseFeePerGas > 0n) return block.baseFeePerGas;
    } catch {
        /* fall through */
    }
    return parseUnits('1', 'gwei');
}

/**
 * Estimate live network gas for a network tier.
 * LOW: maxFee = nextBase + tip. MARKET/FAST: nextBase * headroom + tip.
 */
export async function estimateNetworkGas(
    provider: JsonRpcProvider,
    tier: NetworkGasTier
): Promise<NetworkGasEstimate> {
    const floor = minPriorityFloorWei();
    const percentile = TIER_PERCENTILE[tier];

    try {
        const history = (await provider.send('eth_feeHistory', [
            FEE_HISTORY_BLOCKS,
            'latest',
            [percentile],
        ])) as {
            baseFeePerGas?: string[];
            reward?: string[][];
        };

        const nextBaseFee = await resolveNextBaseFee(provider, history.baseFeePerGas);
        const rewardColumn = (history.reward ?? [])
            .map(row => (row?.[0] != null ? BigInt(row[0]) : null))
            .filter((v): v is bigint => v != null && v >= 0n);

        const tip = median(rewardColumn);
        const priority = tip > floor ? tip : floor > 0n ? floor : staticTierFloorWei(tier);
        const headroomMult = maxFeeHeadroomMultiplier(tier);
        const maxFee = nextBaseFee * headroomMult + priority;

        return {
            baseFeeWei: nextBaseFee,
            maxPriorityFeePerGasWei: priority,
            maxFeePerGasWei: maxFee,
        };
    } catch {
        return fallbackEstimate(provider, tier, floor);
    }
}

async function fallbackEstimate(
    provider: JsonRpcProvider,
    tier: NetworkGasTier,
    floor: bigint
): Promise<NetworkGasEstimate> {
    const baseFee = await resolveNextBaseFee(provider, undefined);
    const priority = maxBig(staticTierFloorWei(tier), floor);
    const headroomMult = maxFeeHeadroomMultiplier(tier);
    return {
        baseFeeWei: baseFee,
        maxPriorityFeePerGasWei: priority,
        maxFeePerGasWei: baseFee * headroomMult + priority,
    };
}

function maxBig(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
}

export function networkTierForBotTier(tierId: string): NetworkGasTier | null {
    const id = (tierId || '').toLowerCase();
    if (id === 'normal' || id === 'low' || id === 'lowest') return 'LOW';
    if (id === 'market') return 'MARKET';
    if (id === 'fast' || id === 'high') return 'FAST';
    return null;
}
