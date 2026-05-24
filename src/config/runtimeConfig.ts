/**
 * Centralized runtime configuration for the copy-mint engine.
 * Values are read from environment variables with safe mainnet defaults.
 */

import { resolveTrackerWsUrl, splitRpcUrls } from './rpcEndpoints.js';
import type { InclusionMode } from '../types/inclusion';

export interface RuntimeConfig {
    // Detection
    enablePendingDetection: boolean;
    enableBlockFallback: boolean;
    pendingTxLookupLimitPerSecond: number;
    blockFallbackAlwaysOn: boolean;
    trackerBootGraceMs: number;
    trackerMaxPendingRpcPerSec: number;
    trackerMaxPendingConcurrent: number;

    // RPC
    providerUrls: string[];
    backupRpcUrls: string[];
    wsRpcUrl?: string;
    backupWsRpcUrls: string[];
    rpcReadsPerSecond: number;
    rpcBurstLimit: number;
    rpcRetryAttempts: number;
    rpcRetryBaseMs: number;
    broadcastToMultipleRpcs: boolean;
    feeDataCacheTtlMs: number;
    contractCodeCacheTtlMs: number;
    simulationCacheTtlMs: number;

    // Execution
    executionConcurrency: number;
    preflightConcurrency: number;
    simulationConcurrency: number;
    automintUserConcurrency: number;
    globalMintUserConcurrency: number;
    maxWalletsPerExecution: number;
    canaryWalletMode: boolean;
    canaryWalletCount: number;
    perSourceTxCooldownMs: number;
    dedupeTtlMs: number;
    useCopyMintEngine: boolean;
    useLegacyMintCore: boolean;

    // Safety
    maxMintEth: number;
    maxTotalBatchEth: number;
    copyUnknownMintCalls: boolean;
    requireKnownSelector: boolean;
    blindBroadcastEnabled: boolean;
    blindBroadcastMaxValueEth: number;
    blindBroadcastMaxWallets: number;
    minWalletBufferEth: number;

    // Gas
    gasMode: 'normal' | 'mirror' | 'overdrive' | 'fixed';
    overdriveGas: boolean;
    normalGasMultiplier: number;
    mirrorSourceGasThreshold: number;
    maxFeeGwei: number;
    maxPriorityFeeGwei: number;
    overdriveMaxFeeGwei: number;
    overdrivePriorityFeeGwei: number;
    gasLimitMultiplier: number;
    fallbackGasAllowed: boolean;
    fallbackGasLimit: number;
    /** Skip per-wallet estimateGas + balance RPC in preflight (avoids 429s). */
    skipRpcPreflight: boolean;
    /** When skipRpcPreflight: use network gasPrice without multiplier bumps. */
    baseGasOnly: boolean;
    /** Fixed gas limit when skipRpcPreflight (no estimateGas). */
    fastGasLimit: number;
    /** Preflight + broadcast wallet #1 before remaining wallets (lower first-tx latency). */
    streamBroadcast: boolean;

    // Inclusion (builder bundles + MEV Blocker)
    defaultInclusionMode: InclusionMode;
    builderMintEnabled: boolean;
    flashbotsRelayUrl: string;
    flashbotsProtectRpc: string;
    flashbotsAuthPrivateKey?: string;
    titanRelayUrl?: string;
    builderMaxTxsPerBundle: number;
    builderSubmitTimeoutMs: number;
    /** Default per-wallet priority boost budget (ETH equiv.) — EIP-1559 only */
    builderDefaultTipEth: number;
    /** Max per-wallet priority boost budget (ETH equiv.) */
    maxBuilderTipEth: number;
    maxTotalBundleEth: number;
    builderMaxTargetBlocks: number;
    builderSecondaryRelayFallback: boolean;
    builderAllowPublicFallback: boolean;
    builderInclusionPollMs: number;
    builderInclusionGraceBlocks: number;
    /** Drop sim-failing wallets and retry (v2) */
    builderPartialBundleRegen: boolean;
    /** Submit via mev_sendBundle (MEV-Share format) instead of eth_sendBundle */
    builderUseMevSendBundle: boolean;
    /** Optional builder names for mev_sendBundle privacy.builders */
    builderMevShareBuilders?: string[];
    /** Audited helper that forwards ETH to block.coinbase */
    builderCoinbaseContract?: string;
    /** Calldata for coinbase helper (default 0x payable) */
    builderCoinbaseCalldata?: string;

