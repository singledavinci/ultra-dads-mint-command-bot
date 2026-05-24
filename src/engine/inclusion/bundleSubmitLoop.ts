/**
 * Builder bundle simulate → optional partial regen → submit.
 */

import type { JsonRpcProvider } from 'ethers';
import { assembleMintBundle, bundleHasCoinbaseTip } from '../../services/bundleAssembler';
import { validateBundleBudget } from '../../services/bundleBudget';
import { lookupMintTxHash } from '../../services/bundleTxHashes';
import {
    dropPlanAtIndex,
    parseFailedBundleTxIndex,
    simulationIndexToPlanIndex,
} from '../../services/partialBundleRegen';
import type { WalletExecutionPlan, WalletReceipt } from '../../types/copyMint';
import type { BuilderAdapter } from './builders/BuilderAdapter';
import { resetNonce } from '../NonceManager';
import { inclusionMetrics } from './inclusionMetrics';

export interface BundleSubmitLoopResult {
    ok: boolean;
    receipts?: WalletReceipt[];
    spec?: Awaited<ReturnType<typeof assembleMintBundle>>;
    bundleHash?: string;
    error?: string;
    droppedWallets: Array<{ address: string; reason: string }>;
}

export async function runBundleSubmitLoop(params: {
    provider: JsonRpcProvider;
    allPlans: WalletExecutionPlan[];
    broadcastable: WalletExecutionPlan[];
    builder: BuilderAdapter;
    priorityBoost: bigint;
    targetBlock: number;
    partialRegenEnabled: boolean;
    submit: (
        builder: BuilderAdapter,
        spec: Awaited<ReturnType<typeof assembleMintBundle>>
    ) => Promise<{ bundleHash: string }>;
    buildReceipt: (
        spec: Awaited<ReturnType<typeof assembleMintBundle>>,
        activePlans: WalletExecutionPlan[],
        bundleHash: string,
        targetBlock: number,
        dropped: Map<string, string>,
        startMs: number
    ) => WalletReceipt[];
}): Promise<BundleSubmitLoopResult> {
    const dropped = new Map<string, string>();
    let activePlans = [...params.broadcastable];

    while (activePlans.length > 0) {
        const budget = validateBundleBudget({
            plans: activePlans,
            priorityBoostWei: params.priorityBoost,
        });
        if (!budget.ok) {
            return {
                ok: false,
                error: budget.error,
                droppedWallets: mapDropped(dropped),
            };
        }

        const spec = await assembleMintBundle({
            provider: params.provider,
            plans: activePlans,
            priorityBoostWei: params.priorityBoost,
            targetBlock: params.targetBlock,
        });
        const hasTip = bundleHasCoinbaseTip(spec);

        const sim = await params.builder.simulateBundle(spec);
        if (!sim.success) {
            const failIdx = parseFailedBundleTxIndex(sim.error);
            const planIdx =
                failIdx !== null
                    ? simulationIndexToPlanIndex(failIdx, activePlans.length, hasTip)
                    : null;

            if (
                params.partialRegenEnabled &&
                activePlans.length > 1 &&
                planIdx !== null
            ) {
                const { kept, dropped: plan } = dropPlanAtIndex(activePlans, planIdx);
                if (plan) {
                    dropped.set(plan.walletAddress, sim.error || 'simulation reverted');
                    resetNonce(plan.walletAddress);
                    inclusionMetrics.bundlesPartialRegen++;
                    activePlans = kept;
                    continue;
                }
            }

            return {
                ok: false,
                error: sim.error || 'Simulation failed',
                droppedWallets: mapDropped(dropped),
            };
        }

        try {
            const submitted = await params.submit(params.builder, spec);
            const start = Date.now();
            const receipts = params.buildReceipt(
                spec,
                activePlans,
                submitted.bundleHash,
                params.targetBlock,
                dropped,
                start
            );
            return {
                ok: true,
                receipts,
                spec,
                bundleHash: submitted.bundleHash,
                droppedWallets: mapDropped(dropped),
            };
        } catch (err: unknown) {
            return {
                ok: false,
                error: (err as Error).message || String(err),
                droppedWallets: mapDropped(dropped),
            };
        }
    }

    return {
        ok: false,
        error: 'All wallets dropped from bundle after simulation failures',
        droppedWallets: mapDropped(dropped),
    };
}

function mapDropped(dropped: Map<string, string>): Array<{ address: string; reason: string }> {
    return [...dropped.entries()].map(([address, reason]) => ({ address, reason }));
}

export function defaultBundleReceiptBuilder(
    allPlans: WalletExecutionPlan[],
    rpcLabel: string
) {
    return (
        spec: Awaited<ReturnType<typeof assembleMintBundle>>,
        activePlans: WalletExecutionPlan[],
        bundleHash: string,
        targetBlock: number,
        dropped: Map<string, string>,
        startMs: number
    ): WalletReceipt[] => {
        const activeSet = new Set(activePlans.map(p => p.walletAddress.toLowerCase()));
        return allPlans.map(p => {
            if (dropped.has(p.walletAddress)) {
                return skipReceipt(
                    p,
                    `Dropped from bundle: ${(dropped.get(p.walletAddress) || '').slice(0, 120)}`
                );
            }
            if (!p.canBroadcast) {
                return skipReceipt(p, p.skipReason);
            }
            if (!activeSet.has(p.walletAddress.toLowerCase())) {
                return skipReceipt(p, 'Excluded from final bundle subset');
            }
            const mintTxHash = lookupMintTxHash(spec, p.walletAddress, p.nonce);
            return {
                walletIndex: p.walletIndex,
                walletAddress: p.walletAddress,
                maskedWalletAddress: p.maskedWalletAddress,
                status: 'submitted' as const,
                bundleHash,
                mintTxHash,
                bundleTargetBlock: targetBlock,
                txHash: mintTxHash ?? bundleHash,
                nonce: p.nonce,
                value: p.value,
                gasLimit: p.gasLimit,
                maxFeePerGas: p.maxFeePerGas,
                maxPriorityFeePerGas: p.maxPriorityFeePerGas,
                requiredBalance: p.requiredBalance,
                balance: p.balance,
                shortage: 0n,
                rpcUsed: rpcLabel,
                timings: { broadcastMs: Date.now() - startMs },
            };
        });
    };
}

function skipReceipt(plan: WalletExecutionPlan, reason?: string): WalletReceipt {
    return {
        walletIndex: plan.walletIndex,
        maskedWalletAddress: plan.maskedWalletAddress,
        status: 'skipped',
        value: plan.value,
        gasLimit: plan.gasLimit,
        maxFeePerGas: plan.maxFeePerGas,
        maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
        requiredBalance: plan.requiredBalance,
        balance: plan.balance,
        shortage: plan.shortage,
        errorCategory: 'other',
        errorMessage: reason,
    };
}
