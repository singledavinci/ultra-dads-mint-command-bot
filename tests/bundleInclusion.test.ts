/**
 * Bundle inclusion monitor — outcome resolution
 * Run: npx tsx tests/bundleInclusion.test.ts
 */
import assert from 'node:assert';
import { resolveBundleRunOutcome } from '../src/engine/inclusion/bundleInclusionLogic';

console.log('Test 1: resolveBundleRunOutcome missed...');
{
    assert.strictEqual(resolveBundleRunOutcome([null, null]), 'missed');
    console.log('  ✅ all null → missed');
}

console.log('Test 2: resolveBundleRunOutcome pending...');
{
    const pending = {
        blockNumber: null,
        status: 1,
    } as unknown as import('ethers').TransactionReceipt;
    assert.strictEqual(resolveBundleRunOutcome([pending]), 'pending');
    console.log('  ✅ no blockNumber → pending');
}

console.log('Test 3: resolveBundleRunOutcome confirmed...');
{
    const ok = {
        blockNumber: 1,
        status: 1,
    } as unknown as import('ethers').TransactionReceipt;
    assert.strictEqual(resolveBundleRunOutcome([ok, ok]), 'confirmed');
    console.log('  ✅ all success → confirmed');
}

console.log('Test 4: resolveBundleRunOutcome reverted...');
{
    const bad = {
        blockNumber: 1,
        status: 0,
    } as unknown as import('ethers').TransactionReceipt;
    assert.strictEqual(resolveBundleRunOutcome([bad]), 'reverted');
    console.log('  ✅ status 0 → reverted');
}

console.log('\n✅ All bundle inclusion tests passed.\n');