    // Confirmation
    txWaitTimeoutMs: number;
    confirmationBlocks: number;
    droppedTxCheckMs: number;
    pendingReconcileIntervalMs: number;
}

function readBool(name: string, fallback: boolean): boolean {
    const v = process.env[name];
    if (v === undefined || v === '') return fallback;
    return /^(1|true|yes|on)$/i.test(v.trim());
}

function readInt(name: string, fallback: number, min = 0): number {
    const v = process.env[name];
    if (!v) return fallback;
    const n = parseInt(v, 10);
    return Number.isNaN(n) || n < min ? fallback : n;
}

function readFloat(name: string, fallback: number): number {
    const v = process.env[name];
    if (!v) return fallback;
    const n = parseFloat(v);
    return Number.isNaN(n) ? fallback : n;
}

function splitUrls(raw?: string): string[] {
    if (!raw?.trim()) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function readInclusionMode(name: string, fallback: InclusionMode): InclusionMode {
    const v = process.env[name]?.trim().toLowerCase();
    if (v === 'public' || v === 'protected' || v === 'builder_flashbots' || v === 'builder_titan') {
        return v;
    }
    return fallback;
}

function readGlobalMintUserConcurrency(): number {
    const globalRaw = process.env.GLOBAL_MINT_USER_CONCURRENCY;
    if (globalRaw?.trim()) {
        return readInt('GLOBAL_MINT_USER_CONCURRENCY', 8, 1);
    }
    const automintRaw = process.env.AUTOMINT_USER_CONCURRENCY;
    if (automintRaw?.trim()) {
        return readInt('AUTOMINT_USER_CONCURRENCY', 4, 1);
    }
    return 8;
}

let cached: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
    if (cached) return cached;

    const providerUrls = splitRpcUrls(process.env.PROVIDER_URL);
    const backupRpcUrls = splitRpcUrls(process.env.BACKUP_RPC_URLS);
    const trackerWs = resolveTrackerWsUrl();

    cached = {
        enablePendingDetection: readBool('ENABLE_PENDING_DETECTION', Boolean(trackerWs)),
        enableBlockFallback: readBool('ENABLE_BLOCK_FALLBACK', true),
        pendingTxLookupLimitPerSecond: readInt('TRACKER_MAX_PENDING_RPC_PER_SEC', readInt('PENDING_TX_LOOKUP_LIMIT_PER_SECOND', 8, 1), 1),
        blockFallbackAlwaysOn: readBool('BLOCK_FALLBACK_ALWAYS_ON', true),
        trackerBootGraceMs: readInt('TRACKER_BOOT_GRACE_MS', 5000, 0),
        trackerMaxPendingRpcPerSec: readInt('TRACKER_MAX_PENDING_RPC_PER_SEC', 8, 1),
        trackerMaxPendingConcurrent: readInt('TRACKER_MAX_PENDING_CONCURRENT', 6, 1),

        providerUrls,
        backupRpcUrls,
        wsRpcUrl: trackerWs,
        backupWsRpcUrls: splitRpcUrls(process.env.BACKUP_WS_RPC_URLS),
        rpcReadsPerSecond: readInt('RPC_READS_PER_SECOND', 10, 1),
        rpcBurstLimit: readInt('RPC_BURST_LIMIT', 15, 1),
        rpcRetryAttempts: readInt('RPC_RETRY_ATTEMPTS', 4, 1),
        rpcRetryBaseMs: readInt('RPC_RETRY_BASE_MS', 400, 50),
        broadcastToMultipleRpcs: readBool('BROADCAST_TO_MULTIPLE_RPCS', false),
        feeDataCacheTtlMs: readInt('FEE_DATA_CACHE_TTL_MS', 3000, 500),
        contractCodeCacheTtlMs: readInt('CONTRACT_CODE_CACHE_TTL_MS', 300_000, 10_000),
        simulationCacheTtlMs: readInt('SIMULATION_CACHE_TTL_MS', 300_000, 10_000),

        executionConcurrency: readInt('EXECUTION_CONCURRENCY', 4, 1),
        preflightConcurrency: readInt('PREFLIGHT_CONCURRENCY', 4, 1),
        simulationConcurrency: readInt('SIMULATION_CONCURRENCY', 4, 1),
        automintUserConcurrency: readInt('AUTOMINT_USER_CONCURRENCY', 4, 1),
        globalMintUserConcurrency: readGlobalMintUserConcurrency(),
        maxWalletsPerExecution: readInt('MAX_WALLETS_PER_EXECUTION', 5, 1),
        canaryWalletMode: readBool('CANARY_WALLET_MODE', false),
        canaryWalletCount: readInt('CANARY_WALLET_COUNT', 1, 1),
        perSourceTxCooldownMs: readInt('PER_SOURCE_TX_COOLDOWN_MS', 300_000, 0),
        dedupeTtlMs: readInt('DEDUPE_TTL_MS', 300_000, 10_000),
        useCopyMintEngine: readBool('USE_COPY_MINT_ENGINE', true),
        useLegacyMintCore: readBool('USE_LEGACY_MINT_CORE', false),

        maxMintEth: readFloat('MAX_MINT_ETH', 0.05),
        maxTotalBatchEth: readFloat('MAX_TOTAL_BATCH_ETH', 0.25),
        ...(() => {
            const universal = readBool('UNIVERSAL_MINT_MODE', false);
            const copyUnknown =
                universal || readBool('COPY_UNKNOWN_MINT_CALLS', false);
            const requireKnown = universal
                ? false
                : readBool('REQUIRE_KNOWN_SELECTOR', true);
            return {
                copyUnknownMintCalls: copyUnknown,
                requireKnownSelector: requireKnown,
            };
        })(),
        blindBroadcastEnabled: readBool('BLIND_BROADCAST_ENABLED', false),
        blindBroadcastMaxValueEth: readFloat('BLIND_BROADCAST_MAX_VALUE_ETH', 0.01),
        blindBroadcastMaxWallets: readInt('BLIND_BROADCAST_MAX_WALLETS', 1, 1),
        minWalletBufferEth: readFloat('MIN_WALLET_BUFFER_ETH', 0.0001),

        gasMode: (process.env.GAS_MODE?.toLowerCase() as RuntimeConfig['gasMode']) || 'normal',
        overdriveGas: readBool('OVERDRIVE_GAS', false),
        normalGasMultiplier: readFloat('NORMAL_GAS_MULTIPLIER', 1.15),
        mirrorSourceGasThreshold: readFloat('MIRROR_SOURCE_GAS_THRESHOLD', 1.5),
        maxFeeGwei: readFloat('MAX_FEE_GWEI', 80),
        maxPriorityFeeGwei: readFloat('MAX_PRIORITY_FEE_GWEI', 5),
        overdriveMaxFeeGwei: readFloat('OVERDRIVE_MAX_FEE_GWEI', 150),
        overdrivePriorityFeeGwei: readFloat('OVERDRIVE_PRIORITY_FEE_GWEI', 15),
        gasLimitMultiplier: readFloat('GAS_LIMIT_MULTIPLIER', 1.25),
        fallbackGasAllowed: readBool('FALLBACK_GAS_ALLOWED', false),
        fallbackGasLimit: readInt('FALLBACK_GAS_LIMIT', 120_000, 21_000),
        skipRpcPreflight: readBool('SKIP_RPC_PREFLIGHT', true),
        baseGasOnly: readBool('BASE_GAS_ONLY', true),
        fastGasLimit: readInt('FAST_GAS_LIMIT', 150_000, 21_000),
        streamBroadcast: readBool('STREAM_BROADCAST', true),

        defaultInclusionMode: readInclusionMode('DEFAULT_INCLUSION_MODE', 'public'),
        builderMintEnabled: readBool('BUILDER_MINT_ENABLED', false),
        flashbotsRelayUrl:
            process.env.FLASHBOTS_RELAY_URL?.trim() || 'https://relay.flashbots.net',
        flashbotsProtectRpc:
            process.env.FLASHBOTS_PROTECT_RPC?.trim() || 'https://rpc.flashbots.net/fast',
        flashbotsAuthPrivateKey: process.env.FLASHBOTS_AUTH_PRIVATE_KEY?.trim() || undefined,
        titanRelayUrl: process.env.TITAN_RELAY_URL?.trim() || undefined,
        builderMaxTxsPerBundle: readInt('BUILDER_MAX_TXS_PER_BUNDLE', 20, 1),
        builderSubmitTimeoutMs: readInt('BUILDER_SUBMIT_TIMEOUT_MS', 12_000, 1000),
        builderDefaultTipEth: readFloat('BUILDER_COINBASE_TIP_ETH', 0.01),
        maxBuilderTipEth: readFloat('MAX_BUILDER_TIP_ETH', 0.05),
        maxTotalBundleEth: readFloat('MAX_TOTAL_BUNDLE_ETH', 0.5),
        builderMaxTargetBlocks: readInt('BUILDER_MAX_TARGET_BLOCKS', 2, 1),
        builderSecondaryRelayFallback: readBool('BUILDER_SECONDARY_RELAY_FALLBACK', false),
        builderAllowPublicFallback: readBool('BUILDER_ALLOW_PUBLIC_FALLBACK', false),
        builderInclusionPollMs: readInt('BUILDER_INCLUSION_POLL_MS', 1500, 200),
        builderInclusionGraceBlocks: readInt('BUILDER_INCLUSION_GRACE_BLOCKS', 5, 1),
        builderPartialBundleRegen: readBool('BUILDER_PARTIAL_BUNDLE_REGEN', true),
        builderUseMevSendBundle: readBool('BUILDER_USE_MEV_SEND_BUNDLE', false),
        builderMevShareBuilders: splitUrls(process.env.BUILDER_MEV_SHARE_BUILDERS),
        builderCoinbaseContract: process.env.BUILDER_COINBASE_CONTRACT?.trim() || undefined,
        builderCoinbaseCalldata: process.env.BUILDER_COINBASE_CALLDATA?.trim() || undefined,

        txWaitTimeoutMs: readInt('TX_WAIT_TIMEOUT_MS', 60_000, 5_000),
        confirmationBlocks: readInt('CONFIRMATION_BLOCKS', 1, 1),
        droppedTxCheckMs: readInt('DROPPED_TX_CHECK_MS', 90_000, 10_000),
        pendingReconcileIntervalMs: readInt('PENDING_RECONCILE_INTERVAL_MS', 30_000, 5_000),
    };

    return cached;
}

/** Mask address for logs and Telegram. */
export function maskAddress(addr: string): string {
    if (!addr || addr.length < 12) return '0x????';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Clear cached config (tests only). */
export function resetRuntimeConfigForTests(): void {
    cached = null;
}

/** Mask RPC URL for API responses. */
export function maskRpcUrl(url: string): string {
    try {
        const u = new URL(url.split(',')[0]);
        return `${u.protocol}//${u.hostname}/***`;
    } catch {
        return '<rpc>';
    }
}
