/**
 * Scatter.art mint helpers
 * Run: npx tsx tests/scatterMint.test.ts
 */

import assert from 'node:assert';
import {
    chainIdToSlug,
    extractScatterSlug,
    orderScatterListsForMint,
    pickBestScatterList,
    type ScatterInviteList,
} from '../src/services/scatterMint';

console.log('Test 1: extractScatterSlug...');
assert.strictEqual(extractScatterSlug('https://scatter.art/collection/tribe-of-girl'), 'tribe-of-girl');
assert.strictEqual(
    extractScatterSlug('https://www.scatter.art/collection/threadborne'),
    'threadborne'
);
assert.strictEqual(extractScatterSlug('scatter.art/collection/my-drop_1'), 'my-drop_1');
assert.strictEqual(extractScatterSlug('https://opensea.io/collection/foo'), null);
console.log('  ✅ slug extraction');

console.log('Test 2: pickBestScatterList prefers free before paid (Threadborne-style)...');
const threadborneLists: ScatterInviteList[] = [
    { id: 'free', name: 'Free Mint', token_price: '0', wallet_limit: 1, list_limit: 400 },
    { id: 'paid', name: 'Threadborne Mint', token_price: '0.0088', wallet_limit: 2, list_limit: 999 },
];
const pickedTb = pickBestScatterList(threadborneLists);
assert(pickedTb);
assert.strictEqual(pickedTb!.id, 'free');
const ordered = orderScatterListsForMint(threadborneLists);
assert.strictEqual(ordered[0]?.id, 'free');
console.log('  ✅ free list preferred');

console.log('Test 2c: pickBestScatterList free-only when no paid...');
const lists: ScatterInviteList[] = [
    { id: 'a', name: 'VIP', token_price: '0.1', wallet_limit: 1, list_limit: 100 },
    { id: 'b', name: 'Public', token_price: '0.02', wallet_limit: 5, list_limit: 1000 },
];
const picked = pickBestScatterList(lists);
assert(picked);
assert.strictEqual(picked!.id, 'b');
console.log('  ✅ list picker');

console.log('Test 2b: inactive future list excluded...');
const futureOnly = pickBestScatterList([
    {
        id: 'x',
        name: 'Soon',
        token_price: '0',
        start_time: '2099-06-01T00:00:00.000Z',
        end_time: null,
        wallet_limit: 1,
        list_limit: 1,
    },
]);
assert.strictEqual(futureOnly, null);
console.log('  ✅ future list skipped');

console.log('Test 3: chainIdToSlug...');
assert.strictEqual(chainIdToSlug(1), 'ethereum');
assert.strictEqual(chainIdToSlug(8453), 'base');
console.log('  ✅ chain mapping');

console.log('\n✅ All Scatter mint tests passed.\n');
