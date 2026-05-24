/**
 * Phase 6 — Test: Deduplicator (tx hash + execution lock)
 * Run: npx tsx tests/deduplicator.test.ts
 */

import assert from 'node:assert';
import {
    isDuplicateTx,
    markTxSeenIfNew,
    wasSeen,
    tryAcquireExecutionLock,
    releaseExecutionLock,
    getDedupeStats,
} from '../src/services/deduplicator';

console.log('Test 1: TX hash deduplication...');
{
    const hash = '0xabc123def456789012345678901234567890123456789012345678901234abcd';
    assert(!isDuplicateTx(hash, 'pending'), 'First call should return false (not duplicate)');
    assert(isDuplicateTx(hash, 'confirmed'), 'Second call should return true (duplicate)');
    assert(isDuplicateTx(hash.toUpperCase(), 'confirmed'), 'Case-insensitive match');

    const hash2 = '0x1111111111111111111111111111111111111111111111111111111111111111';
    assert(!isDuplicateTx(hash2, 'pending'), 'Different hash should not be duplicate');
    console.log('  ✅ TX deduplication works');
}

console.log('Test 2: markTxSeenIfNew atomic claim...');
{
    const hash = '0x3333333333333333333333333333333333333333333333333333333333333333';
    assert(markTxSeenIfNew(hash, 'pending'), 'First claim succeeds');
    assert(!markTxSeenIfNew(hash, 'confirmed'), 'Second claim is duplicate');
    console.log('  ✅ markTxSeenIfNew works');
}

console.log('Test 3: wasSeen (non-marking check)...');
{
    const hash = '0x2222222222222222222222222222222222222222222222222222222222222222';
    assert(!wasSeen(hash), 'Should not be seen before marking');
    isDuplicateTx(hash, 'pending'); // Mark it
    assert(wasSeen(hash), 'Should be seen after marking');
    console.log('  ✅ wasSeen works');
}

console.log('Test 4: Execution lock...');
{
    const contract = '0xContractAddress123';
    assert(tryAcquireExecutionLock(contract), 'First acquire should succeed');
    assert(!tryAcquireExecutionLock(contract), 'Second acquire should fail (locked)');

    releaseExecutionLock(contract);
    assert(tryAcquireExecutionLock(contract), 'After release, acquire should succeed again');
    releaseExecutionLock(contract);
    console.log('  ✅ Execution lock works');
}

console.log('Test 5: Tracker path (wasSeen in tracker, mark in handler)...');
{
    const hash = '0x4444444444444444444444444444444444444444444444444444444444444444';
    assert(!wasSeen(hash), 'Tracker should not see tx yet');
    assert(!isDuplicateTx(hash, 'pending'), 'Handler marks on first process');
    assert(wasSeen(hash), 'Tracker sees marked tx');
    assert(isDuplicateTx(hash, 'confirmed'), 'Handler rejects duplicate');
    console.log('  ✅ Tracker/handler dedupe flow works');
}

console.log('Test 6: Per-tx execution lock (same contract, different whales)...');
{
    const contract = '0x4a1A2E529122ae2C27aBaaCfA86FD5d2A256B0A7';
    const txA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const txB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    assert(tryAcquireExecutionLock(contract, txA), 'Whale A tx should acquire');
    assert(tryAcquireExecutionLock(contract, txB), 'Whale B tx on same contract should acquire');
    assert(!tryAcquireExecutionLock(contract, txA), 'Duplicate whale A tx should be locked');
    releaseExecutionLock(contract, txA);
    releaseExecutionLock(contract, txB);
    console.log('  ✅ Per-tx execution lock works');
}

console.log('Test 7: Stats...');
{
    const stats = getDedupeStats();
    assert(typeof stats.size === 'number', 'size should be a number');
    assert(typeof stats.locksActive === 'number', 'locksActive should be a number');
    assert(stats.size >= 4, 'Should have at least 4 entries from previous tests');
    console.log('  ✅ Stats work');
}

console.log('\n✅ All deduplicator tests passed.\n');
