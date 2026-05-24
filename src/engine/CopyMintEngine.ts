import { randomUUID } from 'crypto';
import type { JsonRpcProvider } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { effectiveStreamBroadcast } from '../config/capacityOverrides';
import { DedupeStore } from './DedupeStore';
import { EngineMintClassifier } from './MintClassifier';
import { EnginePaymentDetector } from './PaymentDetector';
import { WalletPreflight } from './WalletPreflight';
import { BroadcastService } from './BroadcastService';
import { ConfirmationMonitor } from './ConfirmationMonitor';
import { BundleInclusionMonitor } from './inclusion/BundleInclusionMonitor';
import { ExecutionQueue } from './ExecutionQueue';
import { ExecutionReporter } from './ExecutionReporter';
import { DetectionEngine } from './DetectionEngine';
import { EngineRpcPool } from './RpcPool';
import type {
    CopyMintEngineOptions,
    CopyMintExecuteInput,
    DetectedMintCandidate,
    EngineStatus,
    ExecutionResult,
    TriggerType,
    WalletExecutionPlan,
    WalletReceipt,
} from '../types/copyMint';
import type { PreflightBuildParams } from './WalletPreflight';
import type { InclusionBroadcastOptions } from '../types/inclusion';
import { isBuilderMode, resolveInclusionMode } from '../utils/inclusionMode';
let lastExecution: ExecutionResult | undefined;
let lastCandidate: DetectedMintCandidate | undefined;
let lastSkipReason: string | undefined;

