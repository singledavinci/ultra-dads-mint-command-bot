/**
 * Simulation cache keys must vary with calldata (shared routers).
 * Run: npx tsx tests/simulationCache.test.ts
 */

import assert from 'node:assert';
import { findCachedByContract, getCachedSimulation, setCachedSimulation } from '../src/services/simulationCache';

const ROUTER = '0x0000000000664ceffed39244a8312556a900b938';
const DATA_A =
    '0x51061988' +
    '000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' +
    '0000000000000000000000000000000000000000000000000000000000000001';
const DATA_B =
    '0x51061988' +
    '000000000000000000000000cccccccccccccccccccccccccccccccccccccccc' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000000dddddddddddddddddddddddddddddddddddddddd' +
    '0000000000000000000000000000000000000000000000000000000000000001';

console.log('Test: distinct cache entries per whale calldata...');

setCachedSimulation(ROUTER, DATA_A, {
    selector: '0x51061988',
    data: DATA_A,
    value: '0x1',
    quantity: 1,
});
setCachedSimulation(ROUTER, DATA_B, {
    selector: '0x51061988',
    data: DATA_B,
    value: '0x2',
    quantity: 2,
});

const hitA = getCachedSimulation(ROUTER, DATA_A);
const hitB = getCachedSimulation(ROUTER, DATA_B);
assert(hitA && hitA.quantity === 1 && hitA.value === '0x1');
assert(hitB && hitB.quantity === 2 && hitB.value === '0x2');

console.log('  ✅ Router + calldata composite key works');

console.log('Test: findCachedByContract...');
const NFT = '0x839c86d5357de31189d334b9f0ecd83872db11e95';
setCachedSimulation(NFT, DATA_A, {
    selector: '0xa0712d68',
    data: DATA_A,
    value: '0x5',
    quantity: 1,
});
const byContract = findCachedByContract(NFT);
assert(byContract && byContract.value === '0x5', 'contract index should resolve');

console.log('  ✅ Contract index lookup works\n');
console.log('✅ All simulation cache tests passed.\n');
