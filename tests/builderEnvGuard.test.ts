/**
 * Builder environment guard
 * Run: npx tsx tests/builderEnvGuard.test.ts
 */
import assert from 'node:assert';
import { checkBuilderEnvironment } from '../src/services/builderEnvGuard';
import type { RuntimeConfig } from '../src/config/runtimeConfig';

function baseCfg(overrides: Partial<RuntimeConfig>): RuntimeConfig {
    return {
        enablePendingDetection: true,
        enableBlockFallback: true,
        pendingTxLookupLimitPerSecond: 5,
        blockFallbackAlwaysOn: true,
        trackerBootGraceMs: 5000,
        trackerMaxPendingRpcPerSec: 8,
        trackerMaxPendingConcurrent: 6,
        providerUrls: ['http://localhost'],
        backupRpcUrls: [],
        backupWsRpcUrls: [],
        rpcReadsPerSecond: 10,
        rpcBurstLimit: 20,
        rpcRetryAttempts: 3,
        rpcRetryBaseMs: 100,
        broadcastToMultipleRpcs: false,
        feeDataCacheTtlMs: 1000,
        contractCodeCacheTtlMs: 1000,
        simulationCacheTtlMs: 1000,
        executionConcurrency: 1,
        preflightConcurrency: 1,
        simulationConcurrency: 1,
        automintUserConcurrency: 4,
        globalMintUserConcurrency: 8,
        maxWalletsPerExecution: 10,
        canaryWalletMode: false,
        canaryWalletCount: 1,
        perSourceTxCooldownMs: 0,
        dedupeTtlMs: 60000,
        useCopyMintEngine: true,
        useLegacyMintCore: false,
        maxMintEth: 0.05,
        maxTotalBatchEth: 0.25,
        copyUnknownMintCalls: false,
        requireKnownSelector: true,
        blindBroadcastEnabled: false,
        blindBroadcastMaxValueEth: 0,
        blindBroadcastMaxWallets: 0,
        minWalletBufferEth: 0.001,
        gasMode: 'normal',
        overdriveGas: false,
        normalGasMultiplier: 1.1,
        mirrorSourceGasThreshold: 0,
        maxFeeGwei: 100,
        maxPriorityFeeGwei: 10,
        overdriveMaxFeeGwei: 150,
        overdrivePriorityFeeGwei: 15,
        gasLimitMultiplier: 1.15,
        fallbackGasAllowed: false,
        fallbackGasLimit: 120000,
        skipRpcPreflight: true,
        baseGasOnly: true,
        fastGasLimit: 150000,
        streamBroadcast: true,
        defaultInclusionMode: 'public',
        builderMintEnabled: false,
        flashbotsRelayUrl: 'https://relay.flashbots.net',
        flashbotsProtectRpc: 'https://rpc.flashbots.net/fast',
        builderMaxTxsPerBundle: 20,
        builderSubmitTimeoutMs: 12000,
        builderDefaultTipEth: 0.01,
        maxBuilderTipEth: 0.05,
        maxTotalBundleEth: 0.5,
        builderMaxTargetBlocks: 2,
        builderSecondaryRelayFallback: false,
        builderAllowPublicFallback: false,
        builderInclusionPollMs: 1500,
        builderInclusionGraceBlocks: 5,
        builderPartialBundleRegen: true,
        builderUseMevSendBundle: false,
        txWaitTimeoutMs: 60000,
        confirmationBlocks: 1,
        droppedTxCheckMs: 90000,
        pendingReconcileIntervalMs: 30000,
        ...overrides,
    };
}

console.log('Test 1: builder off → no errors...');
{
    const r = checkBuilderEnvironment(baseCfg({ builderMintEnabled: false }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.errors.length, 0);
    console.log('  ✅ skipped when disabled');
}

console.log('Test 2: builder on without auth key → error...');
{
    const r = checkBuilderEnvironment(
        baseCfg({ builderMintEnabled: true, flashbotsAuthPrivateKey: undefined })
    );
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('FLASHBOTS_AUTH_PRIVATE_KEY')));
    console.log('  ✅ missing auth flagged');
}

console.log('Test 3: public fallback → warning...');
{
    const r = checkBuilderEnvironment(
        baseCfg({
            builderMintEnabled: true,
            flashbotsAuthPrivateKey: '0x' + '11'.repeat(32),
            builderAllowPublicFallback: true,
        })
    );
    assert.strictEqual(r.ok, true);
    assert.ok(r.warnings.some(w => w.includes('PUBLIC_FALLBACK')));
    console.log('  ✅ fallback warned');
}

console.log('\n✅ All builder env guard tests passed.\n');
