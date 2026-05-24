/**
 * SeaDrop on-chain allowlist merkle helpers (unit, no network)
 */

import assert from 'node:assert';
import {
    parseAllowlistAddresses,
    precomputedProofFromPayload,
    seaDropAllowlistLeafHash,
    SEADROP_MINT_ALLOWLIST_V2,
} from '../src/services/seaDropAllowlistMint.js';
import { merkleProofForLeaf, merkleRootFromLeaves } from '../src/utils/merkleTree.js';

console.log('Test 1: allowlist v2 selector...');
assert.strictEqual(SEADROP_MINT_ALLOWLIST_V2, '0x4300a4e6');
console.log('  ✅ mintAllowList v2 selector');

console.log('Test 2: parse allowlist JSON shapes...');
assert.deepStrictEqual(parseAllowlistAddresses(['0x' + '1'.repeat(40)]), [
    '0x' + '1'.repeat(40),
]);
assert.deepStrictEqual(
    parseAllowlistAddresses({ addresses: ['0x' + '2'.repeat(40)] }),
    ['0x' + '2'.repeat(40)]
);
console.log('  ✅ parse shapes');

console.log('Test 3: precomputed proof lookup...');
const proof = precomputedProofFromPayload(
    {
        proofs: {
            ['0x' + 'a'.repeat(40)]: ['0x' + 'b'.repeat(64)],
        },
    },
    '0x' + 'a'.repeat(40)
);
assert.strictEqual(proof?.length, 1);
console.log('  ✅ precomputed proof');

console.log('Test 4: merkle tree round-trip...');
const mintParams: Parameters<typeof seaDropAllowlistLeafHash>[1] = [
    0n,
    2n,
    1000n,
    9999999999n,
    1n,
    BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    0n,
    false,
];
const w1 = '0x1111111111111111111111111111111111111111';
const w2 = '0x2222222222222222222222222222222222222222';
const leaves = [w1, w2].map(w => seaDropAllowlistLeafHash(w, mintParams).toLowerCase());
const root = merkleRootFromLeaves(leaves);
assert.ok(root);
const p1 = merkleProofForLeaf(leaves, leaves[0]);
assert.ok(p1 && p1.length > 0);
console.log('  ✅ merkle proof built');

console.log('\n✅ All seaDrop allowlist tests passed.\n');
