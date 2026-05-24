import assert from 'node:assert/strict';
import type { BotState } from '../src/bot/stateManager';
import {
    getActiveHdIndices,
    getActiveManagedWalletCount,
    getHdWalletCount,
    getManagedWalletCount,
    listManagedWalletSlots,
    removeUserWallet,
} from '../src/utils/walletDeletion';

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
        userHdWalletExcluded: {},
        importedWallets: {},
    }) as BotState;

console.log('walletDeletion: legacy array count...');
{
    const state = baseState();
    state.userWallets['456'] = ['a', 'b'] as unknown as number;
    assert.equal(getHdWalletCount(state, '456'), 2);
}

console.log('walletDeletion: remove highest HD slot...');
{
    const state = baseState();
    const r = removeUserWallet(state, '123', 3);
    assert.equal(r.ok, true);
    if (r.ok) {
        assert.equal(r.kind, 'hd');
        assert.equal(state.userWallets['123'], 2);
        assert.equal(getActiveManagedWalletCount(state, '123'), 2);
    }
}

console.log('walletDeletion: exclude middle HD slot...');
{
    const state = baseState();
    const r = removeUserWallet(state, '123', 2);
    assert.equal(r.ok, true);
    if (r.ok) {
        assert.equal(r.kind, 'hd');
        assert.equal(state.userWallets['123'], 3);
        assert.deepEqual(getActiveHdIndices(state, '123'), [0, 2]);
        assert.equal(getActiveManagedWalletCount(state, '123'), 2);
    }
}

console.log('walletDeletion: remove imported by index...');
{
    const state = baseState();
    state.userWallets['123'] = 1;
    state.importedWallets = { '123': ['0x' + '1'.repeat(64), '0x' + '2'.repeat(64)] };
    const r = removeUserWallet(state, '123', 2);
    assert.equal(r.ok, true);
    if (r.ok) {
        assert.equal(r.kind, 'imported');
        assert.equal(state.importedWallets!['123'].length, 1);
    }
}

console.log('walletDeletion: default removes last wallet...');
{
    const state = baseState();
    state.userWallets['123'] = 1;
    state.importedWallets = { '123': ['0x' + '1'.repeat(64)] };
    assert.equal(getManagedWalletCount(state, '123'), 2);
    const r = removeUserWallet(state, '123');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.kind, 'imported');
}

console.log('walletDeletion: keep at least one when only HD...');
{
    const state = baseState();
    state.userWallets['123'] = 1;
    const r = removeUserWallet(state, '123', 1);
    assert.equal(r.ok, false);
}

console.log('walletDeletion: list slots order...');
{
    const state = baseState();
    state.userHdWalletExcluded = { '123': [1] };
    const slots = listManagedWalletSlots(state, '123');
    assert.equal(slots.length, 2);
    assert.equal(slots[0].kind, 'hd');
    if (slots[0].kind === 'hd') assert.equal(slots[0].hdIndex, 0);
    assert.equal(slots[1].kind, 'hd');
    if (slots[1].kind === 'hd') assert.equal(slots[1].hdIndex, 2);
}

console.log('\nwalletDeletion tests passed\n');
