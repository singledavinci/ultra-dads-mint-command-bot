import type { JsonRpcProvider } from 'ethers';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { validateBundleBudget } from '../../services/bundleBudget';
import { defaultPriorityBoostWei } from '../../services/builderPayment';
import { defaultBundleReceiptBuilder, runBundleSubmitLoop } from './bundleSubmitLoop';
import type { WalletExecutionPlan, WalletReceipt } from '../../types/copyMint';
import type { InclusionBroadcastOptions, InclusionMode } from '../../types/inclusion';
import { inclusionMetrics } from './inclusionMetrics';
import {
    capBuilderTipWei,
    isBuilderMode,
    resolveInclusionMode,
    supportsRpcBlast,
} from '../../utils/inclusionMode';
import { resetNonce } from '../NonceManager';
import { FlashbotsBuilder } from './builders/FlashbotsBuilder';
import { TitanBuilder } from './builders/TitanBuilder';
import type { BuilderAdapter } from './builders/BuilderAdapter';
import { MevBlockerAdapter } from './MevBlockerAdapter';
import { FlashbotsProtectAdapter } from './FlashbotsProtectAdapter';
import { PublicBroadcastAdapter } from './PublicBroadcastAdapter';

export class InclusionRouter {
    static getMetrics() {
        return { ...inclusionMetrics };
    }

    static async broadcastPlan(
        provider: JsonRpcProvider,
        plan: WalletExecutionPlan,
        opts?: InclusionBroadcastOptions
    ): Promise<WalletReceipt> {
        const mode = resolveInclusionMode(opts);

        if (!plan.canBroadcast) {
            return skipReceipt(plan, plan.skipReason);
        }

        if (mode === 'delegation') {
            return skipReceipt(
                plan,
                'Delegation batch is not available on the Telegram bot yet — use MintDash DELEGATION_CONTRACT or Direct RPC blast.'
            );
        }

        if (isBuilderMode(mode)) {
            const cfg = getRuntimeConfig();
            if (!cfg.builderMintEnabled) {
                return skipReceipt(plan, 'Builder mint disabled (BUILDER_MINT_ENABLED=false)');
            }
            return InclusionRouter.broadcastBuilderSingle(provider, plan, mode, opts);
        }

        if (mode === 'protected') {
            inclusionMetrics.protectedBroadcasts++;
            return MevBlockerAdapter.broadcast(provider, plan);
        }

        if (mode === 'private_rpc') {
            inclusionMetrics.privateRpcBroadcasts++;
            return FlashbotsProtectAdapter.broadcast(provider, plan);
        }

        if (mode === 'private_rpc_direct') {
            inclusionMetrics.directRpcBlasts++;
            return PublicBroadcastAdapter.broadcast(provider, plan, {
                blast: true,
                blastRpcUrls: opts?.blastRpcUrls,
            });
        }

        inclusionMetrics.publicBroadcasts++;
        const cfg = getRuntimeConfig();
        return PublicBroadcastAdapter.broadcast(provider, plan, {
            blast: supportsRpcBlast(mode) && cfg.broadcastToMultipleRpcs,
            blastRpcUrls: opts?.blastRpcUrls,
        });
    }

