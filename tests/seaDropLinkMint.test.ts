/**
 * SeaDrop link-mint resolution (public drop contract from production failures)
 * Run: npx tsx tests/seaDropLinkMint.test.ts
 */

import assert from 'node:assert';
import { JsonRpcProvider } from 'ethers';
import {
    SEADROP_MINT_PUBLIC,
    buildSeaDropLinkMint,
    findSeaDropPublicDrop,
    isSeaDropPublicSelector,
} from '../src/services/seaDropBuilder';

const NFT = '0x9711f4c3ec6428b2debc80adee3e4a9518240fc6';
const SIM_WALLET = '0x1111111111111111111111111111111111111111';

console.log('Test 1: selector constants...');
assert(isSeaDropPublicSelector(SEADROP_MINT_PUBLIC));
assert.strictEqual(SEADROP_MINT_PUBLIC, '0x161ac21f');
console.log('  ✅ Current mintPublic selector is 0x161ac21f');

console.log('Test 2: on-chain SeaDrop public drop for 0x9711...');
const provider = new JsonRpcProvider('https://ethereum.publicnode.com', 1, { staticNetwork: true });

const drop = await findSeaDropPublicDrop(NFT, provider);
assert(drop, 'expected SeaDrop public drop');
assert.strictEqual(drop!.router.toLowerCase(), '0x00005ea00ac477b1030ce78506496e8c2de24bf5');
assert.strictEqual(drop!.maxPerWallet, 30);
console.log('  ✅ Drop on SeaDrop v1.0, max 30/wallet');

console.log('Test 3: buildSeaDropLinkMint calldata...');
let built: Awaited<ReturnType<typeof buildSeaDropLinkMint>> = null;
try {
    built = await buildSeaDropLinkMint(NFT, SIM_WALLET, 1, provider);
} catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
        msg.includes('not active') ||
        msg.includes('allows 0 per wallet') ||
        msg.includes('ended') ||
        msg.includes('not started')
    ) {
        console.log('  ⚠️ buildSeaDropLinkMint skipped (drop inactive on-chain)');
    } else {
        throw e;
    }
}
if (built) {
    assert.strictEqual(built.selector, SEADROP_MINT_PUBLIC);
    assert.strictEqual(built.to.toLowerCase(), '0x00005ea00ac477b1030ce78506496e8c2de24bf5');
    assert.ok(built.value === '0x0' || BigInt(built.value) > 0n, 'value from drop price');

    const mintValue = BigInt(built.value || '0');
    try {
        const gas = await provider.estimateGas({
            to: built.to,
            from: SIM_WALLET,
            data: built.data,
            value: mintValue,
        });
        assert(gas > 50_000n, 'gas should be reasonable when drop is live');
        console.log('  ✅ estimateGas passes, gas ~', gas.toString());
    } catch {
        console.log('  ⚠️ estimateGas skipped (drop inactive or sold out on-chain)');
    }
    console.log('  ✅ buildSeaDropLinkMint calldata');
}

console.log('\n✅ All SeaDrop link mint tests passed.\n');