export class CopyMintEngine {
    static async execute(input: CopyMintExecuteInput): Promise<ExecutionResult> {
        const cfg = getRuntimeConfig();
        const t0 = Date.now();
        const executionId = randomUUID();
        const candidate = input.candidate;
        lastCandidate = candidate;

        if (cfg.useLegacyMintCore) {
            const { batchCopyTrade: legacy } = await import('../utils/mintCore.legacy');
            const legacyResults = await legacy(
                input.privateKeys,
                candidate.to,
                candidate.data,
                input.paymentPlanValue ?? candidate.value,
                input.provider as JsonRpcProvider,
                input.options as any,
                input.options?.whaleAddress
            );
            return CopyMintEngine.wrapLegacy(executionId, input, legacyResults, t0);
        }

        const scopeId = input.options?.uid;

        if (!input.privateKeys?.length) {
            lastSkipReason = 'no_wallets';
            return CopyMintEngine.emptyResult(
                executionId,
                input.triggerType,
                candidate,
                'no_wallets',
                t0,
                undefined,
                undefined,
                input.privateKeys
            );
        }

        const queue = await ExecutionQueue.acquire({
            sourceTxHash: candidate.sourceTxHash,
            contract: candidate.to,
            scopeId,
        });
        if (!queue.ok) {
            lastSkipReason = queue.reason;
            return CopyMintEngine.emptyResult(
                executionId,
                input.triggerType,
                candidate,
                queue.reason || 'queue_blocked',
                t0,
                undefined,
                undefined,
                input.privateKeys
            );
        }

        try {
            if (candidate.sourceTxHash && DedupeStore.checkSourceTx(candidate.sourceTxHash, scopeId)) {
                lastSkipReason = 'duplicate_source_tx';
                return CopyMintEngine.emptyResult(
                    executionId,
                    input.triggerType,
                    candidate,
                    'duplicate_source_tx',
                    t0,
                    undefined,
                    undefined,
                    input.privateKeys
                );
            }

            const tClass = Date.now();
            const skipClassify =
                input.options?.skipClassification ||
                input.triggerType === 'automint' ||
                input.triggerType === 'link';
            const classification = skipClassify
                ? {
                      isLikelyMint: true,
                      confidence: 'medium' as const,
                      mintType: 'custom' as const,
                      methodSelector: candidate.data.slice(0, 10),
                      calldataNeedsWalletRewrite: false,
                      warnings: [],
                  }
                : EngineMintClassifier.classify(candidate);

            if (!classification.isLikelyMint) {
                lastSkipReason = classification.rejectionReason || 'non_mint';
                return CopyMintEngine.emptyResult(
                    executionId,
                    input.triggerType,
                    candidate,
                    classification.rejectionReason || 'non_mint',
                    t0,
                    classification,
                    undefined,
                    input.privateKeys
                );
            }

            const provider = input.provider as JsonRpcProvider;
            const firstWallet = new (await import('ethers')).Wallet(input.privateKeys[0], provider);
            const maxMintEth = parseFloat(input.options?.maxMintLimit || String(cfg.maxMintEth));

            const paymentPlan = await EnginePaymentDetector.detect({
                provider,
                candidate,
                classification,
                executingWallet: firstWallet.address,
                quantity: input.options?.quantity,
                allowUnknown: input.options?.allowUnknownPayment,
                skipSimulation: input.options?.skipSimulation,
                maxMintEth,
                prevalidatedValue:
                    input.options?.paymentPrevalidated && input.paymentPlanValue
                        ? input.paymentPlanValue
                        : undefined,
            });

            if (!paymentPlan.shouldExecute) {
                lastSkipReason = paymentPlan.reason;
                return CopyMintEngine.emptyResult(
                    executionId,
                    input.triggerType,
                    candidate,
                    paymentPlan.reason,
                    t0,
                    classification,
                    paymentPlan,
                    input.privateKeys
                );
            }

            const tPreflight = Date.now();
            const preflightParams = {
                provider,
                privateKeys: input.privateKeys,
                candidate,
                paymentPlan,
                options: input.options,
            };

            const inclusionOpts = CopyMintEngine.inclusionOpts(input.options);
            const inclusionMode = resolveInclusionMode(inclusionOpts);
            const useBundle =
                input.options?.bundleAllWallets &&
                isBuilderMode(inclusionMode);

            const useStream = effectiveStreamBroadcast() && !useBundle;

            let plans: WalletExecutionPlan[];
            const receipts: WalletReceipt[] = [];
            const tBroadcast = Date.now();

            if (useStream) {
                const streamed = await CopyMintEngine.executeStreamedBroadcast(
                    provider,
                    preflightParams,
                    inclusionOpts,
                    cfg.executionConcurrency
                );
                plans = streamed.plans;
                receipts.push(...streamed.receipts);
            } else {
                plans = await WalletPreflight.buildPlans(preflightParams);
                const batchBroadcastable = plans.filter(p => p.canBroadcast);

                if (useBundle && batchBroadcastable.length > 1) {
                    const bundleReceipts = await BroadcastService.broadcastBundle(
                        provider,
                        plans,
                        inclusionOpts
                    );
                    receipts.push(...bundleReceipts);
                } else {
                    await ExecutionQueue.runWithConcurrency(
                        batchBroadcastable,
                        cfg.executionConcurrency,
                        async (plan) => {
                            const receipt = await BroadcastService.broadcastPlan(
                                provider,
                                plan,
                                inclusionOpts
                            );
                            receipt.walletAddress = plan.walletAddress;
                            receipts.push(receipt);
                        }
                    );

                    for (const p of plans.filter(x => !x.canBroadcast)) {
                        receipts.push(await BroadcastService.broadcastPlan(provider, p, inclusionOpts));
                    }
                }
            }

            const broadcastable = plans.filter(p => p.canBroadcast);

            receipts.sort((a, b) => a.walletIndex - b.walletIndex);

            if (candidate.sourceTxHash) {
                DedupeStore.markSourceTx(candidate.sourceTxHash, executionId, scopeId);
            }
            DedupeStore.markExecuted(executionId, candidate.to, candidate.data, paymentPlan.selectedValue);

            const result: ExecutionResult = {
                executionId,
                triggerType: input.triggerType,
                sourceTxHash: candidate.sourceTxHash,
                sourceWallet: candidate.sourceWallet,
                targetContract: candidate.to,
                classification,
                paymentPlan,
                gasSummary: `mode=${cfg.gasMode} | wallets=${broadcastable.length}/${plans.length}`,
                walletCount: plans.length,
                skippedCount: plans.filter(p => !p.canBroadcast).length,
                submittedCount: receipts.filter(r => r.status === 'submitted').length,
                confirmedCount: 0,
                revertedCount: 0,
                timeoutCount: 0,
                failedCount: receipts.filter(r => r.status === 'failed').length,
                duplicateSkippedCount: 0,
                totalValueAttempted: paymentPlan.selectedValue,
                totalGasEstimated: '0',
                detectionLatencyMs: tClass - t0,
                classificationLatencyMs: tPreflight - tClass,
                preflightLatencyMs: tBroadcast - tPreflight,
                broadcastLatencyMs: Date.now() - tBroadcast,
                confirmationLatencyMs: 0,
                receipts,
                errorsByCategory: CopyMintEngine.countErrors(receipts),
                createdAt: Date.now(),
                legacyResults: CopyMintEngine.toLegacyResults(receipts, input.options?.uid),
            };

            lastExecution = result;

            // Non-blocking confirmation (public txs vs builder bundles)
            void CopyMintEngine.monitorConfirmations(provider, receipts).then(stats => {
                result.confirmedCount = stats.confirmed;
                result.revertedCount = stats.reverted;
                result.timeoutCount = stats.timeout;
            });

            return result;
        } finally {
            ExecutionQueue.release();
        }
    }

