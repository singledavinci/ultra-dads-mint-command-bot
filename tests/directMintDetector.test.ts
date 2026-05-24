/**
 * Direct NFT contract mint detection helpers
 * Run: npx tsx tests/directMintDetector.test.ts
 */
import assert from 'node:assert/strict';
import { encodeDirectMintCalldata } from '../src/services/mintPriceDetector';

assert.equal(encodeDirectMintCalldata('0x5b70ea9f', 1), '0x5b70ea9f');
assert.equal(encodeDirectMintCalldata('0x1249c58b', 3), '0x1249c58b');
assert.ok(
    encodeDirectMintCalldata('0xa0712d68', 2).startsWith('0xa0712d68'),
    'mint(uint256) encodes quantity'
);
assert.ok(encodeDirectMintCalldata('0xa0712d68', 2).length > 10);

console.log('directMintDetector.test.ts: ok');
