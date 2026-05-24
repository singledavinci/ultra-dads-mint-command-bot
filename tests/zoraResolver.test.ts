/**
 * Zora URL → contract resolution (unit — no network)
 * Run: npx tsx tests/zoraResolver.test.ts
 */

import assert from 'node:assert';
import {
    extractZoraCollectContractFromUrl,
    isZoraMintSlugUrl,
} from '../src/services/zoraResolver';
import { resolvePlatformContractFromUrl } from '../src/services/platformLinkResolver';

console.log('Test 1: collect/eth:0x… path parsing...');
{
    const hit = extractZoraCollectContractFromUrl(
        'https://zora.co/collect/eth:0x1234567890123456789012345678901234567890'
    );
    assert(hit);
    assert.strictEqual(hit!.chainSlug, 'ethereum');
    assert.strictEqual(hit!.contract, '0x1234567890123456789012345678901234567890');
    console.log('  ✅ eth: prefix');
}

console.log('Test 2: collect/ethereum:0x… with token id suffix...');
{
    const hit = extractZoraCollectContractFromUrl(
        'https://zora.co/collect/ethereum:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/42'
    );
    assert(hit);
    assert.strictEqual(hit!.contract, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    console.log('  ✅ trailing token id stripped');
}

console.log('Test 3: collect/base rejected via platform resolver...');
{
    const hit = extractZoraCollectContractFromUrl(
        'https://zora.co/collect/base:0x1234567890123456789012345678901234567890'
    );
    assert(hit);
    assert.strictEqual(hit!.chainSlug, 'base');
    const platform = resolvePlatformContractFromUrl(
        'https://zora.co/collect/base:0x1234567890123456789012345678901234567890'
    );
    assert.strictEqual(platform, null);
    console.log('  ✅ Base not ETH');
}

console.log('Test 4: platformLinkResolver uses eth: collect URLs...');
{
    const p = resolvePlatformContractFromUrl(
        'https://zora.co/collect/eth:0x1234567890123456789012345678901234567890'
    );
    assert(p);
    assert.strictEqual(p!.platform, 'zora');
    console.log('  ✅ platform resolver eth:');
}

console.log('Test 5: mint slug URL detection...');
{
    assert(isZoraMintSlugUrl('https://zora.co/mint/my-drop-slug'));
    assert(!isZoraMintSlugUrl('https://zora.co/collect/eth:0x1234567890123456789012345678901234567890'));
    console.log('  ✅ mint slug pattern');
}

console.log('\n✅ All Zora resolver tests passed.\n');
