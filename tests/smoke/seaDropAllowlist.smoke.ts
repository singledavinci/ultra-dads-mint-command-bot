/**
 * SeaDrop on-chain allowlist helpers — offline smoke
 */

import assert from 'node:assert';
import {
    parseAllowlistAddresses,
    seaDropAllowlistLeafHash,
} from '../../src/services/seaDropAllowlistMint.js';
import { merkleProofForLeaf, merkleRootFromLeaves } from '../../src/utils/merkleTree.js';

const mintParams: Parameters<typeof seaDropAllowlistLeafHash>[1] = [
    0n,
    1n,
    1n,
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
const proof = merkleProofForLeaf(leaves, leaves[0]);

assert(root);
assert(proof?.length);
assert.strictEqual(parseAllowlistAddresses([w1]).length, 1);

console.log('\n smoke:seaDropAllowlist passed\n');
