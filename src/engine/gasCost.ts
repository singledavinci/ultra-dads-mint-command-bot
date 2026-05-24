/**
 * Realistic gas cost for balance preflight (not worst-case maxFee × gasLimit).
 *
 * EIP-1559: you pay ~(baseFee + priorityFee) × gasUsed, capped by maxFeePerGas.
 * Preflight uses network gasPrice (or priority + small base) × estimatedGas.
 */
import { formatEther, parseUnits, type FeeData } from 'ethers';

/** Minimum ETH reserved for gas when network fees are very low. */
export const MIN_PREFLIGHT_GAS_WEI = 50_000_000_000_000n; // 0.00005 ETH

export interface PreflightGasCost {
    /** Gas + buffer — amount to reserve on top of mint value. */
    gasReserveWei: bigint;
    /** Upper bound if block is full (display / warnings). */
    worstCaseGasWei: bigint;
    gasReserveEth: string;
    worstCaseGasEth: string;
    effectiveFeePerGas: bigint;
}

export function effectiveFeePerGasForPreflight(
    feeData: FeeData,
    maxFeePerGas: bigint,
    maxPriorityFeePerGas: bigint
): bigint {
    const gasPrice = feeData.gasPrice;
    if (gasPrice && gasPrice > 0n) {
        const bumped = (gasPrice * 115n) / 100n;
        return bumped < maxFeePerGas ? bumped : maxFeePerGas;
    }

    const liveBase =
        maxFeePerGas > maxPriorityFeePerGas ? maxFeePerGas - maxPriorityFeePerGas : maxFeePerGas / 2n;
    const est = maxPriorityFeePerGas + (liveBase > 0n ? liveBase : parseUnits('1', 'gwei'));
    return est < maxFeePerGas ? est : maxFeePerGas;
}

export function computePreflightGasCost(params: {
    feeData: FeeData;
    gasLimit: bigint;
    estimatedGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    bufferEth: number;
}): PreflightGasCost {
    const effectiveFee = effectiveFeePerGasForPreflight(
        params.feeData,
        params.maxFeePerGas,
        params.maxPriorityFeePerGas
    );

    const gasUnits =
        params.estimatedGas > 0n
            ? (params.estimatedGas * 110n) / 100n
            : (params.gasLimit * 110n) / 100n;

    let gasCostWei = gasUnits * effectiveFee;
    if (gasCostWei < MIN_PREFLIGHT_GAS_WEI) {
        gasCostWei = MIN_PREFLIGHT_GAS_WEI;
    }

    const bufferWei = BigInt(Math.max(0, Math.floor(params.bufferEth * 1e18)));
    const gasReserveWei = gasCostWei + bufferWei;
    const worstCaseGasWei = params.gasLimit * params.maxFeePerGas;

    return {
        gasReserveWei,
        worstCaseGasWei,
        gasReserveEth: formatEther(gasReserveWei),
        worstCaseGasEth: formatEther(worstCaseGasWei),
        effectiveFeePerGas: effectiveFee,
    };
}

export function totalRequiredWei(mintValueWei: bigint, preflight: PreflightGasCost): bigint {
    return mintValueWei + preflight.gasReserveWei;
}

export type WalletFundingVerdict =
    | { ok: true }
    | {
          ok: false;
          reason: string;
          mintShortfallWei: bigint;
          gasShortfallWei: bigint;
      };

/** Split mint payment vs gas reserve so skips are not mislabeled as "gas only". */
export function evaluateWalletFunding(
    balanceWei: bigint,
    mintValueWei: bigint,
    preflight: PreflightGasCost
): WalletFundingVerdict {
    const gasReserveWei = preflight.gasReserveWei;
    const totalRequired = mintValueWei + gasReserveWei;

    if (balanceWei >= totalRequired) {
        return { ok: true };
    }

    const mintShortfallWei =
        mintValueWei > balanceWei ? mintValueWei - balanceWei : 0n;
    const afterMint = balanceWei > mintValueWei ? balanceWei - mintValueWei : 0n;
    const gasShortfallWei =
        gasReserveWei > afterMint ? gasReserveWei - afterMint : 0n;

    if (mintShortfallWei > 0n && gasShortfallWei > 0n) {
        return {
            ok: false,
            reason: 'insufficient_mint_and_gas',
            mintShortfallWei,
            gasShortfallWei,
        };
    }
    if (mintShortfallWei > 0n) {
        return {
            ok: false,
            reason: 'insufficient_mint_funds',
            mintShortfallWei,
            gasShortfallWei: 0n,
        };
    }
    return {
        ok: false,
        reason: 'insufficient_gas',
        mintShortfallWei: 0n,
        gasShortfallWei,
    };
}

export function formatFundingSkipReason(
    verdict: Extract<WalletFundingVerdict, { ok: false }>,
    balanceWei: bigint,
    mintValueWei: bigint,
    preflight: PreflightGasCost
): string {
    const have = formatEther(balanceWei).slice(0, 10);
    const mint = formatEther(mintValueWei).slice(0, 10);
    const gas = preflight.gasReserveEth.slice(0, 10);

    if (verdict.reason === 'insufficient_mint_funds') {
        return `Insufficient mint funds (have ${have} ETH, mint needs ${mint} ETH)`;
    }
    if (verdict.reason === 'insufficient_gas') {
        return `Insufficient gas ETH (have ${have} ETH, need ~${gas} ETH for gas)`;
    }
    return (
        `Insufficient balance (have ${have} ETH, mint ${mint} + gas ~${gas} ETH)` +
        ` — short mint ${formatEther(verdict.mintShortfallWei).slice(0, 8)}` +
        ` / gas ${formatEther(verdict.gasShortfallWei).slice(0, 8)}`
    );
}
