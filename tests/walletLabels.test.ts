import assert from 'node:assert/strict';
import type { BotState } from '../src/bot/stateManager';
import {
    applyWalletLabels,
    getWalletDisplayName,
    getWalletLabelsForUser,
    setWalletLabel,
    trimWalletLabels,
} from '../src/utils/walletLabels';

const baseState = (): BotState =>
    ({
        trackedAddresses: [],
        autoMint: false,
        providerUrl: '',
        masterKey: '',
        mintAddress: '',
        mintAmount: '0',
        mnemonic: '',
        userWallets: { '123': 3 },
        userWalletLabels: {},
    }) as BotState;

console.log('walletLabels: getWalletDisplayName fallback...');
{
    const state = baseState();
    assert.equal(getWalletDisplayName(state, '123', 0), 'W#1');
}

console.log('walletLabels: set and read custom label...');
{
    const state = baseState();
    setWalletLabel(state, '123', 0, 'Alpha');
    assert.equal(getWalletDisplayName(state, '123', 0), 'Alpha');
    assert.equal(getWalletLabelsForUser(state, '123', 3)[0], 'Alpha');
}

console.log('walletLabels: applyWalletLabels pads to count...');
{
    const state = baseState();
    applyWalletLabels(state, '123', ['One', 'Two']);
    const labels = getWalletLabelsForUser(state, '123', 3);
    assert.equal(labels[0], 'One');
    assert.equal(labels[1], 'Two');
    assert.equal(labels[2], '');
}

console.log('walletLabels: trimWalletLabels on delete...');
{
    const state = baseState();
    applyWalletLabels(state, '123', ['A', 'B', 'C']);
    trimWalletLabels(state, '123', 1);
    assert.equal(state.userWalletLabels!['123'].length, 1);
    assert.equal(state.userWalletLabels!['123'][0], 'A');
}

console.log('walletLabels: max length enforced...');
{
    const state = baseState();
    setWalletLabel(state, '123', 0, 'x'.repeat(50));
    assert.equal(state.userWalletLabels!['123'][0].length, 32);
}

console.log('\n✅ walletLabels tests passed\n');