    static handleDetectedMint(candidate: DetectedMintCandidate, privateKeys: string[], provider: JsonRpcProvider, options?: CopyMintEngineOptions) {
        return CopyMintEngine.execute({
            triggerType: 'automint',
            provider,
            privateKeys,
            candidate,
            options,
        });
    }

    static executeManualMint(params: Omit<CopyMintExecuteInput, 'triggerType'>) {
        return CopyMintEngine.execute({ ...params, triggerType: 'manual' });
    }

    static executeLinkMint(params: Omit<CopyMintExecuteInput, 'triggerType'>) {
        return CopyMintEngine.execute({
            ...params,
            triggerType: 'link',
            candidate: { ...params.candidate, detectionSource: 'link' },
        });
    }

    static executeScheduledMint(params: Omit<CopyMintExecuteInput, 'triggerType'>) {
        return CopyMintEngine.execute({
            ...params,
            triggerType: 'scheduled',
            candidate: { ...params.candidate, detectionSource: 'scheduled' },
        });
    }

    static async previewMint(params: CopyMintExecuteInput): Promise<ExecutionResult> {
        return CopyMintEngine.execute({
            ...params,
            triggerType: 'preview',
            privateKeys: params.privateKeys.slice(0, 1),
            options: { ...params.options, skipSimulation: false },
        });
    }

    static pause(): void {
        ExecutionQueue.pause();
    }

    static resume(): void {
        ExecutionQueue.resume();
    }

    static panic(): void {
        ExecutionQueue.panic();
    }

    static getStatus(): EngineStatus {
        return {
            paused: ExecutionQueue.isSoftPaused(),
            panic: ExecutionQueue.isPanic(),
            lastExecution,
            lastCandidate,
            lastSkipReason,
            queueDepth: ExecutionQueue.depth(),
            dedupeSize: DedupeStore.size(),
            rpcHealth: EngineRpcPool.getHealth(),
        };
    }

    static getLastSkipReason(): string | undefined {
        return lastSkipReason;
    }

    private static countErrors(receipts: WalletReceipt[]) {
        const m: ExecutionResult['errorsByCategory'] = {};
        for (const r of receipts) {
            if (!r.errorCategory) continue;
            m[r.errorCategory] = (m[r.errorCategory] || 0) + 1;
        }
        return m;
    }

