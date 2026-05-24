/**
 * Single source of truth for mempool pending detection display and checks.
 * Config comes from getRuntimeConfig() (same as MintTracker), not raw process.env.
 */
import { getRuntimeConfig } from '../config/runtimeConfig';

export type MempoolPendingEffective =
    | 'on'
    | 'paused'
    | 'off_config'
    | 'off_no_ws'
    | 'off_tracker';

export interface MempoolPendingStatus {
    effective: MempoolPendingEffective;
    /** Short label for debug lines, e.g. "ON" or "OFF (config)". */
    debugLine: string;
    /** Emoji line for emergency menu. */
    menuLabel: string;
    configEnabled: boolean;
    wsConfigured: boolean;
    trackerRunning: boolean;
    paused: boolean;
}

export interface MempoolPendingTrackerLike {
    running?: boolean;
    isPendingDetectionPaused?: () => boolean;
}

export function getMempoolPendingStatus(tracker?: MempoolPendingTrackerLike | null): MempoolPendingStatus {
    const cfg = getRuntimeConfig();
    const configEnabled = cfg.enablePendingDetection;
    const wsConfigured = Boolean(cfg.wsRpcUrl);
    const trackerRunning = Boolean(tracker?.running);
    const paused = Boolean(tracker?.isPendingDetectionPaused?.());

    if (!configEnabled) {
        return {
            effective: 'off_config',
            debugLine: 'OFF (ENABLE_PENDING_DETECTION)',
            menuLabel: '🔴 OFF (config)',
            configEnabled,
            wsConfigured,
            trackerRunning,
            paused,
        };
    }
    if (!wsConfigured) {
        return {
            effective: 'off_no_ws',
            debugLine: 'OFF (WS_RPC_URL missing)',
            menuLabel: '🔴 OFF (no WS)',
            configEnabled,
            wsConfigured,
            trackerRunning,
            paused,
        };
    }
    if (!trackerRunning) {
        return {
            effective: 'off_tracker',
            debugLine: 'OFF (tracker stopped)',
            menuLabel: '🔴 OFF (stopped)',
            configEnabled,
            wsConfigured,
            trackerRunning,
            paused,
        };
    }
    if (paused) {
        return {
            effective: 'paused',
            debugLine: 'Paused (/freerpc)',
            menuLabel: '⏸ Paused',
            configEnabled,
            wsConfigured,
            trackerRunning,
            paused,
        };
    }
    return {
        effective: 'on',
        debugLine: 'ON',
        menuLabel: '🟢 ON',
        configEnabled,
        wsConfigured,
        trackerRunning,
        paused,
    };
}

export function isMempoolPendingActive(tracker?: MempoolPendingTrackerLike | null): boolean {
    return getMempoolPendingStatus(tracker).effective === 'on';
}
