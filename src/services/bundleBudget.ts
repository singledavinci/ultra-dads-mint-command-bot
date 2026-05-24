/**
 * Hard budget enforcement for builder bundle runs.
 */

import { formatEther } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { coinbaseTipWei } from './coinbaseTipTx';
import { applyPriorityBoostToPlan, type BoostedGasFees } from './builderPayment';
import type { WalletExecutionPlan } from '../types/copyMint';

export interface BundleBudgetInput {
    plans: WalletExecutionPlan[];
    priorityBoostWei: bigint;
}

export interface BundleBudgetResult {
    ok: boolean;
    error?: string;
    totalEthAtRisk?: number;
    perWalletBoostWei?: bigint;
}

export function validateBundleBudget(input: BundleBudgetInput): BundleBudgetResult {
    const cfg = getRuntimeConfig();
    const broadcastable = input.plans.filter(p => p.canBroadcast);

    if (broadcastable.length === 0) {
        return { ok: false, error: 'No broadcastable wallets' };
    }

    if (broadcastable.length > cfg.builderMaxTxsPerBundle) {
        return {
            ok: false,
            error: `Wallet count ${broadcastable.length} exceeds BUILDER_MAX_TXS_PER_BUNDLE (${cfg.builderMaxTxsPerBundle})`,
        };
    }

    const boostPerWallet = input.priorityBoostWei;
    const maxBoost = BigInt(Math.floor(cfg.maxBuilderTipEth * 1e18));
    if (boostPerWallet > maxBoost) {
        return {
            ok: false,
            error: `Priority boost exceeds MAX_BUILDER_TIP_ETH (${cfg.maxBuilderTipEth})`,
        };
    }

    let totalWei = 0n;
    for (const plan of broadcastable) {
        const mintWei = BigInt(plan.value || '0');
        const boosted = applyPriorityBoostToPlan(plan, boostPerWallet);
        const gasMax = boosted.maxFeePerGas * plan.gasLimit;
        totalWei += mintWei + gasMax;
    }
    const tipWei = coinbaseTipWei();
    if (tipWei > 0n) {
        totalWei += tipWei + 55_000n * (broadcastable[0]?.maxFeePerGas ?? 30_000_000_000n);
    }

    const totalEth = parseFloat(formatEther(totalWei));
    if (totalEth > cfg.maxTotalBundleEth) {
        return {
            ok: false,
            error: `Total at-risk ${totalEth.toFixed(4)} ETH exceeds MAX_TOTAL_BUNDLE_ETH (${cfg.maxTotalBundleEth})`,
            totalEthAtRisk: totalEth,
        };
    }

    const maxMintWei = BigInt(Math.floor(cfg.maxMintEth * 1e18));
    for (const plan of broadcastable) {
        const mintWei = BigInt(plan.value || '0');
        if (mintWei > maxMintWei) {
            return {
                ok: false,
                error: `Mint value exceeds MAX_MINT_ETH (${cfg.maxMintEth}) for ${plan.maskedWalletAddress}`,
            };
        }
    }

    return { ok: true, totalEthAtRisk: totalEth, perWalletBoostWei: boostPerWallet };
}

export function boostedFeesForPlan(
    plan: WalletExecutionPlan,
    priorityBoostWei: bigint
): BoostedGasFees {
    return applyPriorityBoostToPlan(plan, priorityBoostWei);
}
