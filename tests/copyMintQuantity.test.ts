import assert from 'node:assert/strict';
import { AbiCoder } from 'ethers';
import { SEADROP_MINT_PUBLIC } from '../src/services/seaDropBuilder';
import {
    automintRequiresForceGasEstimate,
    decodeWhaleMintQuantity,
    scaleMintValueWei,
} from '../src/services/copyMintQuantity';
import { rewriteMintCalldataQuantity } from '../src/services/calldataRewriter';
import {
    getUserTrackingPrefs,
    userAllowsAutomintPayment,
    applyUserTrackingPrefs,
} from '../src/services/userTrackingPrefs';
import type { BotState } from '../src/bot/stateManager';

function testDecodeSeaDropQuantity() {
    const coder = AbiCoder.defaultAbiCoder();
    const data =
        SEADROP_MINT_PUBLIC +
        coder
            .encode(
                ['address', 'address', 'address', 'uint256'],
                [
                    '0x1111111111111111111111111111111111111111',
                    '0x2222222222222222222222222222222222222222',
                    '0x3333333333333333333333333333333333333333',
                    5n,
                ]
            )
            .slice(2);
    assert.equal(decodeWhaleMintQuantity(data), 5);
}

function testRewriteQuantity() {
    const coder = AbiCoder.defaultAbiCoder();
    const data =
        SEADROP_MINT_PUBLIC +
        coder
            .encode(
                ['address', 'address', 'address', 'uint256'],
                [
                    '0x1111111111111111111111111111111111111111',
                    '0x2222222222222222222222222222222222222222',
                    '0x3333333333333333333333333333333333333333',
                    1n,
                ]
            )
            .slice(2);
    const out = rewriteMintCalldataQuantity(data, 5, 1);
    assert.ok(out);
    assert.equal(decodeWhaleMintQuantity(out!), 5);
}

function testScaleValue() {
    assert.equal(scaleMintValueWei('1000', 3), '3000');
}

function testPaymentFilter() {
    assert.equal(userAllowsAutomintPayment('free', 'all'), true);
    assert.equal(userAllowsAutomintPayment('paid', 'all'), true);
    assert.equal(userAllowsAutomintPayment('free', 'free_only'), true);
    assert.equal(userAllowsAutomintPayment('paid', 'free_only'), false);
    assert.equal(userAllowsAutomintPayment('unknown', 'free_only'), false);

    const state = { userTrackingPrefs: {} } as BotState;
    applyUserTrackingPrefs(state, 'u1', { copyMintPaymentFilter: 'free_only' });
    assert.equal(getUserTrackingPrefs(state, 'u1').copyMintPaymentFilter, 'free_only');
}

function testAutomintForceGasEstimate() {
    assert.equal(automintRequiresForceGasEstimate(), false);
    assert.equal(automintRequiresForceGasEstimate({}), false);
    assert.equal(
        automintRequiresForceGasEstimate({ seaDropNftContract: '0xabc' }),
        true
    );
    assert.equal(automintRequiresForceGasEstimate({ scatterSlug: 'my-drop' }), true);
    assert.equal(
        automintRequiresForceGasEstimate({ routeType: 'seadrop_public' }),
        true
    );
    assert.equal(
        automintRequiresForceGasEstimate({
            skipSeaDropRebuild: true,
            routeType: 'seadrop_public',
            mintQty: 1,
            whaleQty: 1,
        }),
        false
    );
    assert.equal(
        automintRequiresForceGasEstimate({
            skipSeaDropRebuild: true,
            routeType: 'seadrop_public',
            mintQty: 3,
            whaleQty: 1,
        }),
        true
    );
    assert.equal(
        automintRequiresForceGasEstimate({ mintQty: 5, whaleQty: 1 }),
        true
    );
    assert.equal(
        automintRequiresForceGasEstimate({ mintQty: 1, whaleQty: 1 }),
        false
    );
}

testDecodeSeaDropQuantity();
testRewriteQuantity();
testScaleValue();
testPaymentFilter();
testAutomintForceGasEstimate();
console.log('copyMintQuantity.test.ts: ok');
