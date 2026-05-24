import type { JsonRpcProvider } from 'ethers';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { validateBundleBudget } from '../../services/bundleBudget';
import { defaultPriorityBoostWei } from '../../services/builderPayment';
import { defaultBundleReceiptBuilder, runBundleSubmitLoop } from './bundleSubmitLoop';
import type { WalletExecutionPlan, WalletReceipt } from '../../types/copyMint';
import type { InclusionBroadcastOptions, InclusionMode } from '../../types/inclusion';
import { inclusionMetrics } from './inclusionMetrics';
import { capBuilderTipWei, isBuilderMode, resolveInclusionMode } from '../../utils/inclusionMode';
import { resetNonce } from '../NonceManager';
import { FlashbotsBuilder } from './builders/FlashbotsBuilder';
import { TitanBuilder } from './builders/TitanBuilder';
import type { BuilderAdapter } from './builders/BuilderAdapter';
import { MevBlockerAdapter } from './MevBlockerAdapter';
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

        inclusionMetrics.publicBroadcasts++;
        return PublicBroadcastAdapter.broadcast(provider, plan);
    }

    static async broadcastBundle(
        provider: JsonRpcProvider,
        plans: WalletExecutionPlan[],
        opts?: InclusionBroadcastOptions
    ): Promise<WalletReceipt[]> {
        const mode = resolveInclusionMode(opts);
        const broadcastable = plans.filter(p => p.canBroadcast);

        if (!isBuilderMode(mode) || broadcastable.length === 0) {
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

        if (cfg.builderAllowPublicFallback) {
            inclusionMetrics.lastError = `${lastError} — public fallback enabled (risky)`;
            const receipts: WalletReceipt[] = [];
            for (const plan of plans) {
                receipts.push(await PublicBroadcastAdapter.broadcast(provider, plan));
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
