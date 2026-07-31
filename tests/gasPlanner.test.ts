import assert from 'node:assert/strict';
import { GasPlanner, intrinsicGasFloor } from '../src/engine/GasPlanner';

function testBroadcastGasLimitNetworkPad() {
    const est = 100_000n;
    const limit = GasPlanner.applyBroadcastGasLimit(est, { fastGasLimit: 500_000 } as any, 'normal');
    assert.equal(limit, 103_000n, `network 3% pad, got ${limit}`);
}

function testBroadcastGasLimitCompetitivePad() {
    const est = 100_000n;
    const limit = GasPlanner.applyBroadcastGasLimit(est, { fastGasLimit: 500_000 } as any, 'fcfs_plus');
    assert.equal(limit, 110_000n, `competitive 10% pad, got ${limit}`);
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
    const broadcast = GasPlanner.applyBroadcastGasLimit(fastCap, { fastGasLimit: 150_000 } as any, 'fcfs_plus');
    assert.ok(broadcast > 82_264n, 'broadcast limit must exceed bare intrinsic fast cap');
}

testBroadcastGasLimitNetworkPad();
testBroadcastGasLimitCompetitivePad();
testSeaDropIntrinsicMatchesFailedTxCap();
console.log('gasPlanner.test.ts: ok');
