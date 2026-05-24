import { formatEther, parseUnits, type JsonRpcProvider } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { effectiveSkipRpcPreflight, effectiveStreamBroadcast } from '../config/capacityOverrides';
import { computeGasFeesForTier, resolveLiveNetworkFees } from '../services/networkGas';
import { computePreflightGasCost, totalRequiredWei } from './gasCost';
import type { DetectedMintCandidate, GasPlan, PaymentPlan } from '../types/copyMint';

/** Nonce resolved at broadcast (no getTransactionCount in preflight). */
export const DEFERRED_NONCE = -1;

export class GasPlanner {
    static async plan(params: {
        provider: JsonRpcProvider;
        candidate: DetectedMintCandidate;
        paymentPlan: PaymentPlan;
        walletAddress: string;
        overdrive?: boolean;
        gasBribeGwei?: string;
        /** Gas advisor tier — recomputes max/priority from live network gwei at send time */
        gasTierId?: string;
        gasLimitOverride?: string;
        forceGasEstimate?: boolean;
        /** Copy-mint: match or exceed whale tx maxFee when higher than network default */
        mirrorWhaleGas?: boolean;
    }): Promise<GasPlan> {
        const cfg = getRuntimeConfig();
        if (effectiveSkipRpcPreflight() && !params.forceGasEstimate) {
            return GasPlanner.planFast({
                provider: params.provider,
                candidate: params.candidate,
                paymentPlan: params.paymentPlan,
                overdrive: params.overdrive,
                gasBribeGwei: params.gasBribeGwei,
                gasTierId: params.gasTierId,
                gasLimitOverride: params.gasLimitOverride,
                mirrorWhaleGas: params.mirrorWhaleGas,
            });
        }
        return GasPlanner.planWithEstimate(params);
    }

    /** Broadcast gas limit with headroom above estimate (EIP-1559 cap, not preflight-only). */
    static applyBroadcastGasLimit(estimatedGas: bigint, cfg = getRuntimeConfig()): bigint {
        const mult = BigInt(Math.round(cfg.gasLimitMultiplier * 100));
        let limit = (estimatedGas * mult) / 100n;
        const minHeadroom = 30_000n;
        if (limit < estimatedGas + minHeadroom) {
            limit = estimatedGas + minHeadroom;
        }
        const cap = BigInt(cfg.fastGasLimit);
        return limit > cap ? cap : limit;
    }

    private static async resolveMaxFees(params: {
        provider: JsonRpcProvider;
        overdrive?: boolean;
        gasBribeGwei?: string;
        gasTierId?: string;
        mirrorWhaleGas?: boolean;
        whaleMaxFeePerGas?: bigint;
        whaleMaxPriorityFeePerGas?: bigint;
    }): Promise<{ feeData: Awaited<ReturnType<typeof resolveLiveNetworkFees>>['feeData']; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; warnings: string[] }> {
        const live = await resolveLiveNetworkFees(params.provider);
        const warnings: string[] = [];

        if (params.gasTierId) {
            const tier = computeGasFeesForTier(live, params.gasTierId);
            if (tier) {
                warnings.push(`Gas tier ${params.gasTierId}: live ${tier.maxFeeGwei.toFixed(2)} gwei max`);
                return {
                    feeData: live.feeData,
                    maxFeePerGas: tier.maxFeePerGas,
                    maxPriorityFeePerGas: tier.maxPriorityFeePerGas,
                    warnings,
                };
            }
        }

        const cfg = getRuntimeConfig();
        let maxFeePerGas = live.baseMaxFee;
        let maxPriorityFeePerGas = live.basePriorityFee;

        if (!cfg.baseGasOnly) {
            maxFeePerGas = (maxFeePerGas * BigInt(Math.round(cfg.normalGasMultiplier * 100))) / 100n;
            maxPriorityFeePerGas =
                (maxPriorityFeePerGas * BigInt(Math.round(cfg.normalGasMultiplier * 100))) / 100n;
        }

        const overdrive = params.overdrive || cfg.overdriveGas;
        if (overdrive) {
            maxFeePerGas = (maxFeePerGas * 400n) / 100n;
            maxPriorityFeePerGas = (maxPriorityFeePerGas * 150n) / 100n;
        }

        if (params.gasBribeGwei && parseFloat(params.gasBribeGwei) > 0 && !params.gasTierId) {
            const bribe = parseUnits(params.gasBribeGwei, 'gwei');
            maxPriorityFeePerGas += bribe;
            maxFeePerGas += bribe;
        }

        if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas;

        if (params.mirrorWhaleGas && params.whaleMaxFeePerGas && params.whaleMaxFeePerGas > maxFeePerGas) {
            maxFeePerGas = params.whaleMaxFeePerGas;
            const whalePri = params.whaleMaxPriorityFeePerGas ?? params.whaleMaxFeePerGas / 10n;
            if (whalePri > maxPriorityFeePerGas) {
                maxPriorityFeePerGas = whalePri > maxFeePerGas ? maxFeePerGas : whalePri;
            }
            warnings.push('Mirrored whale tx gas caps for competitive copy-mint');
        }

        warnings.push(`Live network ${live.baseMaxFeeGwei.toFixed(2)} gwei base`);

        return { feeData: live.feeData, maxFeePerGas, maxPriorityFeePerGas, warnings };
    }

