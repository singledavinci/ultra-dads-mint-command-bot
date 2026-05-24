import assert from 'node:assert/strict';
import {
    filterWalletsForAutomint,
    hasSuccessfulWalletMint,
    markSuccessfulWalletMint,
    resetSuccessfulMintDedupeForTests,
} from '../src/services/successfulMintDedupe.js';

function testDedupeBlocksRepeatAutomint() {
    resetSuccessfulMintDedupeForTests();
    process.env.AUTOMINT_SUCCESS_DEDUPE_TTL_MS = '60000';

    const contract = '0x1111111111111111111111111111111111111111';
    const wallet = '0x2222222222222222222222222222222222222222';

    assert.equal(hasSuccessfulWalletMint(wallet, contract), false);

    markSuccessfulWalletMint(wallet, contract);
    assert.equal(hasSuccessfulWalletMint(wallet, contract), true);
    assert.equal(hasSuccessfulWalletMint('0x3333333333333333333333333333333333333333', contract), false);

    const fleet = filterWalletsForAutomint(
        [
            { address: wallet, pk: '1' },
            { address: '0x3333333333333333333333333333333333333333', pk: '2' },
        ],
        contract
    );
    assert.equal(fleet.length, 1);
    assert.equal(fleet[0].address, '0x3333333333333333333333333333333333333333');

    delete process.env.AUTOMINT_SUCCESS_DEDUPE_TTL_MS;
    resetSuccessfulMintDedupeForTests();
}

function testDisabled() {
    resetSuccessfulMintDedupeForTests();
    process.env.AUTOMINT_SUCCESS_DEDUPE = 'false';

    markSuccessfulWalletMint('0x2222222222222222222222222222222222222222', '0x1111111111111111111111111111111111111111');
    assert.equal(
        hasSuccessfulWalletMint('0x2222222222222222222222222222222222222222', '0x1111111111111111111111111111111111111111'),
        false
    );

    delete process.env.AUTOMINT_SUCCESS_DEDUPE;
    resetSuccessfulMintDedupeForTests();
}

testDedupeBlocksRepeatAutomint();
testDisabled();
console.log('successfulMintDedupe.test.ts: ok');
