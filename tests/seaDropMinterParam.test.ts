/**
 * Regression: SeaDrop mintPublic must use minterIfNotPayer=0 for self-mint (avoids PayerNotAllowed).
 */
import assert from 'node:assert';
import { AbiCoder, ZeroAddress } from 'ethers';
import {
    buildSeaDropMintCalldata,
    hijackSeaDropCalldata,
    seaDropMinterIfNotPayerForSelfMint,
    SEADROP_MINT_PUBLIC,
} from '../src/services/seaDropBuilder.js';

const NFT = '0xe6d979fbfb5b989f5742169a084151ad6fcd147a';
const WALLET = '0x177efd8687c82bbd3dc264b05fd9dcdc6a29fcf9';

console.log('Test 1: buildSeaDropMintCalldata uses zero minterIfNotPayer...');
const built = buildSeaDropMintCalldata({
    nftContract: NFT,
    minter: WALLET,
    quantity: 1,
});
const coder = AbiCoder.defaultAbiCoder();
const [, , minterSlot] = coder.decode(
    ['address', 'address', 'address', 'uint256'],
    '0x' + built.data.slice(10)
);
assert.strictEqual(String(minterSlot).toLowerCase(), ZeroAddress.toLowerCase());
assert.strictEqual(seaDropMinterIfNotPayerForSelfMint(), ZeroAddress);
console.log('  OK');

console.log('Test 2: hijackSeaDrop mintPublic uses zero (reproduces failed tx shape)...');
const failedTxCalldata =
    SEADROP_MINT_PUBLIC +
    coder
        .encode(
            ['address', 'address', 'address', 'uint256'],
            [
                NFT,
                '0x0000a26b00c1f0df003000390027140000faa719',
                WALLET,
                1n,
            ]
        )
        .slice(2);
const hijacked = hijackSeaDropCalldata(failedTxCalldata, WALLET);
assert(hijacked);
const [, , hijackMinter] = coder.decode(
    ['address', 'address', 'address', 'uint256'],
    '0x' + hijacked!.slice(10)
);
assert.strictEqual(String(hijackMinter).toLowerCase(), ZeroAddress.toLowerCase());
console.log('  OK');

console.log('\n✅ seaDropMinterParam tests passed.\n');
