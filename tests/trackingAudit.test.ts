import assert from 'node:assert/strict';
import { StateManager } from '../src/bot/stateManager';
import { buildTrackingAudit } from '../src/services/trackingAudit';

function testUnionIncludesPersonalAndGlobal() {
    const state = {
        trackedAddresses: ['0xaaaa'],
        userTrackedAddresses: { u1: ['0xbbbb'] },
    } as any;
    const union = StateManager.getUnionOfTrackedAddresses(state);
    assert.equal(union.length, 2);
    assert.ok(union.includes('0xaaaa'));
    assert.ok(union.includes('0xbbbb'));
}

function testAuditDetectsDrift() {
    const state = {
        trackedAddresses: ['0xdead'],
        userTrackedAddresses: {},
    } as any;
    const fakeTracker = {
        running: true,
        getTrackedAddresses: () => ['0xbeef'],
        getStats: () => ({}),
    } as any;
    const audit = buildTrackingAudit(state, fakeTracker);
    assert.ok(audit.onlyInState.includes('0xdead'));
    assert.ok(audit.onlyInTracker.includes('0xbeef'));
    assert.ok(audit.issues.includes('addresses_not_synced_to_tracker'));
}

testUnionIncludesPersonalAndGlobal();
testAuditDetectsDrift();
console.log('trackingAudit.test.ts: ok');
