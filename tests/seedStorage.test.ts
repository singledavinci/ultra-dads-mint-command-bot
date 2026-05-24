/**
 * seedStorage unit tests
 */

import assert from 'node:assert';
import {
    getBotMnemonic,
    purgeStoredSeed,
    stateForPersistence,
} from '../src/utils/seedStorage.js';
import type { BotState } from '../src/bot/stateManager.js';

console.log('Test: stateForPersistence strips mnemonic...');
{
    const state = {
        trackedAddresses: [],
        autoMint: false,
        providerUrl: '',
        mintAddress: '',
        mintAmount: '0',
        mnemonic: 'word '.repeat(12).trim(),
        userWallets: {},
    } as BotState;
    const out = stateForPersistence(state);
    assert.strictEqual(out.mnemonic, undefined);
    assert.ok(state.mnemonic && state.mnemonic.length > 0);
    console.log('  OK');
}

console.log('Test: purgeStoredSeed...');
{
    const state = {
        trackedAddresses: [],
        autoMint: false,
        providerUrl: '',
        mintAddress: '',
        mintAmount: '0',
        mnemonic: 'abandon '.repeat(11) + 'about',
        userWallets: {},
    } as BotState;
    assert.strictEqual(purgeStoredSeed(state), true);
    assert.strictEqual(state.mnemonic, undefined);
    assert.strictEqual(purgeStoredSeed(state), false);
    console.log('  OK');
}

console.log('Test: getBotMnemonic reads env only...');
{
    const prev = process.env.MNEMONIC;
    process.env.MNEMONIC = 'abandon '.repeat(11) + 'about';
    assert.ok(getBotMnemonic());
    delete process.env.MNEMONIC;
    assert.strictEqual(getBotMnemonic(), null);
    if (prev !== undefined) process.env.MNEMONIC = prev;
    else delete process.env.MNEMONIC;
    console.log('  OK');
}

console.log('seedStorage tests passed');
