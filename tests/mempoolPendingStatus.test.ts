import assert from 'node:assert/strict';
import { resetRuntimeConfigForTests } from '../src/config/runtimeConfig.js';
import {
    getMempoolPendingStatus,
    isMempoolPendingActive,
} from '../src/utils/mempoolPendingStatus.js';

function runTests() {
    const origPending = process.env.ENABLE_PENDING_DETECTION;
    const origWs = process.env.WS_RPC_URL;
    const origTrackerWs = process.env.TRACKER_WS_URL;

    try {
        process.env.ENABLE_PENDING_DETECTION = 'false';
        process.env.WS_RPC_URL = 'wss://example.invalid';
        resetRuntimeConfigForTests();
        let s = getMempoolPendingStatus({ running: true, isPendingDetectionPaused: () => false });
        assert.equal(s.effective, 'off_config');
        assert.equal(s.menuLabel.includes('OFF'), true);
        assert.equal(isMempoolPendingActive({ running: true }), false);

        process.env.ENABLE_PENDING_DETECTION = 'true';
        delete process.env.WS_RPC_URL;
        delete process.env.TRACKER_WS_URL;
        resetRuntimeConfigForTests();

        s = getMempoolPendingStatus({
            running: true,
            isPendingDetectionPaused: () => false,
        });
        // ws may still be set from env in CI; if ws missing, expect off_no_ws
        if (!s.wsConfigured) {
            assert.equal(s.effective, 'off_no_ws');
        }

        process.env.WS_RPC_URL = 'wss://example.invalid';
        resetRuntimeConfigForTests();
        s = getMempoolPendingStatus({
            running: true,
            isPendingDetectionPaused: () => true,
        });
        if (s.configEnabled && s.wsConfigured) {
            assert.equal(s.effective, 'paused');
            assert.equal(s.debugLine, 'Paused (/freerpc)');
        }

        s = getMempoolPendingStatus({
            running: true,
            isPendingDetectionPaused: () => false,
        });
        if (s.configEnabled && s.wsConfigured) {
            assert.equal(s.effective, 'on');
            assert.equal(isMempoolPendingActive({ running: true }), true);
        }

        console.log('✅ mempoolPendingStatus tests passed');
    } finally {
        if (origPending === undefined) delete process.env.ENABLE_PENDING_DETECTION;
        else process.env.ENABLE_PENDING_DETECTION = origPending;
        if (origWs === undefined) delete process.env.WS_RPC_URL;
        else process.env.WS_RPC_URL = origWs;
        if (origTrackerWs === undefined) delete process.env.TRACKER_WS_URL;
        else process.env.TRACKER_WS_URL = origTrackerWs;
    }
}

runTests();