    private static toLegacyResults(
        receipts: WalletReceipt[],
        uid?: string
    ): ExecutionResult['legacyResults'] {
        return receipts.map(r => {
            if (r.status === 'submitted' || r.status === 'confirmed') {
                return {
                    status: 'fulfilled' as const,
                    value: { hash: r.mintTxHash ?? r.txHash, from: r.walletAddress },
                    uid,
                };
            }
            return {
                status: 'rejected' as const,
                reason: new Error(r.errorMessage || r.status),
                uid,
            };
        });
    }

    private static emptyResult(
        executionId: string,
        triggerType: TriggerType,
        candidate: DetectedMintCandidate,
        reason: string,
        t0: number,
        classification?: ExecutionResult['classification'],
        paymentPlan?: ExecutionResult['paymentPlan'],
        privateKeys: string[] = []
    ): ExecutionResult {
        return {
            executionId,
            triggerType,
            sourceTxHash: candidate.sourceTxHash,
            sourceWallet: candidate.sourceWallet,
            targetContract: candidate.to,
            classification:
                classification ||
                ({
                    isLikelyMint: false,
                    confidence: 'low',
                    mintType: 'rejected',
                    methodSelector: candidate.data.slice(0, 10),
                    calldataNeedsWalletRewrite: false,
                    rejectionReason: reason,
                    warnings: [],
                } as ExecutionResult['classification']),
            paymentPlan:
                paymentPlan ||
                ({
                    paymentMode: 'rejected',
                    selectedValue: '0x0',
                    sourceTxValue: candidate.value,
                    valuePerToken: 0n,
                    quantity: 1,
                    confidence: 'low',
                    shouldExecute: false,
                    reason,
                    warnings: [],
                    simulation: {
                        zeroValueWorks: false,
                        sourceValueWorks: false,
                        scaledValueWorks: false,
                        adjustedValueWorks: false,
                        errors: [],
                    },
                } as ExecutionResult['paymentPlan']),
            gasSummary: 'n/a',
            walletCount: privateKeys.length,
            skippedCount: privateKeys.length,
            submittedCount: 0,
            confirmedCount: 0,
            revertedCount: 0,
            timeoutCount: 0,
            failedCount: privateKeys.length,
            duplicateSkippedCount: reason.includes('duplicate') ? 1 : 0,
            totalValueAttempted: '0',
            totalGasEstimated: '0',
            detectionLatencyMs: Date.now() - t0,
            classificationLatencyMs: 0,
            preflightLatencyMs: 0,
            broadcastLatencyMs: 0,
            confirmationLatencyMs: 0,
            receipts: [],
            errorsByCategory: { [reason]: 1 },
            createdAt: Date.now(),
            legacyResults: privateKeys.map((_, i) => ({
                status: 'rejected' as const,
                reason: new Error(reason),
            })),
        };
    }

    private static wrapLegacy(
        executionId: string,
        input: CopyMintExecuteInput,
        legacyResults: ExecutionResult['legacyResults'],
        t0: number
    ): ExecutionResult {
        const submitted = legacyResults.filter(r => r.status === 'fulfilled').length;
        const failed = legacyResults.filter(r => r.status === 'rejected').length;
        const result: ExecutionResult = {
            executionId,
            triggerType: input.triggerType,
            targetContract: input.candidate.to,
            classification: {
                isLikelyMint: true,
                confidence: 'medium',
                mintType: 'custom',
                methodSelector: input.candidate.data.slice(0, 10),
                calldataNeedsWalletRewrite: false,
                warnings: ['legacy_engine'],
            },
            paymentPlan: {
                paymentMode: 'unknown',
                selectedValue: input.candidate.value,
                sourceTxValue: input.candidate.value,
                valuePerToken: 0n,
                quantity: 1,
                confidence: 'low',
                shouldExecute: true,
                reason: 'legacy',
                warnings: [],
                simulation: {
                    zeroValueWorks: false,
                    sourceValueWorks: false,
                    scaledValueWorks: false,
                    adjustedValueWorks: false,
                    errors: [],
                },
            },
            gasSummary: 'legacy',
            walletCount: input.privateKeys.length,
            skippedCount: 0,
            submittedCount: submitted,
            confirmedCount: 0,
            revertedCount: 0,
            timeoutCount: 0,
            failedCount: failed,
            duplicateSkippedCount: 0,
            totalValueAttempted: input.candidate.value,
            totalGasEstimated: '0',
            detectionLatencyMs: 0,
            classificationLatencyMs: 0,
            preflightLatencyMs: 0,
            broadcastLatencyMs: Date.now() - t0,
            confirmationLatencyMs: 0,
            receipts: [],
            errorsByCategory: {},
            createdAt: Date.now(),
            legacyResults,
        };
        lastExecution = result;
        return result;
    }

