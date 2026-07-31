/**
 * Inclusion router + bundle helpers
 * Run: npx tsx tests/inclusion.test.ts
 */
import assert from 'node:assert';
import { orderBundleTxs } from '../src/services/bundleAssembler';
import { applyPriorityBoostToPlan, priorityBoostWeiFromEth } from '../src/services/builderPayment';
import { validateBundleBudget } from '../src/services/bundleBudget';
import {
    inclusionModeForGasTier,
    inclusionModeFromState,
    isBuilderMode,
    parseInclusionMode,
    resolveInclusionMode,
    supportsRpcBlast,
} from '../src/utils/inclusionMode';
import type { SignedBundleTx } from '../src/types/inclusion';
import type { WalletExecutionPlan } from '../src/types/copyMint';

console.log('Test 1: resolveInclusionMode legacy mevProtection...');
{
    assert.strictEqual(resolveInclusionMode({ mevProtection: true }), 'protected');
    assert.strictEqual(resolveInclusionMode({ inclusionMode: 'builder_flashbots' }), 'builder_flashbots');
    assert.strictEqual(resolveInclusionMode({}), 'public');
    console.log('  ✅ legacy + explicit modes');
}

console.log('Test 2: inclusionModeFromState migration...');
{
    assert.strictEqual(inclusionModeFromState({ mevProtection: true }), 'protected');
    assert.strictEqual(inclusionModeFromState({ inclusionMode: 'public', mevProtection: true }), 'public');
    console.log('  ✅ state migration');
}

console.log('Test 3: isBuilderMode + MintDash aliases...');
{
    assert.strictEqual(isBuilderMode('builder_flashbots'), true);
    assert.strictEqual(isBuilderMode('public'), false);
    assert.strictEqual(parseInclusionMode('PRIVATE_RPC_DIRECT'), 'private_rpc_direct');
    assert.strictEqual(parseInclusionMode('direct'), 'private_rpc_direct');
    assert.strictEqual(parseInclusionMode('PRIVATE_RPC'), 'private_rpc');
    assert.strictEqual(parseInclusionMode('FLASHBOTS_BUNDLE'), 'builder_flashbots');
    assert.strictEqual(parseInclusionMode('DELEGATION_CONTRACT'), 'delegation');
    assert.strictEqual(supportsRpcBlast('private_rpc_direct'), true);
    assert.strictEqual(supportsRpcBlast('private_rpc'), false);
    assert.strictEqual(inclusionModeForGasTier('fcfs_plus'), 'private_rpc_direct');
    assert.strictEqual(inclusionModeForGasTier('normal'), 'public');
    console.log('  ✅ builder + aliases + blast gates');
}

console.log('Test 4: orderBundleTxs nonce ordering...');
{
    const txs: SignedBundleTx[] = [
        { signedTx: '0x2', walletAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nonce: 2 },
        { signedTx: '0x1', walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nonce: 1 },
        { signedTx: '0x3', walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nonce: 0 },
    ];
    const ordered = orderBundleTxs(txs);
    assert.deepStrictEqual(ordered, ['0x3', '0x1', '0x2']);
    console.log('  ✅ address then nonce sort');
}

console.log('Test 5: priority boost cap...');
{
    const tip = priorityBoostWeiFromEth(0.5);
    assert(tip <= 50_000_000_000_000_000n, 'boost capped at MAX_BUILDER_TIP_ETH (default 0.05)');
    console.log('  ✅ boost cap');
}

console.log('Test 6: applyPriorityBoostToPlan raises priority fee...');
{
    const boosted = applyPriorityBoostToPlan(
        {
            gasLimit: 100_000n,
            maxFeePerGas: 50_000_000_000n,
            maxPriorityFeePerGas: 1_000_000_000n,
        },
        1_000_000_000_000_000n
    );
    assert(boosted.maxPriorityFeePerGas > 1_000_000_000n);
    console.log('  ✅ priority boost applied to mint tx');
}

console.log('Test 7: bundle budget rejects over cap...');
{
    const plan = {
        walletIndex: 0,
        walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        maskedWalletAddress: '0xaaaa…aaaa',
        privateKey: '0x' + '11'.repeat(32),
        nonce: 0,
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        data: '0x',
        value: '0',
        gasLimit: 200_000n,
        maxFeePerGas: 100_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
        requiredBalance: 0n,
        balance: 10n ** 20n,
        shortage: 0n,
        canBroadcast: true,
        warnings: [],
    } as WalletExecutionPlan;

    const many = Array.from({ length: 25 }, (_, i) => ({
        ...plan,
        walletIndex: i,
        walletAddress: `0x${String(i).padStart(40, '0')}`,
    }));

    const result = validateBundleBudget({ plans: many, priorityBoostWei: 0n });
    assert.strictEqual(result.ok, false);
    console.log('  ✅ budget gate');
}

console.log('Test 8: builder empty-broadcastable must not recurse via broadcastPlan...');
{
    const source = await import('node:fs').then(fs =>
        fs.readFileSync(new URL('../src/engine/inclusion/InclusionRouter.ts', import.meta.url), 'utf8')
    );
    assert(
        source.includes("No broadcastable wallets for builder bundle"),
        'builder empty path must short-circuit without re-entering broadcastPlan'
    );
    assert(
        source.includes('if (!plan.canBroadcast)'),
        'broadcastPlan must skip non-broadcastable plans before builder single'
    );
    console.log('  ✅ recursion guards present');
}

console.log('All inclusion tests passed.');
