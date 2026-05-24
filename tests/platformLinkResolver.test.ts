/**
 * Platform URL → contract resolution
 * Run: npx tsx tests/platformLinkResolver.test.ts
 */

import assert from 'node:assert';
import { resolvePlatformContractFromUrl } from '../src/services/platformLinkResolver';

console.log('Test 1: Zora collect URL (Ethereum only)...');
const zoraEth = resolvePlatformContractFromUrl(
    'https://zora.co/collect/ethereum:0x1234567890123456789012345678901234567890'
);
assert(zoraEth);
assert.strictEqual(zoraEth!.platform, 'zora');
assert.strictEqual(zoraEth!.chainSlug, 'ethereum');
console.log('  ✅ Zora ETH');

const zoraEthShort = resolvePlatformContractFromUrl(
    'https://zora.co/collect/eth:0x1234567890123456789012345678901234567890'
);
assert(zoraEthShort);
assert.strictEqual(zoraEthShort!.platform, 'zora');
console.log('  ✅ Zora eth: prefix');

const zoraBase = resolvePlatformContractFromUrl(
    'https://zora.co/collect/base:0x1234567890123456789012345678901234567890'
);
assert.strictEqual(zoraBase, null);
console.log('  ✅ Zora Base rejected');

console.log('Test 2: Manifold URL with contract...');
const manifold = resolvePlatformContractFromUrl(
    'https://app.manifold.xyz/c/some-drop/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
);
assert(manifold);
assert.strictEqual(manifold!.platform, 'manifold');
console.log('  ✅ Manifold');

console.log('Test 3: Thirdweb ethereum path...');
const tw = resolvePlatformContractFromUrl(
    'https://thirdweb.com/ethereum/0x1234567890123456789012345678901234567890'
);
assert(tw);
assert.strictEqual(tw!.platform, 'thirdweb');
console.log('  ✅ Thirdweb ETH');

console.log('Test 4: unrelated URL...');
assert.strictEqual(resolvePlatformContractFromUrl('https://opensea.io/collection/foo'), null);
console.log('  ✅ null');

console.log('\n✅ All platform link resolver tests passed.\n');
