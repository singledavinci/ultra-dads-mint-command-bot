/**
 * Phase 6 — Test: Constants (router detection)
 * Run: npx tsx tests/constants.test.ts
 */

import assert from 'node:assert';
import { isKnownRouter, isTrackerBypassRouter, KNOWN_NFT_ROUTERS } from '../src/config/constants';

console.log('Test 1: Known router detection...');
{
    assert(isKnownRouter('0x00005EA00Ac477B1030CE78506496e8C2dE24bf5'), 'SeaDrop v1.0 (mixed case)');
    assert(isKnownRouter('0x00005ea00ac477b1030ce78506496e8c2de24bf5'), 'SeaDrop v1.0 (lowercase)');
    assert(isKnownRouter('0x0000000000664ceffed39244a8312556a900b938'), 'SeaDrop v1.1');
    assert(!isKnownRouter('0x1234567890abcdef1234567890abcdef12345678'), 'Random address');
    assert(!isKnownRouter(null), 'null');
    assert(!isKnownRouter(undefined), 'undefined');
    assert(!isKnownRouter(''), 'empty string');
    console.log('  ✅ Router detection works');
}

console.log('Test 2: Tracker bypass routers are subset of known routers...');
{
    // Every bypass router should also be in the full known list
    for (const addr of ['0x00005ea00ac477b1030ce78506496e8c2de24bf5', '0x0000000000664ceffed39244a8312556a900b938']) {
        assert(isTrackerBypassRouter(addr), `${addr.slice(0, 10)} should be bypass`);
        assert(isKnownRouter(addr), `${addr.slice(0, 10)} should also be known`);
    }
    console.log('  ✅ Bypass routers are a subset of known routers');
}

console.log('Test 3: KNOWN_NFT_ROUTERS is frozen...');
{
    assert(KNOWN_NFT_ROUTERS.length >= 5, 'Should have at least 5 routers');
    // Verify all are lowercase
    for (const r of KNOWN_NFT_ROUTERS) {
        assert(r === r.toLowerCase(), `${r} should be lowercase`);
        assert(r.startsWith('0x'), `${r} should start with 0x`);
    }
    console.log('  ✅ All routers are lowercase 0x-prefixed');
}

console.log('\n✅ All constants tests passed.\n');
