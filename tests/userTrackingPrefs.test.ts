import assert from 'node:assert/strict';
import type { BotState } from '../src/bot/stateManager';
import {
    applyUserTrackingPrefs,
    getUsersForWhaleAlerts,
    getUsersForWhaleAutomint,
    TRACKING_PRESET_ALERTS_ONLY_PERSONAL,
    TRACKING_PRESET_ALL_SOURCES,
    TRACKING_PRESET_PERSONAL_ONLY,
} from '../src/services/userTrackingPrefs';

function baseState(overrides: Partial<BotState> = {}): BotState {
    return {
        trackedAddresses: ['0xglobalwhale'],
        userTrackedAddresses: {
            u1: ['0xpersonalwhale'],
            u2: ['0xcommunityonly'],
        },
        userWallets: { u1: 1, u2: 1 },
        userFollowGlobal: {},
        userTrackingPrefs: {},
        autoMint: true,
        providerUrl: '',
        ...overrides,
    } as BotState;
}

function testPersonalOnly() {
    const state = baseState();
    applyUserTrackingPrefs(state, 'u1', TRACKING_PRESET_PERSONAL_ONLY);
    applyUserTrackingPrefs(state, 'u2', TRACKING_PRESET_PERSONAL_ONLY);
    assert.deepEqual(getUsersForWhaleAlerts(state, '0xpersonalwhale'), ['u1']);
    assert.deepEqual(getUsersForWhaleAutomint(state, '0xpersonalwhale'), ['u1']);
    assert.deepEqual(getUsersForWhaleAlerts(state, '0xglobalwhale'), []);
    assert.deepEqual(getUsersForWhaleAutomint(state, '0xglobalwhale'), []);
}

function testCommunityAllSources() {
    const state = baseState();
    applyUserTrackingPrefs(state, 'u1', TRACKING_PRESET_ALL_SOURCES);
    assert.ok(getUsersForWhaleAlerts(state, '0xcommunityonly').includes('u1'));
    assert.ok(getUsersForWhaleAutomint(state, '0xcommunityonly').includes('u1'));
}

function testAlertsOnlyNoAutomint() {
    const state = baseState({ autoMint: true });
    applyUserTrackingPrefs(state, 'u1', TRACKING_PRESET_ALERTS_ONLY_PERSONAL);
    assert.deepEqual(getUsersForWhaleAlerts(state, '0xpersonalwhale'), ['u1']);
    assert.deepEqual(getUsersForWhaleAutomint(state, '0xpersonalwhale'), []);
}

function testBotAutoMintOff() {
    const state = baseState({ autoMint: false });
    applyUserTrackingPrefs(state, 'u1', TRACKING_PRESET_ALL_SOURCES);
    assert.deepEqual(getUsersForWhaleAutomint(state, '0xglobalwhale'), []);
}

testPersonalOnly();
testCommunityAllSources();
testAlertsOnlyNoAutomint();
testBotAutoMintOff();
console.log('userTrackingPrefs.test.ts: ok');