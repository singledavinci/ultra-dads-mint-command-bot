/**
 * Inclusion-mode gas floors (MintDash executionGas parity).
 * Network tiers are untouched; competitive tiers get tip floors + headroom on Direct/Protect.
 */

import type { InclusionMode } from '../types/inclusion';

const GWEI = 1_000_000_000n;

const NETWORK_TIERS = new Set(['normal', 'low', 'lowest', 'market', 'fast', 'high']);

export function isNetworkGasTier(tierId?: string | null): boolean {
    if (!tierId) return false;
    return NETWORK_TIERS.has(tierId.toLowerCase());
}

export function isCompetitiveGasTier(tierId?: string | null): boolean {
    if (!tierId) return false;
    const id = tierId.toLowerCase();
    return id === 'fcfs' || id === 'fcfs_plus' || id === 'fcfs_max' || id === 'overdrive' || id === 'sniper';
}

function maxBig(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
}

/**
 * Apply competitive inclusion floors. Network tiers return fees unchanged.
 */
export function applyInclusionGasAdjustments(params: {
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    baseFeeWei: bigint;
    gasTierId?: string;
    inclusionMode?: InclusionMode;
}): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
    // Network tiers: exact live estimate — no inclusion inflation.
    if (isNetworkGasTier(params.gasTierId)) {
        return {
            maxFeePerGas: params.maxFeePerGas,
            maxPriorityFeePerGas: params.maxPriorityFeePerGas,
        };
    }

    // Untiered / unknown: leave alone.
    if (!isCompetitiveGasTier(params.gasTierId)) {
        return {
            maxFeePerGas: params.maxFeePerGas,
            maxPriorityFeePerGas: params.maxPriorityFeePerGas,
        };
    }

    let priority = params.maxPriorityFeePerGas;
    let maxFee = params.maxFeePerGas;
    const baseFee = params.baseFeeWei > 0n ? params.baseFeeWei : maxFee / 2n;
    const mode = params.inclusionMode;

    const dedicatedLike =
        mode === 'private_rpc_direct' ||
        mode === 'private_rpc' ||
        mode === 'builder_flashbots' ||
        mode === 'builder_titan';

    if (dedicatedLike) {
        const bumpBps = BigInt(
            Math.max(
                0,
                Number(process.env.DEDICATED_GAS_BUMP_BPS ?? process.env.MINT_DEDICATED_GAS_BUMP_BPS ?? 2500)
            )
        );
        if (bumpBps > 0n) {
            priority = (priority * (10_000n + bumpBps)) / 10_000n + 2n * GWEI;
            maxFee = maxBig(maxFee, baseFee * 2n + priority);
        }
    }

    if (mode === 'private_rpc') {
        const floorGwei = Number(
            process.env.PRIVATE_MIN_PRIORITY_GWEI ?? process.env.MINT_PRIVATE_MIN_PRIORITY_GWEI ?? 5
        );
        const floor = BigInt(Math.max(1, Math.floor(floorGwei))) * GWEI;
        if (priority < floor) {
            priority = floor;
            maxFee = maxBig(maxFee, baseFee * 2n + priority);
        }
    }

    if (dedicatedLike) {
        const minPrioGwei = Number(
            process.env.ETH_COMPETITIVE_MIN_PRIORITY_GWEI ??
                process.env.MINT_ETH_COMPETITIVE_MIN_PRIORITY_GWEI ??
                5
        );
        const minPrio = BigInt(Math.max(0, Math.floor(minPrioGwei))) * GWEI;
        if (priority < minPrio) priority = minPrio;
        const headroom = baseFee * 4n + priority;
        if (maxFee < headroom) maxFee = headroom;
    }

    if (priority > maxFee) maxFee = priority;

    return { maxFeePerGas: maxFee, maxPriorityFeePerGas: priority };
}

/** Gas-limit pad in bps — network 3%, competitive 10% (MintDash gasLimitPad). */
export function gasLimitPadBps(gasTierId?: string | null): bigint {
    if (isNetworkGasTier(gasTierId) || !gasTierId) {
        const n = Number(process.env.NETWORK_GAS_PAD_BPS ?? process.env.MINT_NETWORK_GAS_PAD_BPS ?? 300);
        return BigInt(Math.max(0, Number.isFinite(n) ? Math.floor(n) : 300));
    }
    const n = Number(process.env.GAS_PAD_BPS ?? process.env.MINT_GAS_PAD_BPS ?? 1000);
    return BigInt(Math.max(0, Number.isFinite(n) ? Math.floor(n) : 1000));
}

export function paddedGasLimit(estimate: bigint, gasTierId?: string | null): bigint {
    return estimate + (estimate * gasLimitPadBps(gasTierId)) / 10_000n;
}
