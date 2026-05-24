/**
 * Phase 6 — Test: Metadata cache
 * Run: npx tsx tests/metadata-cache.test.ts
 */

import assert from 'node:assert';
import { getCachedMetadata, setCachedMetadata, pruneMetadataCache, metadataCacheSize } from '../src/services/metadataCache';

console.log('Test 1: Cache miss returns null...');
{
    const result = getCachedMetadata('0xNonExistent');
    assert.strictEqual(result, null, 'Should return null for uncached address');
    console.log('  ✅ Cache miss returns null');
}

console.log('Test 2: Cache hit returns stored data...');
{
    const addr = '0xCachedContract';
    const meta = { name: 'Test Collection', symbol: 'TC', totalSupply: '10000' };
    setCachedMetadata(addr, meta);

    const result = getCachedMetadata(addr);
    assert.deepStrictEqual(result, meta, 'Should return the cached metadata');

    // Case insensitive
    const result2 = getCachedMetadata(addr.toUpperCase());
    assert.deepStrictEqual(result2, meta, 'Should be case-insensitive');
    console.log('  ✅ Cache hit works (case-insensitive)');
}

console.log('Test 3: Cache size tracks entries...');
{
    const before = metadataCacheSize();
    setCachedMetadata('0xNewEntry1', { name: 'A', symbol: 'A', totalSupply: '1' });
    setCachedMetadata('0xNewEntry2', { name: 'B', symbol: 'B', totalSupply: '2' });
    assert(metadataCacheSize() >= before + 2, 'Size should increase');
    console.log('  ✅ Cache size tracking works');
}

console.log('Test 4: Prune does not crash...');
{
    const pruned = pruneMetadataCache();
    assert(typeof pruned === 'number', 'Should return number of pruned entries');
    console.log('  ✅ Prune runs without error');
}

console.log('\n✅ All metadata cache tests passed.\n');
