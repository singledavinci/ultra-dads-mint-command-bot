/**
 * Effective concurrency + detection capacity snapshot for /debug_capacity.
 */
import { getRuntimeConfig } from '../config/runtimeConfig';
import {
    effectiveSkipRpcPreflight,
    effectiveStreamBroadcast,
} from '../config/capacityOverrides';
import { ExecutionQueue } from '../engine/ExecutionQueue';
import { getDebugStats as getRpcBudgetDebug } from '../services/rpcBudgetManager';
import { trackerDebugState } from '../services/trackerDebugState';
import { getMempoolPendingStatus, type MempoolPendingTrackerLike } from './mempoolPendingStatus';
import type { MintTracker } from './trackerCore';

export interface CapacityLiveStats {
    rpc429Count: number;
    rpcReadErrors: number;
    trackerRpcErrors: number;
    engineQueueDepth: number;
    enginePaused: boolean;
    enginePanic: boolean;
    pendingLookupThrottled: number;
    pendingInFlight: number;
}

export interface CapacityStatus {
    version: string;
    executionConcurrency: number;
    preflightConcurrency: number;
    simulationConcurrency: number;
    automintUserConcurrency: number;
    globalMintUserConcurrency: number;
    maxWalletsPerExecution: number;
    streamBroadcast: boolean;
    skipRpcPreflight: boolean;
    rpcRetryAttempts: number;
    rpcRetryBaseMs: number;
    trackerBootGraceMs: number;
    trackerMaxPendingRpcPerSec: number;
    trackerMaxPendingConcurrent: number;
    mempoolPending: ReturnType<typeof getMempoolPendingStatus>;
    trackerRunning: boolean;
    wsConnected: boolean;
    live: CapacityLiveStats;
}

export function buildCapacityStatus(
    tracker: MintTracker | null,
    botVersion: string
): CapacityStatus {
    const cfg = getRuntimeConfig();
    const stats = tracker?.getStats?.() || {
        wsConnected: false,
        pendingLookupThrottled: 0,
        pendingInFlight: 0,
    };
    const pending = getMempoolPendingStatus(tracker as MempoolPendingTrackerLike | null);
    const rpc = getRpcBudgetDebug();
    const trackerDbg = trackerDebugState.get();

    return {
        version: botVersion,
        executionConcurrency: cfg.executionConcurrency,
        preflightConcurrency: cfg.preflightConcurrency,
        simulationConcurrency: cfg.simulationConcurrency,
        automintUserConcurrency: cfg.automintUserConcurrency,
        globalMintUserConcurrency: cfg.globalMintUserConcurrency,
        maxWalletsPerExecution: cfg.maxWalletsPerExecution,
        streamBroadcast: effectiveStreamBroadcast(),
        skipRpcPreflight: effectiveSkipRpcPreflight(),
        rpcRetryAttempts: cfg.rpcRetryAttempts,
        rpcRetryBaseMs: cfg.rpcRetryBaseMs,
        trackerBootGraceMs: cfg.trackerBootGraceMs,
        trackerMaxPendingRpcPerSec: cfg.trackerMaxPendingRpcPerSec,
        trackerMaxPendingConcurrent: cfg.trackerMaxPendingConcurrent,
        mempoolPending: pending,
        trackerRunning: Boolean(tracker?.running),
        wsConnected: Boolean(stats.wsConnected),
        live: {
            rpc429Count: rpc.rpc429Count,
            rpcReadErrors: rpc.readErrors,
            trackerRpcErrors: trackerDbg.rpcErrors,
            engineQueueDepth: ExecutionQueue.depth(),
            enginePaused: ExecutionQueue.isSoftPaused(),
            enginePanic: ExecutionQueue.isPanic(),
            pendingLookupThrottled: stats.pendingLookupThrottled ?? 0,
            pendingInFlight: stats.pendingInFlight ?? 0,
        },
    };
}

export function formatCapacityStatusHtml(s: CapacityStatus): string {
    const mp = s.mempoolPending;
    const live = s.live;
    return (
        `⚡ <b>CAPACITY</b> · v${s.version}\n\n` +
        `<b>Execution</b>\n` +
        `Users/automint: <b>${s.automintUserConcurrency}</b> · Global mint: <b>${s.globalMintUserConcurrency}</b>\n` +
        `Wallets/exec: <b>${s.executionConcurrency}</b> · Preflight RPC: <b>${s.preflightConcurrency}</b> · Sim: <b>${s.simulationConcurrency}</b>\n` +
        `Max wallets/run: <b>${s.maxWalletsPerExecution}</b> · Stream #1: <b>${s.streamBroadcast ? 'ON' : 'OFF'}</b>\n` +
        `Fast preflight: <b>${s.skipRpcPreflight ? 'ON' : 'OFF'}</b>\n\n` +
        `<b>Detection</b>\n` +
        `Mempool: <b>${mp.menuLabel}</b> · WS: <b>${s.wsConnected ? 'connected' : 'off'}</b>\n` +
        `Boot grace: <b>${Math.round(s.trackerBootGraceMs / 1000)}s</b> · Pending RPC: <b>${s.trackerMaxPendingRpcPerSec}/s</b> · Concurrent: <b>${s.trackerMaxPendingConcurrent}</b>\n\n` +
        `<b>Live pressure</b>\n` +
        `RPC 429s: <b>${live.rpc429Count}</b> · Read errors: <b>${live.rpcReadErrors}</b> · Tracker errs: <b>${live.trackerRpcErrors}</b>\n` +
        `Pending throttled: <b>${live.pendingLookupThrottled}</b> · In flight: <b>${live.pendingInFlight}</b> · Queue: <b>${live.engineQueueDepth}</b>\n` +
        `Engine: <b>${live.enginePanic ? 'PANIC' : live.enginePaused ? 'PAUSED' : 'OK'}</b>\n\n` +
        `<b>RPC retry</b>\n` +
        `Attempts: <b>${s.rpcRetryAttempts}</b> · Base: <b>${s.rpcRetryBaseMs}ms</b>`
    );
}
