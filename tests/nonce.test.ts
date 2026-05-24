/**
 * Phase 6 — Test: Nonce manager (v2 with reserve/confirm/reset)
 * Run: npx tsx tests/nonce.test.ts
 */

import assert from 'node:assert';
import { reserveNonce, confirmNonce, resetNonce, handleNonceError, getNonceState, pruneStaleNonces } from '../src/services/nonceManager';

console.log('Test 1: Nonce reservation increments...');
{
    const addr = '0xTestWallet1';
    const n1 = reserveNonce(addr, 5);
    assert.strictEqual(n1, 5, 'First reservation should return the RPC nonce');

    const n2 = reserveNonce(addr, 5);
    assert.strictEqual(n2, 6, 'Second reservation should increment past cached');

    const n3 = reserveNonce(addr, 5);
    assert.strictEqual(n3, 7, 'Third reservation should continue incrementing');
    console.log('  ✅ Nonce increments correctly');
}

console.log('Test 2: RPC nonce catches up...');
{
    const addr = '0xTestWallet2';
    reserveNonce(addr, 10);
    reserveNonce(addr, 10);
    // Now cache is at 12. If RPC reports 15, we should use 15.
    const n = reserveNonce(addr, 15);
    assert.strictEqual(n, 15, 'Should use RPC nonce when it is higher than cache');
    console.log('  ✅ RPC nonce takes precedence when higher');
}

console.log('Test 3: Reset clears cache...');
{
    const addr = '0xTestWallet3';
    reserveNonce(addr, 20);
    reserveNonce(addr, 20); // cache at 22
    resetNonce(addr);
    const n = reserveNonce(addr, 20);
    assert.strictEqual(n, 20, 'After reset, should use RPC nonce again');
    console.log('  ✅ Reset works');
}

console.log('Test 4: confirmNonce updates state...');
{
    const addr = '0xTestWallet4';
    reserveNonce(addr, 30);
    confirmNonce(addr, 30);
    const state = getNonceState(addr);
    assert(state !== null, 'State should exist');
    assert.strictEqual(state!.lastConfirmed, 30, 'lastConfirmed should be 30');
    console.log('  ✅ confirmNonce works');
}

console.log('Test 5: handleNonceError resets on nonce-too-low...');
{
    const addr = '0xTestWallet5';
    reserveNonce(addr, 40);
    reserveNonce(addr, 40); // cache at 42
    handleNonceError(addr, 'nonce too low');
    const state = getNonceState(addr);
    assert(state === null, 'State should be cleared after nonce error');
    console.log('  ✅ handleNonceError resets correctly');
}

console.log('Test 6: handleNonceError ignores non-nonce errors...');
{
    const addr = '0xTestWallet6';
    reserveNonce(addr, 50);
    handleNonceError(addr, 'insufficient funds');
    const state = getNonceState(addr);
    assert(state !== null, 'State should NOT be cleared for non-nonce errors');
    console.log('  ✅ Non-nonce errors do not reset');
}

console.log('Test 7: Prune stale entries...');
{
    const pruned = pruneStaleNonces();
    assert(typeof pruned === 'number', 'pruneStaleNonces should return a number');
    console.log('  ✅ pruneStaleNonces runs without error');
}

console.log('\n✅ All nonce manager tests passed.\n');
