/**
 * UNIVERSAL_MINT_MODE runtime profile
 * Run: npx tsx tests/universalMintMode.test.ts
 */

import assert from 'node:assert';
import { resetRuntimeConfigForTests, getRuntimeConfig } from '../src/config/runtimeConfig';

console.log('Test 1: UNIVERSAL_MINT_MODE enables unknown selectors...');
process.env.UNIVERSAL_MINT_MODE = 'true';
delete process.env.COPY_UNKNOWN_MINT_CALLS;
delete process.env.REQUIRE_KNOWN_SELECTOR;
resetRuntimeConfigForTests();
const cfg = getRuntimeConfig();
assert.strictEqual(cfg.copyUnknownMintCalls, true);
assert.strictEqual(cfg.requireKnownSelector, false);
console.log('  ✅ universal profile');

console.log('Test 2: defaults stay conservative when unset...');
delete process.env.UNIVERSAL_MINT_MODE;
process.env.COPY_UNKNOWN_MINT_CALLS = 'false';
process.env.REQUIRE_KNOWN_SELECTOR = 'true';
resetRuntimeConfigForTests();
const conservative = getRuntimeConfig();
assert.strictEqual(conservative.copyUnknownMintCalls, false);
assert.strictEqual(conservative.requireKnownSelector, true);
console.log('  ✅ conservative defaults');

console.log('\n✅ All universal mint mode tests passed.\n');
