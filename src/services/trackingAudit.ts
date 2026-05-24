import type { BotState } from '../bot/stateManager';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { getMempoolPendingStatus } from '../utils/mempoolPendingStatus';
import { StateManager } from '../bot/stateManager';
import type { MintTracker } from '../utils/trackerCore';
import type { TrackerStats } from '../types/detection';

export interface TrackingAuditResult {
    ok: boolean;
    globalCount: number;
    personalEntries: number;
    unionCount: number;
    trackerWatching: number;
    trackerRunning: boolean;
    onlyInState: string[];
    onlyInTracker: string[];
    issues: string[];
    stats: TrackerStats | null;
    config: {
        pendingDetection: boolean;
        mempoolPendingEffective: string;
        blockFallback: boolean;
        permissiveClassifier: boolean;
        skipReceiptVerify: boolean;
    };
}

export function buildTrackingAudit(
    state: BotState,
    tracker: MintTracker | null
): TrackingAuditResult {
    const union = StateManager.getUnionOfTrackedAddresses(state);
    const unionSet = new Set(union);
    const watching = tracker?.getTrackedAddresses() ?? [];
    const watchingSet = new Set(watching.map(a => a.toLowerCase()));

    const onlyInState = union.filter(a => !watchingSet.has(a));
    const onlyInTracker = watching.filter(a => !unionSet.has(a.toLowerCase()));

    const personalEntries = Object.values(state.userTrackedAddresses || {}).reduce(
        (sum, list) => sum + (list?.length || 0),
        0
    );

    const issues: string[] = [];
    if (!tracker?.running) {
        issues.push('tracker_not_running');
    }
    if (union.length > 0 && watching.length === 0) {
        issues.push('state_has_whales_but_tracker_empty');
    }
    if (onlyInState.length > 0) {
        issues.push('addresses_not_synced_to_tracker');
    }
    if (onlyInTracker.length > 0) {
        issues.push('stale_addresses_in_tracker');
    }
    if (union.length === 0) {
        issues.push('no_whales_configured');
    }

    return {
        ok: issues.length === 0 || (issues.length === 1 && issues[0] === 'no_whales_configured'),
        globalCount: state.trackedAddresses?.length || 0,
        personalEntries,
        unionCount: union.length,
        trackerWatching: watching.length,
        trackerRunning: tracker?.running ?? false,
        onlyInState: onlyInState.slice(0, 20),
        onlyInTracker: onlyInTracker.slice(0, 20),
        issues,
        stats: tracker?.getStats?.() ?? null,
        config: {
            pendingDetection: getRuntimeConfig().enablePendingDetection,
            mempoolPendingEffective: getMempoolPendingStatus(tracker).effective,
            blockFallback: getRuntimeConfig().enableBlockFallback,
            permissiveClassifier: process.env.TRACKER_PERMISSIVE_CLASSIFIER !== 'false',
            skipReceiptVerify: process.env.SKIP_CONFIRMED_RECEIPT_VERIFY !== 'false',
        },
    };
}
