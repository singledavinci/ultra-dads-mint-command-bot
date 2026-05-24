/**
 * Partial bundle regen helpers
 * Run: npx tsx tests/partialBundleRegen.test.ts
 */

import assert from 'node:assert';
import {
    dropPlanAtIndex,
    parseFailedBundleTxIndex,
    simulationIndexToPlanIndex,
} from '../src/services/partialBundleRegen';

console.log('Test 1: parse tx index from Flashbots error...');
{
    assert.strictEqual(parseFailedBundleTxIndex('tx[2]: execution reverted'), 2);
    assert.strictEqual(parseFailedBundleTxIndex('ok'), null);
    console.log('  ✅ parse index');
}

console.log('Test 2: drop plan at index...');
{
    const plans = [
        { walletAddress: '0xaaaa', walletIndex: 0 },
        { walletAddress: '0xbbbb', walletIndex: 1 },
    ] as import('../src/types/copyMint').WalletExecutionPlan[];
    const { kept, dropped } = dropPlanAtIndex(plans, 0);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(dropped?.walletAddress, '0xaaaa');
    console.log('  ✅ drop');
}

console.log('Test 3: simulation index with coinbase tip last...');
{
    assert.strictEqual(simulationIndexToPlanIndex(1, 2, true), 1);
    assert.strictEqual(simulationIndexToPlanIndex(2, 2, true), null);
    console.log('  ✅ tip index guard');
}

console.log('\n✅ All partial bundle regen tests passed.\n');
