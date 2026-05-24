import assert from 'node:assert/strict';
import { GasPlanner, intrinsicGasFloor } from '../src/engine/GasPlanner';

function testBroadcastGasLimitHeadroom() {
    const est = 80_000n;
    const limit = GasPlanner.applyBroadcastGasLimit(est, {
        gasLimitMultiplier: 1.25,
        fastGasLimit: 150_000,
    } as any);
    assert.ok(limit >= est + 30_000n, `expected headroom above estimate, got ${limit}`);
    assert.ok(limit <= 150_000n);
}

function testSeaDropIntrinsicMatchesFailedTxCap() {
    const data =
        '0x161ac21f' +
        '0000000000000000000000000042fffce2e13714fde27ff68e7521bb27567b530' +
        '000000000000000000000000000a26b00c1f0df003000390027140000faa719' +
        '000000000000000000000000043431af399c4dc4f1ae6bb0731bbd099b331cac' +
        '00000000000000000000000000000000000000000000000000000000000000001';
    const fastCap = intrinsicGasFloor(data) + 35_000n;
    assert.ok(
        fastCap >= 82_000n && fastCap <= 83_000n,
        `fast-path cap should be ~82k (failed tx used 82264), got ${fastCap}`
    );
    const broadcast = GasPlanner.applyBroadcastGasLimit(fastCap, {
        gasLimitMultiplier: 1.25,
        fastGasLimit: 150_000,
    } as any);
    assert.ok(broadcast > 82_264n, 'broadcast limit must exceed bare intrinsic fast cap');
}

testBroadcastGasLimitHeadroom();
testSeaDropIntrinsicMatchesFailedTxCap();
console.log('gasPlanner.test.ts: ok');
