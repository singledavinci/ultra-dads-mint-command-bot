/**
 * Live network gas — shared by gas advisor UI and execution (GasPlanner).
 * Avoids hardcoded gwei fallbacks when the chain reports current fees.
 */

import { FeeData, formatUnits, JsonRpcProvider, parseUnits } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { getCachedFeeData } from './rpcLimiter';

export interface LiveNetworkFees {
    feeData: FeeData;
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
}

export const GAS_TIER_DEFS = [
    {
        id: 'normal',
        label: '🐢 Normal',
        hint: 'Network ×1.15 — OK for low competition',
        bribeGwei: 0,
        builderTipEth: 0,
        overdrive: false,
        maxBumpGwei: 0,
        priBumpGwei: 0,
    },
    {
        id: 'fcfs',
        label: '⚡ FCFS +3',
        hint: '+3 gwei priority — light snipe (public mempool)',
        bribeGwei: 3,
        builderTipEth: 0,
        overdrive: false,
        maxBumpGwei: 3,
        priBumpGwei: 3,
    },
    {
        id: 'fcfs_plus',
        label: '🔥 FCFS +8',
        hint: '+8 gwei + ~0.004 ETH priority boost (bundle)',
        bribeGwei: 8,
        builderTipEth: 0.004,
        overdrive: false,
        maxBumpGwei: 8,
        priBumpGwei: 8,
    },
    {
        id: 'fcfs_max',
        label: '🚀 FCFS +15',
        hint: '+15 gwei + ~0.008 ETH priority boost (bundle)',
        bribeGwei: 15,
        builderTipEth: 0.008,
        overdrive: false,
        maxBumpGwei: 15,
        priBumpGwei: 15,
    },
    {
        id: 'overdrive',
        label: '💥 Sniper',
        hint: 'Overdrive caps + ~0.015 ETH priority boost (bundle)',
        bribeGwei: 15,
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

/** Read current block fees; use fee history only when the node omits EIP-1559 fields. */
export async function resolveLiveNetworkFees(provider: JsonRpcProvider): Promise<LiveNetworkFees> {
    const feeData = await getCachedFeeData(provider);
    let baseMax = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    let basePri = feeData.maxPriorityFeePerGas ?? 0n;

    if (!baseMax || baseMax <= 0n) {
        try {
            const block = await provider.getBlock('latest');
            const baseFee = block?.baseFeePerGas ?? 0n;
            if (baseFee > 0n) {
                basePri = basePri > 0n ? basePri : parseUnits('0.1', 'gwei');
                baseMax = baseFee * 2n + basePri;
            }
        } catch {
            /* try fee history */
        }
    }

    if (!baseMax || baseMax <= 0n) {
        try {
            const hist = (await provider.send('eth_feeHistory', [
                4,
                'latest',
                [50],
            ])) as {
                baseFeePerGas?: string[];
                reward?: string[][];
            };
            const bases = hist?.baseFeePerGas || [];
            const rewards = hist?.reward || [];
            const baseFee = bases.length ? BigInt(bases[bases.length - 1]) : 0n;
            const tip =
                rewards.length && rewards[rewards.length - 1]?.[0]
                    ? BigInt(rewards[rewards.length - 1][0])
                    : parseUnits('0.1', 'gwei');
            if (baseFee > 0n) {
                basePri = tip;
                baseMax = baseFee * 2n + tip;
            }
        } catch {
            /* last resort below */
        }
    }

    if (!baseMax || baseMax <= 0n) {
        baseMax = parseUnits('1', 'gwei');
    }
    if (!basePri || basePri <= 0n) {
        basePri = baseMax / 20n > 0n ? baseMax / 20n : parseUnits('0.05', 'gwei');
    }
    if (basePri > baseMax) basePri = baseMax;

    return {
        feeData,
        baseMaxFee: baseMax,
        basePriorityFee: basePri,
        baseMaxFeeGwei: gweiFromWei(baseMax),
        basePriorityFeeGwei: gweiFromWei(basePri),
    };
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

/** Apply a gas-advisor tier to live network base fees (same math as the /mint picker). */
export function computeGasFeesForTier(
    live: Pick<LiveNetworkFees, 'baseMaxFee' | 'basePriorityFee'>,
    tierId: string
): GasTierFees | null {
    const def = GAS_TIER_DEFS.find(t => t.id === tierId);
    if (!def) return null;

    const cfg = getRuntimeConfig();
    let maxFee = live.baseMaxFee;
    let priority = live.basePriorityFee;

    if (def.overdrive) {
        maxFee = (maxFee * 400n) / 100n;
        priority = (priority * 150n) / 100n;
    } else {
        maxFee = (maxFee * BigInt(Math.round(cfg.normalGasMultiplier * 100))) / 100n;
        priority = (priority * BigInt(Math.round(cfg.normalGasMultiplier * 100))) / 100n;
    }

    if (def.maxBumpGwei > 0) {
        maxFee += parseUnits(String(def.maxBumpGwei), 'gwei');
    }
    if (def.priBumpGwei > 0) {
        priority += parseUnits(String(def.priBumpGwei), 'gwei');
    }
    if (def.bribeGwei > 0) {
        const bribe = parseUnits(String(def.bribeGwei), 'gwei');
        priority += bribe;
        maxFee += bribe;
    }

    const capped = applyCaps(maxFee, priority, def.overdrive);
    maxFee = capped.maxFee;
    priority = capped.priority;

    return {
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priority,
        maxFeeGwei: gweiFromWei(maxFee),
        priorityGwei: gweiFromWei(priority),
        overdrive: def.overdrive,
        gasBribeGwei: String(def.bribeGwei),
    };
}