    private static async monitorConfirmations(
        provider: JsonRpcProvider,
        receipts: WalletReceipt[]
    ): Promise<{ confirmed: number; reverted: number; timeout: number }> {
        const bundle = receipts.filter(r => r.bundleHash && r.mintTxHash);
        const publicTx = receipts.filter(r => !r.bundleHash);

        const [bundleStats, publicStats] = await Promise.all([
            bundle.length
                ? BundleInclusionMonitor.monitorSubmitted(provider, bundle)
                : Promise.resolve({ confirmed: 0, reverted: 0, timeout: 0 }),
            publicTx.length
                ? ConfirmationMonitor.monitorSubmitted(provider, publicTx)
                : Promise.resolve({ confirmed: 0, reverted: 0, timeout: 0 }),
        ]);

        return {
            confirmed: bundleStats.confirmed + publicStats.confirmed,
            reverted: bundleStats.reverted + publicStats.reverted,
            timeout: bundleStats.timeout + publicStats.timeout,
        };
    }

    private static inclusionOpts(options?: CopyMintEngineOptions): InclusionBroadcastOptions {
        return {
            inclusionMode: options?.inclusionMode,
            mevProtection: options?.mevProtection,
            builderTipWei: options?.builderTipWei
                ? BigInt(options.builderTipWei)
                : options?.priorityBoostWei
                  ? BigInt(options.priorityBoostWei)
                  : undefined,
            targetBlock: options?.targetBlock,
            bundleAllWallets: options?.bundleAllWallets,
        };
    }

    /**
     * Preflight and broadcast incrementally: wallet #1 submits before later wallets finish preflight.
     */
    private static async executeStreamedBroadcast(
        provider: JsonRpcProvider,
        preflightParams: PreflightBuildParams,
        inclusionOpts: InclusionBroadcastOptions,
        executionConcurrency: number
    ): Promise<{ plans: WalletExecutionPlan[]; receipts: WalletReceipt[] }> {
        const ctx = await WalletPreflight.prepareBuildContext(preflightParams);
        const plans: WalletExecutionPlan[] = [];
        const receipts: WalletReceipt[] = [];

        const submitPlan = async (plan: WalletExecutionPlan) => {
            const receipt = await BroadcastService.broadcastPlan(provider, plan, inclusionOpts);
            receipt.walletAddress = plan.walletAddress;
            receipts.push(receipt);
        };

        if (ctx.keys.length === 0) {
            return { plans, receipts };
        }

        const plan0 = await WalletPreflight.buildPlanAtIndex(ctx, 0);
        plans.push(plan0);
        await submitPlan(plan0);

        if (ctx.keys.length > 1) {
            const tailIndices = ctx.keys.slice(1).map((_, j) => j + 1);
            await ExecutionQueue.runWithConcurrency(tailIndices, executionConcurrency, async (i) => {
                const plan = await WalletPreflight.buildPlanAtIndex(ctx, i);
                plans.push(plan);
                await submitPlan(plan);
            });
        }

        plans.sort((a, b) => a.walletIndex - b.walletIndex);
        receipts.sort((a, b) => a.walletIndex - b.walletIndex);
        return { plans, receipts };
    }
}