    static async broadcastBundle(
        provider: JsonRpcProvider,
        plans: WalletExecutionPlan[],
        opts?: InclusionBroadcastOptions
    ): Promise<WalletReceipt[]> {
        const mode = resolveInclusionMode(opts);
        const broadcastable = plans.filter(p => p.canBroadcast);

        // Non-builder OR nothing to send: fan out per plan WITHOUT re-entering builder
        // recursion (broadcastPlan → broadcastBuilderSingle → broadcastBundle).
        if (!isBuilderMode(mode) || broadcastable.length === 0) {
            if (isBuilderMode(mode) && broadcastable.length === 0) {
                return plans.map(p =>
                    skipReceipt(p, p.skipReason || 'No broadcastable wallets for builder bundle')
                );
            }
            const receipts: WalletReceipt[] = [];
            for (const plan of plans) {
                receipts.push(await InclusionRouter.broadcastPlan(provider, plan, opts));
            }
            return receipts;
        }

        const cfg = getRuntimeConfig();
        if (!cfg.builderMintEnabled) {
            return plans.map(p => skipReceipt(p, 'Builder mint disabled'));
        }

        const priorityBoost = capBuilderTipWei(opts?.builderTipWei ?? defaultPriorityBoostWei());
        const budget = validateBundleBudget({ plans: broadcastable, priorityBoostWei: priorityBoost });
        if (!budget.ok) {
            InclusionRouter.resetNoncesForPlans(broadcastable);
            return plans.map(p =>
                p.canBroadcast
                    ? failReceipt(p, budget.error || 'Budget exceeded', 'max_cap')
                    : skipReceipt(p, p.skipReason)
            );
        }

        const head = await provider.getBlockNumber();
        const window = cfg.builderMaxTargetBlocks;
        let lastError = 'Bundle submit failed';
        const builder = InclusionRouter.pickBuilder(mode);
        const receiptBuilder = defaultBundleReceiptBuilder(plans, `${builder.name}@block`);

        for (let offset = 1; offset <= window; offset++) {
            const targetBlock = opts?.targetBlock ?? head + offset;

            const loop = await runBundleSubmitLoop({
                provider,
                allPlans: plans,
                broadcastable,
                builder,
                priorityBoost,
                targetBlock,
                partialRegenEnabled: cfg.builderPartialBundleRegen,
                submit: (b, spec) => InclusionRouter.submitRelayOnly(b, spec, mode),
                buildReceipt: (spec, active, hash, block, dropped, startMs) =>
                    receiptBuilder(spec, active, hash, block, dropped, startMs).map(r => ({
                        ...r,
                        rpcUsed: `${builder.name}@block${block}`,
                    })),
            });

            if (loop.ok && loop.receipts) {
                inclusionMetrics.bundlesSubmitted++;
                inclusionMetrics.lastBundleHash = loop.bundleHash;
                return loop.receipts;
            }

            lastError = loop.error || lastError;
            if (loop.droppedWallets.length > 0 && !cfg.builderPartialBundleRegen) {
                break;
            }
        }

        inclusionMetrics.lastError = lastError;
        InclusionRouter.resetNoncesForPlans(broadcastable);

        // Auth/signature failures are configuration bugs — never burn the fire on a dead relay.
        // Fall back to Direct RPC blast so FCFS / link mints still land.
        const relayFail =
            /invalid flashbots signature|unauthorized|flashbots.?auth|invalid signature|block not found/i.test(
                lastError
            );
        if (relayFail || cfg.builderAllowPublicFallback) {
            const via = relayFail ? 'private_rpc_direct' : 'public';
            inclusionMetrics.lastError = `${lastError} — falling back to ${via}`;
            inclusionMetrics.directRpcBlasts += relayFail ? broadcastable.length : 0;
            const receipts: WalletReceipt[] = [];
            for (const plan of plans) {
                if (!plan.canBroadcast) {
                    receipts.push(skipReceipt(plan, plan.skipReason));
                    continue;
                }
                receipts.push(
                    await PublicBroadcastAdapter.broadcast(provider, plan, {
                        blast: relayFail,
                        blastRpcUrls: opts?.blastRpcUrls,
                    })
                );
            }
            return receipts;
        }

        return plans.map(p =>
            p.canBroadcast
                ? failReceipt(p, lastError.slice(0, 200), 'other')
                : skipReceipt(p, p.skipReason)
        );
    }

    private static async broadcastBuilderSingle(
        provider: JsonRpcProvider,
        plan: WalletExecutionPlan,
        mode: InclusionMode,
        opts?: InclusionBroadcastOptions
    ): Promise<WalletReceipt> {
        const receipts = await InclusionRouter.broadcastBundle(provider, [plan], {
            ...opts,
            inclusionMode: mode,
        });
        return receipts[0]!;
    }

    private static pickBuilder(mode: InclusionMode): BuilderAdapter {
        if (mode === 'builder_titan') {
            const titan = new TitanBuilder();
            if (getRuntimeConfig().titanRelayUrl) return titan;
        }
        return new FlashbotsBuilder();
    }

    /** Relay-only fallback — never public mempool unless BUILDER_ALLOW_PUBLIC_FALLBACK. */
    private static async submitRelayOnly(
        primary: BuilderAdapter,
        spec: import('../../types/inclusion').BundleSpec,
        mode: InclusionMode
    ) {
        try {
            return await primary.sendBundle(spec);
        } catch (primaryErr) {
            const cfg = getRuntimeConfig();
            if (
                cfg.builderSecondaryRelayFallback &&
                mode === 'builder_flashbots' &&
                cfg.titanRelayUrl
            ) {
                return await new TitanBuilder().sendBundle(spec);
            }
            throw primaryErr;
        }
    }

    private static resetNoncesForPlans(plans: WalletExecutionPlan[]): void {
        for (const p of plans) {
            resetNonce(p.walletAddress);
        }
    }
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

function failReceipt(
    plan: WalletExecutionPlan,
    message: string,
    category: WalletReceipt['errorCategory']
): WalletReceipt {
    return {
        walletIndex: plan.walletIndex,
        maskedWalletAddress: plan.maskedWalletAddress,
        status: 'failed',
        value: plan.value,
        gasLimit: plan.gasLimit,
        maxFeePerGas: plan.maxFeePerGas,
        maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
        requiredBalance: plan.requiredBalance,
        balance: plan.balance,
        shortage: plan.shortage,
        errorCategory: category,
        errorMessage: message,
    };
}
