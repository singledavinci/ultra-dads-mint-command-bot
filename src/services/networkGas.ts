/**
 * Live network gas — MintDash-aligned feeHistory tiers.
 * Network (`normal`): P10 tip, maxFee = nextBase + tip (no ×1.15).
 * Competitive (fcfs*): fixed tip floors + base*2 headroom (inclusion may raise further).
 */

import { FeeData, formatUnits, JsonRpcProvider, parseUnits } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { getCachedFeeData } from './rpcLimiter';
import {
    estimateNetworkGas,
    networkTierForBotTier,
    type NetworkGasEstimate,
} from './networkFeeEstimate';

export interface LiveNetworkFees {
    feeData: FeeData;
    /** Next-block base fee (not maxFee). */
    baseMaxFee: bigint;
    basePriorityFee: bigint;
    baseMaxFeeGwei: number;
    basePriorityFeeGwei: number;
}

export interface GasTierFees {
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    maxFeeGwei: number;
    priorityGwei: number;
    overdrive: boolean;
    gasBribeGwei: string;
    baseFeeWei: bigint;
    isNetworkTier: boolean;
}

/** Competitive tip floors (gwei) — MintDash FCFS_8 / FCFS_15 / Sniper style. */
const COMPETITIVE_TIP_FLOOR_GWEI: Record<string, number> = {
    fcfs: 3,
    fcfs_plus: 8,
    fcfs_max: 15,
    overdrive: 30,
};

export const GAS_TIER_DEFS = [
    {
        id: 'normal',
        label: '🐢 Normal',
        hint: 'Live network (feeHistory P10) — no buffer',
        bribeGwei: 0,
        builderTipEth: 0,
        overdrive: false,
        maxBumpGwei: 0,
        priBumpGwei: 0,
    },
    {
        id: 'fcfs',
        label: '⚡ FCFS +3',
        hint: '3 gwei tip floor — light snipe',
        bribeGwei: 3,
        builderTipEth: 0,
        overdrive: false,
        maxBumpGwei: 0,
        priBumpGwei: 0,
    },
    {
        id: 'fcfs_plus',
        label: '🔥 FCFS +8',
        hint: '8 gwei tip floor + Direct RPC',
        bribeGwei: 8,
        builderTipEth: 0.004,
        overdrive: false,
        maxBumpGwei: 0,
        priBumpGwei: 0,
    },
    {
        id: 'fcfs_max',
        label: '🚀 FCFS +15',
        hint: '15 gwei tip floor + Direct RPC',
        bribeGwei: 15,
        builderTipEth: 0.008,
        overdrive: false,
        maxBumpGwei: 0,
        priBumpGwei: 0,
    },
    {
        id: 'overdrive',
        label: '💥 Sniper',
        hint: '30 gwei tip floor + competitive headroom',
        bribeGwei: 30,
        builderTipEth: 0.015,
        overdrive: true,
        maxBumpGwei: 0,
        priBumpGwei: 0,
    },
] as const;

export type GasTierId = (typeof GAS_TIER_DEFS)[number]['id'];

function gweiFromWei(wei: bigint): number {
    return parseFloat(formatUnits(wei, 'gwei'));
}

function applyCaps(maxFee: bigint, priority: bigint, overdrive: boolean): { maxFee: bigint; priority: bigint } {
    const cfg = getRuntimeConfig();
    const capMax = parseUnits(String(overdrive ? cfg.overdriveMaxFeeGwei : cfg.maxFeeGwei), 'gwei');
    const capPri = parseUnits(
        String(overdrive ? cfg.overdrivePriorityFeeGwei : cfg.maxPriorityFeeGwei),
        'gwei'
    );
    let mf = maxFee > capMax ? capMax : maxFee;
    let mp = priority > capPri ? capPri : priority;
    if (mp > mf) mp = mf;
    return { maxFee: mf, priority: mp };
}

/**
 * Live fees for UI: next-block base + MARKET tip (P50).
 * baseMaxFee here is the base fee (not maxFeePerGas) for clearer advisor labels.
 */
export async function resolveLiveNetworkFees(provider: JsonRpcProvider): Promise<LiveNetworkFees> {
    let feeData: FeeData;
    try {
        feeData = await getCachedFeeData(provider);
    } catch {
        feeData = new FeeData(null, null, null);
    }

    try {
        const est = await estimateNetworkGas(provider, 'MARKET');
        return {
            feeData,
            baseMaxFee: est.baseFeeWei,
            basePriorityFee: est.maxPriorityFeePerGasWei,
            baseMaxFeeGwei: gweiFromWei(est.baseFeeWei),
            basePriorityFeeGwei: gweiFromWei(est.maxPriorityFeePerGasWei),
        };
    } catch {
        /* fall through */
    }

    let base = feeData.maxFeePerGas ?? feeData.gasPrice ?? parseUnits('1', 'gwei');
    let tip = feeData.maxPriorityFeePerGas ?? parseUnits('0.05', 'gwei');
    try {
        const block = await provider.getBlock('latest');
        if (block?.baseFeePerGas && block.baseFeePerGas > 0n) base = block.baseFeePerGas;
    } catch {
        /* keep */
    }
    if (tip > base * 2n) tip = base / 10n > 0n ? base / 10n : tip;

    return {
        feeData,
        baseMaxFee: base,
        basePriorityFee: tip,
        baseMaxFeeGwei: gweiFromWei(base),
        basePriorityFeeGwei: gweiFromWei(tip),
    };
}

