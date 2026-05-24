/**
 * Thirdweb URL → contract resolution (unit — no network)
 * Run: npx tsx tests/thirdwebResolver.test.ts
 */

import assert from 'node:assert';
import {
    extractThirdwebContractFromUrl,
    isThirdwebDropSlugUrl,
    isThirdwebPageUrl,
} from '../src/services/thirdwebResolver';
import { resolvePlatformContractFromUrl } from '../src/services/platformLinkResolver';

console.log('Test 1: thirdweb.com/ethereum/0x… path...');
{
    const hit = extractThirdwebContractFromUrl(
        'https://thirdweb.com/ethereum/0x1234567890123456789012345678901234567890'
    );
    assert(hit);
    assert.strictEqual(hit!.chainSlug, 'ethereum');
    assert.strictEqual(hit!.contract, '0x1234567890123456789012345678901234567890');
    console.log('  ✅ ethereum path');
}

console.log('Test 2: explore/eth/0x… and chain id 1...');
{
    const eth = extractThirdwebContractFromUrl(
        'https://thirdweb.com/explore/eth/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );
    assert(eth);
    assert.strictEqual(eth!.chainSlug, 'ethereum');

    const id1 = extractThirdwebContractFromUrl(
        'https://thirdweb.com/1/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );
    assert(id1);
    assert.strictEqual(id1!.chainSlug, 'ethereum');
    console.log('  ✅ explore + chain id');
}

console.log('Test 3: base path parsed but platform resolver rejects...');
{
    const hit = extractThirdwebContractFromUrl(
        'https://thirdweb.com/base/0x1234567890123456789012345678901234567890'
    );
    assert(hit);
    assert.strictEqual(hit!.chainSlug, 'base');
    assert.strictEqual(
        resolvePlatformContractFromUrl(
            'https://thirdweb.com/base/0x1234567890123456789012345678901234567890'
        ),
        null
    );
    console.log('  ✅ Base not ETH');
}

console.log('Test 4: platform resolver ETH thirdweb URL...');
{
    const p = resolvePlatformContractFromUrl(
        'https://thirdweb.com/ethereum/0x1234567890123456789012345678901234567890'
    );
    assert(p);
    assert.strictEqual(p!.platform, 'thirdweb');
    console.log('  ✅ platform resolver');
}

console.log('Test 5: drop slug detection...');
{
    assert(isThirdwebPageUrl('https://thirdweb.com/drop/my-collection'));
    assert(isThirdwebDropSlugUrl('https://thirdweb.com/drops/my-collection'));
    assert(!isThirdwebDropSlugUrl('https://thirdweb.com/ethereum/0x1234567890123456789012345678901234567890'));
    console.log('  ✅ slug patterns');
}

console.log('\n✅ All Thirdweb resolver tests passed.\n');
