/**
 * Paid/Free Mint Detector — determines the correct msg.value before execution.
 *
 * Classifies mints as free, paid, or unknown by simulating with different values.
 * Scales value correctly when quantity changes (Max-Mint Overdrive).
 * Rejects unknown payment modes unless explicitly allowed.
 */

import { JsonRpcProvider, formatEther, AbiCoder } from 'ethers';

export type PaymentMode = 'free' | 'paid' | 'unknown';

export interface MintPaymentPlan {
    paymentMode: PaymentMode;
    selectedValue: string;       // hex value to use in tx
    selectedValueEth: string;    // human-readable
    sourceTxValue: string;       // original whale value
    valuePerToken: bigint;       // price per single token
    quantity: number;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    shouldExecute: boolean;
    warnings: string[];
    simulationResults: {
        freeValueWorks: boolean;
        sourceValueWorks: boolean;
        scaledValueWorks: boolean;
        errorMessages: string[];
    };
}

/**
 * Detect whether a mint is free or paid, and calculate the correct value.
 */
export async function detectMintPaymentMode(params: {
    provider: JsonRpcProvider;
    contractAddress: string;
    calldata: string;
    sourceTxValue: string;
    quantity: number;
    sourceQuantity?: number;
    executingWallet: string;
    maxMintEth?: number;
    allowUnknown?: boolean;
    blindBroadcastEnabled?: boolean;
}): Promise<MintPaymentPlan> {
    const {
        provider, contractAddress, calldata, sourceTxValue,
        quantity, sourceQuantity, executingWallet,
        maxMintEth = 1.0, allowUnknown = false, blindBroadcastEnabled = false
    } = params;

    const warnings: string[] = [];
    const errorMessages: string[] = [];
    const sourceValueBig = BigInt(sourceTxValue || '0');
    const srcQty = sourceQuantity || 1;

    // Calculate value per token from source tx
    const valuePerToken = srcQty > 0 ? sourceValueBig / BigInt(srcQty) : sourceValueBig;
    const scaledValue = valuePerToken * BigInt(quantity);

    // Simulation helper
    async function trySimulate(value: bigint): Promise<boolean> {
        try {
            await provider.estimateGas({
                to: contractAddress,
                data: calldata,
                value: value > 0n ? '0x' + value.toString(16) : '0x0',
                from: executingWallet,
            });
            return true;
        } catch (err: any) {
            errorMessages.push(err.reason || err.message?.slice(0, 80) || 'unknown');
            return false;
        }
    }

    // Test free path
    const freeWorks = await trySimulate(0n);

    // Test source value path (only if source had value)
    let sourceWorks = false;
    if (sourceValueBig > 0n) {
        sourceWorks = await trySimulate(sourceValueBig);
    }

    // Test scaled value path (if quantity differs from source)
    let scaledWorks = false;
    if (scaledValue !== sourceValueBig && scaledValue > 0n) {
        scaledWorks = await trySimulate(scaledValue);
    }

    const simResults = { freeValueWorks: freeWorks, sourceValueWorks: sourceWorks, scaledValueWorks: scaledWorks, errorMessages };

    // Decision logic
    let paymentMode: PaymentMode;
    let selectedValue: bigint;
    let confidence: 'high' | 'medium' | 'low';
    let reason: string;

    if (freeWorks && sourceValueBig === 0n) {
        // Source was free, simulation confirms free
        paymentMode = 'free';
        selectedValue = 0n;
        confidence = 'high';
        reason = 'Source tx was free and simulation confirms value=0 works';
    } else if (freeWorks && sourceValueBig > 0n) {
        // Ambiguous: estimateGas accepts both. Prefer whale payment so we do not underpay at execution.
        paymentMode = 'paid';
        selectedValue = sourceValueBig;
        confidence = 'medium';
        reason = 'Free and paid both simulate — using whale tx value to match paid mint rules';
        warnings.push('RPC simulation accepted 0 ETH; if mint is paid-only, this path should still succeed');
    } else if (scaledWorks && scaledValue > 0n) {
        // Quantity was changed, scaled value works
        paymentMode = 'paid';
        selectedValue = scaledValue;
        confidence = 'high';
        reason = `Scaled value works: ${formatEther(valuePerToken)} ETH/token × ${quantity} = ${formatEther(scaledValue)} ETH`;
    } else if (sourceWorks) {
        // Source value works directly
        paymentMode = 'paid';
        selectedValue = sourceValueBig;
        confidence = 'high';
        reason = `Source tx value ${formatEther(sourceValueBig)} ETH works`;
    } else {
        // Nothing works
        paymentMode = 'unknown';
        selectedValue = sourceValueBig; // fallback to source
        confidence = 'low';
        reason =
            'All simulations failed — mint may be private/allowlist/sold out. ' +
            'Try /custommint, /mint <contract> <eth> <data>, or /forcesim';
        warnings.push(...errorMessages.slice(0, 2));
    }

    // Safety cap check
    const selectedEth = parseFloat(formatEther(selectedValue));
    if (selectedEth > maxMintEth) {
        warnings.push(`Selected value ${selectedEth.toFixed(4)} ETH exceeds MAX_MINT_ETH (${maxMintEth})`);
        return {
            paymentMode, selectedValue: '0x' + selectedValue.toString(16), selectedValueEth: formatEther(selectedValue),
            sourceTxValue, valuePerToken, quantity, confidence, reason,
            shouldExecute: false,
            warnings: [...warnings, 'BLOCKED: exceeds max mint cap'],
            simulationResults: simResults,
        };
    }

    // Should execute?
    // allowUnknown=true (automint) permits execution when sims fail; blindBroadcast is an extra safety gate only
    const shouldExecute = paymentMode !== 'unknown' || allowUnknown || blindBroadcastEnabled;

    if (paymentMode === 'unknown' && !shouldExecute) {
        warnings.push('Execution blocked: unknown payment mode and blind broadcast disabled');
    }

    return {
        paymentMode,
        selectedValue: selectedValue > 0n ? '0x' + selectedValue.toString(16) : '0x0',
        selectedValueEth: formatEther(selectedValue),
        sourceTxValue,
        valuePerToken,
        quantity,
        confidence,
        reason,
        shouldExecute,
        warnings,
        simulationResults: simResults,
    };
}