function fromEstimate(est: NetworkGasEstimate, overdrive: boolean, bribeGwei: number, isNetwork: boolean): GasTierFees {
    const capped = applyCaps(est.maxFeePerGasWei, est.maxPriorityFeePerGasWei, overdrive);
    return {
        maxFeePerGas: capped.maxFee,
        maxPriorityFeePerGas: capped.priority,
        maxFeeGwei: gweiFromWei(capped.maxFee),
        priorityGwei: gweiFromWei(capped.priority),
        overdrive,
        gasBribeGwei: String(bribeGwei),
        baseFeeWei: est.baseFeeWei,
        isNetworkTier: isNetwork,
    };
}

/**
 * Async tier fees (preferred). Network tiers use feeHistory; competitive use tip floors.
 */
export async function computeGasFeesForTierAsync(
    provider: JsonRpcProvider,
    tierId: string
): Promise<GasTierFees | null> {
    const def = GAS_TIER_DEFS.find(t => t.id === tierId);
    if (!def) return null;

    const networkTier = networkTierForBotTier(tierId);
    if (networkTier) {
        const est = await estimateNetworkGas(provider, networkTier);
        return fromEstimate(est, false, 0, true);
    }

    // Competitive: MARKET base + fixed tip floor (no ×1.15, no stacked bribes).
    const market = await estimateNetworkGas(provider, 'MARKET');
    const tipFloorGwei = COMPETITIVE_TIP_FLOOR_GWEI[tierId] ?? def.bribeGwei;
    const tipFloor = parseUnits(String(tipFloorGwei), 'gwei');
    let priority = tipFloor > market.maxPriorityFeePerGasWei ? tipFloor : market.maxPriorityFeePerGasWei;
    // Prefer the competitive floor when it's the defining trait of the tier.
    priority = tipFloor;
    let maxFee = market.baseFeeWei * 2n + priority;
    const capped = applyCaps(maxFee, priority, def.overdrive);
    return {
        maxFeePerGas: capped.maxFee,
        maxPriorityFeePerGas: capped.priority,
        maxFeeGwei: gweiFromWei(capped.maxFee),
        priorityGwei: gweiFromWei(capped.priority),
        overdrive: def.overdrive,
        gasBribeGwei: String(tipFloorGwei),
        baseFeeWei: market.baseFeeWei,
        isNetworkTier: false,
    };
}

/**
 * Sync helper for tests / when live base+tip already resolved.
 * Network: maxFee = base + tip (no multiplier). Competitive: tip floor + base*2.
 */
export function computeGasFeesForTier(
    live: Pick<LiveNetworkFees, 'baseMaxFee' | 'basePriorityFee'>,
    tierId: string
): GasTierFees | null {
    const def = GAS_TIER_DEFS.find(t => t.id === tierId);
    if (!def) return null;

    const networkTier = networkTierForBotTier(tierId);
    if (networkTier) {
        // live.baseMaxFee is next-block base; tip from live.basePriorityFee (caller should use P10 for normal).
        const tip = live.basePriorityFee > 0n ? live.basePriorityFee : parseUnits('0.01', 'gwei');
        const maxFee = live.baseMaxFee + tip; // LOW-style 1× headroom
        const capped = applyCaps(maxFee, tip, false);
        return {
            maxFeePerGas: capped.maxFee,
            maxPriorityFeePerGas: capped.priority,
            maxFeeGwei: gweiFromWei(capped.maxFee),
            priorityGwei: gweiFromWei(capped.priority),
            overdrive: false,
            gasBribeGwei: '0',
            baseFeeWei: live.baseMaxFee,
            isNetworkTier: true,
        };
    }

    const tipFloorGwei = COMPETITIVE_TIP_FLOOR_GWEI[tierId] ?? def.bribeGwei;
    const priority = parseUnits(String(tipFloorGwei), 'gwei');
    const maxFee = live.baseMaxFee * 2n + priority;
    const capped = applyCaps(maxFee, priority, def.overdrive);
    return {
        maxFeePerGas: capped.maxFee,
        maxPriorityFeePerGas: capped.priority,
        maxFeeGwei: gweiFromWei(capped.maxFee),
        priorityGwei: gweiFromWei(capped.priority),
        overdrive: def.overdrive,
        gasBribeGwei: String(tipFloorGwei),
        baseFeeWei: live.baseMaxFee,
        isNetworkTier: false,
    };
}