    /**
     * No estimateGas — one cached getFeeData per batch, network base gas, fixed limit.
     */
    static async planFast(params: {
        provider: JsonRpcProvider;
        candidate: DetectedMintCandidate;
        paymentPlan: PaymentPlan;
        overdrive?: boolean;
        gasBribeGwei?: string;
        gasTierId?: string;
        gasLimitOverride?: string;
        mirrorWhaleGas?: boolean;
    }): Promise<GasPlan> {
        const cfg = getRuntimeConfig();
        const overdrive = params.overdrive || cfg.overdriveGas;
        const mintValue = BigInt(params.paymentPlan.selectedValue || '0');

        const { feeData, maxFeePerGas, maxPriorityFeePerGas, warnings: feeWarnings } =
            await GasPlanner.resolveMaxFees({
                provider: params.provider,
                overdrive,
                gasBribeGwei: params.gasBribeGwei,
                gasTierId: params.gasTierId,
                mirrorWhaleGas: params.mirrorWhaleGas,
                whaleMaxFeePerGas: params.candidate.maxFeePerGas,
                whaleMaxPriorityFeePerGas: params.candidate.maxPriorityFeePerGas,
            });

        const configuredGas = params.gasLimitOverride
            ? BigInt(params.gasLimitOverride)
            : BigInt(cfg.fastGasLimit);
        const intrinsicFloor = intrinsicGasFloor(params.candidate.data);
        // Use calldata-based estimate when below FAST_GAS_LIMIT — avoids false "low gas" skips on small mints.
        const intrinsicEstimate = intrinsicFloor + 35_000n;
        const estimatedGas =
            intrinsicEstimate > 0n && intrinsicEstimate < configuredGas
                ? intrinsicEstimate
                : configuredGas > intrinsicFloor
                  ? configuredGas
                  : intrinsicFloor;
        const gasLimit = GasPlanner.applyBroadcastGasLimit(estimatedGas, cfg);

        const preflight = computePreflightGasCost({
            feeData,
            gasLimit,
            estimatedGas,
            maxFeePerGas,
            maxPriorityFeePerGas,
            bufferEth: cfg.minWalletBufferEth,
        });

        return {
            gasMode: (overdrive ? 'overdrive' : 'normal') as GasPlan['gasMode'],
            estimatedGas,
            gasLimit,
            gasLimitMultiplier: 1,
            maxFeePerGas,
            maxPriorityFeePerGas,
            estimatedGasCostEth: preflight.gasReserveEth,
            requiredBalanceEth: formatEther(totalRequiredWei(mintValue, preflight)),
            sourceGasMirrored: false,
            warnings: ['Fast path: live network gas + fixed limit (no estimateGas RPC)', ...feeWarnings],
        };
    }

