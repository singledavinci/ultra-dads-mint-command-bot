import assert from 'node:assert/strict';
import { resetRuntimeConfigForTests, getRuntimeConfig } from '../src/config/runtimeConfig.js';
import { buildCapacityStatus, formatCapacityStatusHtml } from '../src/utils/capacityStatus.js';

function testCapacityStatusDefaults() {
    resetRuntimeConfigForTests();
    delete process.env.TRACKER_BOOT_GRACE_MS;
    delete process.env.AUTOMINT_USER_CONCURRENCY;
    delete process.env.GLOBAL_MINT_USER_CONCURRENCY;

    const status = buildCapacityStatus(null, '3.5.29');
    assert.equal(status.version, '3.5.29');
    assert.equal(status.executionConcurrency, 4);
    assert.equal(status.preflightConcurrency, 4);
    assert.equal(status.automintUserConcurrency, 4);
    assert.equal(status.globalMintUserConcurrency, 8);
    assert.equal(status.trackerBootGraceMs, 5000);
    assert.equal(status.trackerMaxPendingRpcPerSec, 8);
    assert.equal(status.trackerMaxPendingConcurrent, 6);
    assert.equal(status.trackerRunning, false);
    assert.equal(status.wsConnected, false);
    assert.equal(typeof status.live.rpc429Count, 'number');
    assert.equal(typeof status.live.engineQueueDepth, 'number');

    const html = formatCapacityStatusHtml(status);
    assert.match(html, /CAPACITY/);
    assert.match(html, /Live pressure/);
    assert.match(html, /v3\.5\.29/);
}

function testCapacityStatusEnvOverride() {
    resetRuntimeConfigForTests();
    process.env.TRACKER_BOOT_GRACE_MS = '12000';
    process.env.AUTOMINT_USER_CONCURRENCY = '6';
    process.env.GLOBAL_MINT_USER_CONCURRENCY = '10';

    const status = buildCapacityStatus(null, '3.5.29');
    assert.equal(status.trackerBootGraceMs, 12000);
    assert.equal(status.automintUserConcurrency, 6);
    assert.equal(status.globalMintUserConcurrency, 10);

    delete process.env.TRACKER_BOOT_GRACE_MS;
    delete process.env.AUTOMINT_USER_CONCURRENCY;
    delete process.env.GLOBAL_MINT_USER_CONCURRENCY;
    resetRuntimeConfigForTests();
}

function testGlobalMintConcurrencyFallback() {
    resetRuntimeConfigForTests();
    delete process.env.GLOBAL_MINT_USER_CONCURRENCY;
    process.env.AUTOMINT_USER_CONCURRENCY = '3';

    assert.equal(getRuntimeConfig().globalMintUserConcurrency, 3);

    delete process.env.AUTOMINT_USER_CONCURRENCY;
    resetRuntimeConfigForTests();
    assert.equal(getRuntimeConfig().globalMintUserConcurrency, 8);
}

testCapacityStatusDefaults();
testCapacityStatusEnvOverride();
testGlobalMintConcurrencyFallback();
console.log('capacityStatus.test.ts: ok');
