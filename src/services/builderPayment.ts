/**
 * Builder payment — EIP-1559 priority boost only (v1).
 *
 * See docs/BUNDLE_MECHANICS_SPEC.md. We do NOT emit fake "coinbase tip" EOA txs.
 */

import { parseUnits, type JsonRpcProvider } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { capBuilderTipWei } from '../utils/inclusionMode';
import type { WalletExecutionPlan } from '../types/copyMint';

export interface BoostedGasFees {
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    /** Estimated priority component paid if tx executes at gasLimit */
    estimatedPrioritySpendWei: bigint;
}

/**
 * Apply a priority-fee budget (wei) across a mint tx's gas limit.
 * Distributes boost as additional maxPriorityFeePerGas, capped by maxFeePerGas.
 */
export function applyPriorityBoostToPlan(
    plan: Pick<WalletExecutionPlan, 'gasLimit' | 'maxFeePerGas' | 'maxPriorityFeePerGas'>,
    priorityBoostWei: bigint
): BoostedGasFees {
    const boost = capBuilderTipWei(priorityBoostWei);
    if (boost <= 0n || plan.gasLimit <= 0n) {
        return {
            maxFeePerGas: plan.maxFeePerGas,
            maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
            estimatedPrioritySpendWei: plan.maxPriorityFeePerGas * plan.gasLimit,
        };
    }

    const extraPriorityPerGas = boost / plan.gasLimit;
    let maxPriority = plan.maxPriorityFeePerGas + extraPriorityPerGas;
    let maxFee = plan.maxFeePerGas;
    if (maxPriority > maxFee) {
        maxFee = maxPriority;
    }

    return {
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: maxPriority,
        estimatedPrioritySpendWei: maxPriority * plan.gasLimit,
    };
}

export function defaultPriorityBoostWei(): bigint {
    const cfg = getRuntimeConfig();
    return parseUnits(String(cfg.builderDefaultTipEth), 'ether');
}

/** @deprecated Name kept for env MAX_BUILDER_TIP_ETH — this is priority boost budget, not coinbase transfer */
export function priorityBoostWeiFromEth(eth: number): bigint {
    if (eth <= 0) return 0n;
    return capBuilderTipWei(parseUnits(eth.toFixed(9).replace(/\.?0+$/, ''), 'ether'));
}

export async function getChainId(provider: JsonRpcProvider): Promise<bigint> {
    const network = await provider.getNetwork();
    return network.chainId;
}
