import { getRuntimeConfig } from '../config/runtimeConfig';
import { INCLUSION_MODES, type InclusionBroadcastOptions, type InclusionMode } from '../types/inclusion';

export type { InclusionMode, InclusionBroadcastOptions } from '../types/inclusion';

/** Map MintDash / short aliases → canonical InclusionMode. */
const MODE_ALIASES: Record<string, InclusionMode> = {
    public: 'public',
    PRIVATE_RPC_DIRECT: 'private_rpc_direct',
    private_rpc_direct: 'private_rpc_direct',
    direct: 'private_rpc_direct',
    rpc_direct: 'private_rpc_direct',
    PRIVATE_RPC: 'private_rpc',
    private_rpc: 'private_rpc',
    protect: 'private_rpc',
    flashbots_protect: 'private_rpc',
    protected: 'protected',
    mev: 'protected',
    blocker: 'protected',
    FLASHBOTS_BUNDLE: 'builder_flashbots',
    flashbots_bundle: 'builder_flashbots',
    builder: 'builder_flashbots',
    flashbots: 'builder_flashbots',
    builder_flashbots: 'builder_flashbots',
    titan: 'builder_titan',
    builder_titan: 'builder_titan',
    DELEGATION_CONTRACT: 'delegation',
    delegation: 'delegation',
    delegation_contract: 'delegation',
};

export function parseInclusionMode(raw: string | undefined | null): InclusionMode | null {
    if (!raw?.trim()) return null;
    const key = raw.trim();
    const lower = key.toLowerCase();
    const mapped = MODE_ALIASES[key] ?? MODE_ALIASES[lower] ?? MODE_ALIASES[key.toUpperCase()];
    if (mapped && INCLUSION_MODES.includes(mapped)) return mapped;
    return null;
}

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
        case 'private_rpc_direct':
            return '⚡ Direct RPC';
        case 'private_rpc':
            return '🔒 Protect';
        case 'protected':
            return '🛡️ Protected';
        case 'builder_flashbots':
            return '📦 Builder';
        case 'builder_titan':
            return '📦 Titan';
        case 'delegation':
            return '🔗 Delegation';
        default: {
            const _exhaustive: never = mode;
            return String(_exhaustive);
        }
    }
}

export function inclusionModeLabel(mode: InclusionMode): string {
    switch (mode) {
        case 'public':
            return 'Public mempool';
        case 'private_rpc_direct':
            return 'Direct RPC blast (multi-endpoint)';
        case 'private_rpc':
            return 'Flashbots Protect (private)';
        case 'protected':
            return 'Protected (MEV Blocker anti-sandwich)';
        case 'builder_flashbots':
            return 'Builder · Flashbots';
        case 'builder_titan':
            return 'Builder · Titan';
        case 'delegation':
            return 'Delegation batch (not yet available on Telegram)';
        default: {
            const _exhaustive: never = mode;
            return String(_exhaustive);
        }
    }
}

export function isBuilderMode(mode: InclusionMode): boolean {
    return mode === 'builder_flashbots' || mode === 'builder_titan';
}

/** Modes that race eth_sendRawTransaction across multiple RPCs (MintDash-style). */
export function supportsRpcBlast(mode: InclusionMode): boolean {
    return mode === 'public' || mode === 'private_rpc_direct';
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

/**
 * Map gas-advisor tier → inclusion route.
 * FCFS tiers use Direct RPC blast (not Flashbots bundles).
 */
export function inclusionModeForGasTier(tierId?: string | null): InclusionMode {
    const id = (tierId || '').trim().toLowerCase();
    if (id === 'fcfs' || id === 'fcfs_plus' || id === 'fcfs_max' || id === 'overdrive') {
        return 'private_rpc_direct';
    }
    if (id === 'normal') return 'public';
    return getRuntimeConfig().defaultInclusionMode;
}
