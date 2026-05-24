import type { JsonRpcProvider } from 'ethers';
import { detectMintPaymentMode } from '../services/paidFreeMintDetector';
import { setCachedSimulation } from '../services/simulationCache';
import { getRuntimeConfig } from '../config/runtimeConfig';
import type { DetectedMintCandidate, MintClassification, PaymentPlan } from '../types/copyMint';

export class EnginePaymentDetector {
    static async detect(params: {
        provider: JsonRpcProvider;
        candidate: DetectedMintCandidate;
        classification: MintClassification;
        executingWallet: string;
        quantity?: number;
        allowUnknown?: boolean;
        skipSimulation?: boolean;
        maxMintEth?: number;
        prevalidatedValue?: string;
    }): Promise<PaymentPlan> {
        const cfg = getRuntimeConfig();
        const quantity = params.quantity ?? 1;
        const maxMintEth = params.maxMintEth ?? cfg.maxMintEth;

        if (params.prevalidatedValue) {
            let val = 0n;
            try {
                const raw = String(params.prevalidatedValue).trim();
                val = raw.startsWith('0x') ? BigInt(raw) : BigInt(raw || '0');
            } catch {
                return EnginePaymentDetector.rejected('invalid_prevalidated_value');
            }
            const selectedEth = Number(val) / 1e18;
            if (selectedEth > maxMintEth) {
                return EnginePaymentDetector.rejected('exceeds_max_mint_eth');
            }
            return {
                paymentMode: val === 0n ? 'free' : 'paid',
                selectedValue: params.prevalidatedValue,
                sourceTxValue: params.candidate.value || '0x0',
                valuePerToken: val,
                quantity,
                confidence: 'high',
                shouldExecute: true,
                reason: 'prevalidated_by_bot',
                warnings: [],
                simulation: {
                    zeroValueWorks: val === 0n,
                    sourceValueWorks: val > 0n,
                    scaledValueWorks: false,
                    adjustedValueWorks: false,
                    errors: [],
                },
            };
        }

        if (params.skipSimulation && (cfg.blindBroadcastEnabled || params.allowUnknown)) {
            const maxWei = BigInt(Math.floor(cfg.blindBroadcastMaxValueEth * 1e18));
            const val = BigInt(params.candidate.value || '0');
            if (val > maxWei) {
                return EnginePaymentDetector.rejected('blind_broadcast_value_cap');
            }
            return {
                paymentMode: val === 0n ? 'free' : 'paid',
                selectedValue: params.candidate.value || '0x0',
                sourceTxValue: params.candidate.value || '0x0',
                valuePerToken: val,
                quantity,
                confidence: 'low',
                shouldExecute: true,
                reason: 'blind_broadcast_enabled',
                warnings: ['Blind broadcast — no simulation'],
                simulation: {
                    zeroValueWorks: false,
                    sourceValueWorks: false,
                    scaledValueWorks: false,
                    adjustedValueWorks: false,
                    errors: [],
                },
            };
        }

        const legacy = await detectMintPaymentMode({
            provider: params.provider,
            contractAddress: params.candidate.to,
            calldata: params.candidate.data,
            sourceTxValue: params.candidate.value,
            quantity,
            sourceQuantity: 1,
            executingWallet: params.executingWallet,
            maxMintEth,
            allowUnknown: params.allowUnknown ?? false,
            blindBroadcastEnabled: cfg.blindBroadcastEnabled,
        });

        const mode =
            legacy.paymentMode === 'unknown' && !legacy.shouldExecute
                ? 'rejected'
                : legacy.paymentMode;

        if (
            legacy.shouldExecute &&
            (legacy.simulationResults.freeValueWorks ||
                legacy.simulationResults.sourceValueWorks ||
                legacy.simulationResults.scaledValueWorks)
        ) {
            setCachedSimulation(params.candidate.to, params.candidate.data, {
                selector: params.candidate.data.slice(0, 10),
                data: params.candidate.data,
                value: legacy.selectedValue,
                quantity: legacy.quantity,
            });
        }

        return {
            paymentMode: mode as PaymentPlan['paymentMode'],
            selectedValue: legacy.selectedValue,
            sourceTxValue: legacy.sourceTxValue,
            valuePerToken: legacy.valuePerToken,
            quantity: legacy.quantity,
            confidence: legacy.confidence,
            shouldExecute: legacy.shouldExecute,
            reason: legacy.reason,
            warnings: legacy.warnings,
            simulation: {
                zeroValueWorks: legacy.simulationResults.freeValueWorks,
                sourceValueWorks: legacy.simulationResults.sourceValueWorks,
                scaledValueWorks: legacy.simulationResults.scaledValueWorks,
                adjustedValueWorks: false,
                errors: legacy.simulationResults.errorMessages,
            },
        };
    }

    private static rejected(reason: string): PaymentPlan {
        return {
            paymentMode: 'rejected',
            selectedValue: '0x0',
            sourceTxValue: '0x0',
            valuePerToken: 0n,
            quantity: 1,
            confidence: 'high',
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
        };
    }
}