    private static async planWithEstimate(params: {
        provider: JsonRpcProvider;
        candidate: DetectedMintCandidate;
        paymentPlan: PaymentPlan;
        walletAddress: string;
        overdrive?: boolean;
        gasBribeGwei?: string;
        gasTierId?: string;
        gasLimitOverride?: string;
        mirrorWhaleGas?: boolean;
    }): Promise<GasPlan> {
        const cfg = getRuntimeConfig();
        const overdrive = params.overdrive || cfg.overdriveGas;
        const gasMode = params.gasTierId ? 'normal' : overdrive ? 'overdrive' : cfg.gasMode;

        const { feeData, maxFeePerGas: tierMax, maxPriorityFeePerGas: tierPri, warnings: feeWarnings } =
            await GasPlanner.resolveMaxFees({
                provider: params.provider,
                overdrive,
                gasBribeGwei: params.gasBribeGwei,
                gasTierId: params.gasTierId,
                mirrorWhaleGas: params.mirrorWhaleGas ?? true,
                whaleMaxFeePerGas: params.candidate.maxFeePerGas,
                whaleMaxPriorityFeePerGas: params.candidate.maxPriorityFeePerGas,
            });

        let maxFeePerGas = tierMax;
        let maxPriorityFeePerGas = tierPri;

        if (
            !params.gasTierId &&
            gasMode === 'mirror' &&
            params.candidate.maxFeePerGas &&
            params.candidate.maxFeePerGas > maxFeePerGas
        ) {
            const threshold =
                (maxFeePerGas * BigInt(Math.round(cfg.mirrorSourceGasThreshold * 100))) / 100n;
            if (params.candidate.maxFeePerGas > threshold) {
                maxFeePerGas = params.candidate.maxFeePerGas;
                maxPriorityFeePerGas = params.candidate.maxPriorityFeePerGas ?? maxPriorityFeePerGas;
            }
        }

        const mintValue = BigInt(params.paymentPlan.selectedValue || '0');

        let estimatedGas = 0n;
        if (params.gasLimitOverride) {
            estimatedGas = BigInt(params.gasLimitOverride);
        } else {
            try {
                estimatedGas = await params.provider.estimateGas({
                    to: params.candidate.to,
                    data: params.candidate.data,
                    value: mintValue > 0n ? mintValue : 0n,
                    from: params.walletAddress,
                });
            } catch {
                estimatedGas = BigInt(cfg.fallbackGasAllowed ? cfg.fallbackGasLimit : 120_000);
            }
        }

        let gasLimit = params.gasLimitOverride
            ? estimatedGas
            : GasPlanner.applyBroadcastGasLimit(estimatedGas, cfg);

        const intrinsicFloor = intrinsicGasFloor(params.candidate.data);
        if (gasLimit < intrinsicFloor) {
            gasLimit = GasPlanner.applyBroadcastGasLimit(intrinsicFloor, cfg);
        }

        if (params.candidate.gasLimit && params.candidate.gasLimit > estimatedGas) {
            const whaleFloor = GasPlanner.applyBroadcastGasLimit(params.candidate.gasLimit, cfg);
            if (whaleFloor > gasLimit) gasLimit = whaleFloor;
        }

        const preflight = computePreflightGasCost({
            feeData,
            gasLimit,
            estimatedGas,
            maxFeePerGas,
            maxPriorityFeePerGas,
            bufferEth: cfg.minWalletBufferEth,
        });

        const requiredTotal = totalRequiredWei(mintValue, preflight);

        return {
            gasMode: gasMode as GasPlan['gasMode'],
            estimatedGas,
            gasLimit,
            gasLimitMultiplier: cfg.gasLimitMultiplier,
            maxFeePerGas,
            maxPriorityFeePerGas,
            estimatedGasCostEth: preflight.gasReserveEth,
            requiredBalanceEth: formatEther(requiredTotal),
            sourceGasMirrored: gasMode === 'mirror',
            warnings: [
                ...feeWarnings,
                ...(preflight.worstCaseGasWei > preflight.gasReserveWei * 3n
                    ? ['Preflight uses live gas price; tx cap may reserve more headroom']
                    : []),
            ],
        };
    }
}

/** Minimum gas limit so large calldata txs pass intrinsic gas validation. */
export function intrinsicGasFloor(calldata: string): bigint {
    const clean = (calldata || '').toLowerCase().replace(/^0x/, '');
    let zeroBytes = 0;
    let nonZeroBytes = 0;
    for (let i = 0; i < clean.length; i += 2) {
        const byte = clean.slice(i, i + 2);
        if (byte.length < 2) break;
        if (byte === '00') zeroBytes++;
        else nonZeroBytes++;
    }
    const intrinsic = 21_000n + BigInt(zeroBytes * 4 + nonZeroBytes * 16);
    // Add headroom above intrinsic so tx gets past upfront validation in fast mode.
    return intrinsic + 25_000n;
}
