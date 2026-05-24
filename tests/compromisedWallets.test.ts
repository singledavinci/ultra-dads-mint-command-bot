/**
 * compromisedWallets unit tests
 */

import assert from 'node:assert';
import type { BotState } from '../src/bot/stateManager.js';
import {
    filterWalletsForMint,
    markWalletCompromised,
    unmarkWalletCompromised,
    validateSweepDestination,
} from '../src/utils/compromisedWallets.js';

function testState(): BotState {
    return {
        trackedAddresses: [],
        autoMint: false,
        providerUrl: '',
        mintAddress: '',
        mintAmount: '0',
        mnemonic: '',
        userWallets: { u1: 3 },
        importedWallets: {},
        userHdWalletExcluded: {},
        userCompromisedWallets: {},
    };
}

console.log('Test: mark and filter mint wallets...');
{
    const state = testState();
    const mark = markWalletCompromised(state, 'u1', 2);
    assert.strictEqual(mark.ok, true);
    const wallets = [
        { address: '0xaaa' },
        { address: '0xbbb' },
        { address: '0xccc' },
    ];
    const safe = filterWalletsForMint(state, 'u1', wallets);
    assert.strictEqual(safe.length, 2);
    assert.strictEqual(safe[0]!.address, '0xaaa');
    assert.strictEqual(safe[1]!.address, '0xccc');
    console.log('  OK');
}

console.log('Test: unmark restores mint fleet...');
{
    const state = testState();
    markWalletCompromised(state, 'u1', 1);
    unmarkWalletCompromised(state, 'u1', 1);
    const wallets = [{ address: '0x1' }, { address: '0x2' }, { address: '0x3' }];
    assert.strictEqual(filterWalletsForMint(state, 'u1', wallets).length, 3);
    console.log('  OK');
}

console.log('Test: validateSweepDestination blocks compromised dest...');
{
    const state = testState();
    markWalletCompromised(state, 'u1', 1);
    const wallets = [
        { address: '0xDeadBeef00000000000000000000000000000001' },
        { address: '0x2' },
        { address: '0x3' },
    ];
    wallets[0]!.address = '0xdeadbeef00000000000000000000000000000001';
    const check = validateSweepDestination(
        state,
        'u1',
        '0xdeadbeef00000000000000000000000000000001',
        wallets
    );
    assert.strictEqual(check.ok, false);
    console.log('  OK');
}

console.log('compromisedWallets tests passed');
