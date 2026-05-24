import { getRuntimeConfig } from '../config/runtimeConfig';
import type { InclusionBroadcastOptions, InclusionMode } from '../types/inclusion';

export type { InclusionMode, InclusionBroadcastOptions } from '../types/inclusion';

/** Resolve effective inclusion mode; legacy mevProtection maps to protected. */
export function resolveInclusionMode(opts?: InclusionBroadcastOptions): InclusionMode {
    if (opts?.inclusionMode) return opts.inclusionMode;
    if (opts?.mevProtection) return 'protected';
    return getRuntimeConfig().defaultInclusionMode;
}

export function inclusionModeShort(mode: InclusionMode): string {
    switch (mode) {
        case 'public':
            return '🔓 Public';
        case 'protected':
            return '🛡️ Protected';
        case 'builder_flashbots':
            return '📦 Builder';
        case 'builder_titan':
            return '📦 Titan';
    }
}

export function inclusionModeLabel(mode: InclusionMode): string {
    switch (mode) {
        case 'public':
            return 'Public mempool';
        case 'protected':
            return 'Protected (anti-sandwich)';
        case 'builder_flashbots':
            return 'Builder · Flashbots';
        case 'builder_titan':
            return 'Builder · Titan';
    }
}

export function isBuilderMode(mode: InclusionMode): boolean {
    return mode === 'builder_flashbots' || mode === 'builder_titan';
}

export function inclusionModeFromState(state: {
    inclusionMode?: InclusionMode;
    mevProtection?: boolean;
}): InclusionMode {
    if (state.inclusionMode) return state.inclusionMode;
    if (state.mevProtection) return 'protected';
    return getRuntimeConfig().defaultInclusionMode;
}

/** Cap per-wallet priority boost budget (wei). Env: MAX_BUILDER_TIP_ETH */
export function capBuilderTipWei(requested: bigint | undefined): bigint {
    const cfg = getRuntimeConfig();
    const maxWei = BigInt(Math.floor(cfg.maxBuilderTipEth * 1e18));
    if (!requested || requested <= 0n) return 0n;
    return requested > maxWei ? maxWei : requested;
}
