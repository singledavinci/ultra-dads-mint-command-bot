/**
 * dropMintPresets unit tests
 */

import assert from 'node:assert';
import {
    getEthPresetButtons,
    getTimePresetButtons,
    parseCustomEthInput,
    parseCustomTimeInput,
    saveUserEthPreset,
    saveUserTimePreset,
} from '../src/utils/dropMintPresets.js';
import type { BotState } from '../src/bot/stateManager.js';

const baseState = (): BotState => ({
    trackedAddresses: [],
    autoMint: false,
    providerUrl: '',
    mintAddress: '',
    mintAmount: '0',
    mnemonic: '',
    userWallets: {},
});

console.log('Test: parseCustomEthInput...');
{
    assert.strictEqual(parseCustomEthInput('0.15').ok, true);
    assert.strictEqual(parseCustomEthInput('0').ok, true);
    assert.strictEqual(parseCustomEthInput('bad').ok, false);
    console.log('  OK');
}

console.log('Test: parseCustomTimeInput +45m...');
{
    const r = parseCustomTimeInput('+45m');
    assert.strictEqual(r.ok, true);
    if (r.ok) assert.strictEqual(r.arg, '+45m');
    console.log('  OK');
}

console.log('Test: user eth presets appear first with star...');
{
    const state = baseState();
    saveUserEthPreset(state, 'u1', '0.12');
    const buttons = getEthPresetButtons(state, 'u1');
    assert(buttons.some(b => b.value === '0.12' && b.label.startsWith('⭐')));
    console.log('  OK');
}

console.log('Test: saveUserTimePreset...');
{
    const state = baseState();
    saveUserTimePreset(state, 'u1', '+45m');
    const buttons = getTimePresetButtons(state, 'u1');
    assert(buttons.some(b => b.value === '+45m'));
    console.log('  OK');
}

console.log('All dropMintPresets tests passed.');
