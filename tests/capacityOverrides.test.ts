import assert from 'node:assert/strict';
import { resetRuntimeConfigForTests } from '../src/config/runtimeConfig.js';
import {
    effectiveSkipRpcPreflight,
    effectiveStreamBroadcast,
    syncCapacityOverridesFromState,
    toggleCapacityOverride,
    capacityOverridesForState,
} from '../src/config/capacityOverrides.js';

function testOverrides() {
    resetRuntimeConfigForTests();
    syncCapacityOverridesFromState({});

    assert.equal(effectiveStreamBroadcast(), true);
    assert.equal(effectiveSkipRpcPreflight(), true);

    toggleCapacityOverride('streamBroadcast');
    assert.equal(effectiveStreamBroadcast(), false);

    syncCapacityOverridesFromState({ capacityOverrides: capacityOverridesForState() });
    assert.equal(effectiveStreamBroadcast(), false);

    toggleCapacityOverride('streamBroadcast');
    assert.equal(effectiveStreamBroadcast(), true);
}

testOverrides();
console.log('capacityOverrides.test.ts: ok');
