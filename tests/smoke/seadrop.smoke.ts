/**
 * SeaDrop smoke — calldata build + hijack, no chain unless LIVE_BROADCAST=true
 * Run: npm run smoke:seadrop
 */

import assert from 'node:assert';
import {
    buildSeaDropMintCalldata,
    hijackSeaDropCalldata,
    isSeaDropRouter,
    SEADROP_MINT_PUBLIC,
} from '../../src/services/seaDropBuilder.js';

const LIVE = process.env.LIVE_BROADCAST === 'true';
console.log(`[smoke:seadrop] LIVE_BROADCAST=${LIVE}`);

assert(isSeaDropRouter('0x0000000000664ceffed39244a8312556a900b938'));

const built = buildSeaDropMintCalldata({
    nftContract: '0x3333333333333333333333333333333333333333',
    minter: '0x2222222222222222222222222222222222222222',
    quantity: 1,
});
assert(built.data.startsWith(SEADROP_MINT_PUBLIC));

const hijacked = hijackSeaDropCalldata(built.data, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
assert(hijacked);

if (!LIVE) console.log('  offline SeaDrop calldata OK');
console.log('\n smoke:seadrop passed\n');
