/**
 * SeaDrop mint resolver unit tests
 * Run: tsx tests/seaDropMintResolver.test.ts
 */

import assert from 'node:assert';
import {
    inferSeaDropPhaseFromSelector,
    phaseLabel,
    SEADROP_MINT_ALLOWLIST,
    SEADROP_MINT_PUBLIC,
    SEADROP_MINT_SIGNED,
} from '../src/services/seaDropMintResolver.js';

console.log('Test: inferSeaDropPhaseFromSelector...');
{
    assert.strictEqual(inferSeaDropPhaseFromSelector(SEADROP_MINT_PUBLIC), 'public');
    assert.strictEqual(inferSeaDropPhaseFromSelector('0x51061988'), 'public');
    assert.strictEqual(inferSeaDropPhaseFromSelector(SEADROP_MINT_ALLOWLIST), 'allowlist');
    assert.strictEqual(inferSeaDropPhaseFromSelector(SEADROP_MINT_SIGNED), 'signed');
    assert.strictEqual(inferSeaDropPhaseFromSelector('0xdeadbeef'), 'unknown');
    console.log('  OK phase inference');
}

console.log('Test: phaseLabel...');
{
    assert.strictEqual(phaseLabel('allowlist'), 'GTD / Allowlist');
    assert.strictEqual(phaseLabel('public'), 'Public');
    console.log('  OK labels');
}

console.log('All seaDropMintResolver tests passed.');
