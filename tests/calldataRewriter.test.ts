/**
 * Calldata rewriter — SeaDrop, Manifold, Zora (ETH mainnet copy-mint)
 * Run: npx tsx tests/calldataRewriter.test.ts
 */

import assert from 'node:assert';
import { AbiCoder, getAddress } from 'ethers';
import {
    hijackManifoldCalldata,
    hijackZoraCalldata,
    rewriteMintCalldataForWallet,
} from '../src/services/calldataRewriter';

const WHALE = '0x1111111111111111111111111111111111111111';
const WALLET = '0x2222222222222222222222222222222222222222';
const coder = AbiCoder.defaultAbiCoder();

console.log('Test 1: Manifold mint(address,uint256,uint256)...');
const manifoldSel = '0x156e29f6';
const manifoldData =
    manifoldSel +
    coder.encode(['address', 'uint256', 'uint256'], [WHALE, 1n, 0n]).slice(2);
const manifoldOut = hijackManifoldCalldata(manifoldData, WALLET, WHALE);
assert(manifoldOut);
const [mTo] = coder.decode(['address', 'uint256', 'uint256'], '0x' + manifoldOut!.slice(10));
assert.strictEqual(getAddress(String(mTo)), getAddress(WALLET));
console.log('  ✅ Manifold hijack');

console.log('Test 2: Zora mintWithRewards...');
const zoraSel = '0x0f4a1e5e';
const zoraData =
    zoraSel +
    coder
        .encode(['address', 'uint256', 'string', 'address'], [WHALE, 1n, '', WHALE])
        .slice(2);
const zoraOut = hijackZoraCalldata(zoraData, WALLET, WHALE);
assert(zoraOut);
const [zTo] = coder.decode(['address', 'uint256', 'string', 'address'], '0x' + zoraOut!.slice(10));
assert.strictEqual(getAddress(String(zTo)), getAddress(WALLET));
console.log('  ✅ Zora hijack');

console.log('Test 3: rewriteMintCalldataForWallet unified...');
const unified = rewriteMintCalldataForWallet(manifoldData, WHALE, WALLET);
assert(unified);
assert.strictEqual(unified, manifoldOut);
console.log('  ✅ unified rewriter');

console.log('\n✅ All calldata rewriter tests passed.\n');
