import type { TransactionReceipt } from 'ethers';

export type BundleRunOutcome = 'pending' | 'confirmed' | 'reverted' | 'missed';

/** Classify aggregate outcome from per-wallet on-chain receipts. */
export function resolveBundleRunOutcome(
    mintReceipts: (TransactionReceipt | null)[]
): BundleRunOutcome {
    if (mintReceipts.length === 0) return 'missed';

    let anyFound = false;
    let anyPending = false;
    let anyRevert = false;

    for (const r of mintReceipts) {
        if (!r) continue;
        anyFound = true;
        if (!r.blockNumber) {
            anyPending = true;
            continue;
        }
        if (r.status === 0) anyRevert = true;
    }

    if (!anyFound) return 'missed';
    if (anyPending) return 'pending';
    if (anyRevert) return 'reverted';
    return 'confirmed';
}
