/**
 * Drop reverting wallets from a bundle and retry simulation (Bundle v2).
 * See docs/BUNDLE_MECHANICS_SPEC.md — partial-bundle regen.
 */

import type { WalletExecutionPlan } from '../types/copyMint';

/** Parse `tx[2]: ...` from Flashbots eth_callBundle errors. */
export function parseFailedBundleTxIndex(error?: string): number | null {
    if (!error) return null;
    const m = error.match(/tx\[(\d+)\]/i);
    if (!m) return null;
    const idx = parseInt(m[1], 10);
    return Number.isNaN(idx) ? null : idx;
}

export function dropPlanAtIndex(
    plans: WalletExecutionPlan[],
    failedIndex: number
): { kept: WalletExecutionPlan[]; dropped: WalletExecutionPlan | null } {
    if (failedIndex < 0 || failedIndex >= plans.length) {
        return { kept: plans, dropped: null };
    }
    const dropped = plans[failedIndex]!;
    const kept = plans.filter((_, i) => i !== failedIndex);
    return { kept, dropped };
}

/** Map simulation tx index to mint plan index (tip tx is always last when present). */
export function simulationIndexToPlanIndex(
    simIndex: number,
    planCount: number,
    hasCoinbaseTip: boolean
): number | null {
    if (simIndex < 0) return null;
    if (hasCoinbaseTip && simIndex >= planCount) return null;
    if (simIndex >= planCount) return null;
    return simIndex;
}
