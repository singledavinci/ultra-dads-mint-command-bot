/**
 * Admin RPC relief — cancel queued mint work that hammers the node between drops.
 */
import type { BotState } from '../bot/stateManager';
import { cancelAllBlockMints } from './blockMintScheduler';
import type { MintTracker } from '../utils/trackerCore';
import { getMempoolPendingStatus } from '../utils/mempoolPendingStatus';

export type RpcLoadClearResult = {
    scheduledCancelled: number;
    blockMintsCancelled: number;
    pendingPaused: boolean;
};

export function clearAllScheduledMints(
    schedulerHandles: Map<string, NodeJS.Timeout>,
    state: BotState
): number {
    const pending = (state.scheduledMints || []).filter(s => !s.fired);
    for (const sm of pending) {
        const handle = schedulerHandles.get(sm.id);
        if (handle) {
            clearTimeout(handle);
            schedulerHandles.delete(sm.id);
        }
    }
    state.scheduledMints = (state.scheduledMints || []).filter(s => s.fired);
    return pending.length;
}

export function clearRpcLoad(params: {
    schedulerHandles: Map<string, NodeJS.Timeout>;
    state: BotState;
    tracker: MintTracker | null;
}): RpcLoadClearResult {
    const scheduledCancelled = clearAllScheduledMints(params.schedulerHandles, params.state);
    const blockMintsCancelled = cancelAllBlockMints(params.state.blockMintJobs);
    let pendingPaused = false;
    if (params.tracker?.running) {
        pendingPaused = params.tracker.pausePendingDetection();
    }
    return { scheduledCancelled, blockMintsCancelled, pendingPaused };
}

export function formatRpcLoadStatus(state: BotState, tracker: MintTracker | null): string {
    const scheduled = (state.scheduledMints || []).filter(s => !s.fired).length;
    const blocks = (state.blockMintJobs || []).filter(j => !j.fired && !j.cancelled).length;
    const pending = getMempoolPendingStatus(tracker);
    return (
        `Scheduled drops: <b>${scheduled}</b>\n` +
        `Block snipes: <b>${blocks}</b>\n` +
        `Mempool pending: <b>${pending.debugLine}</b>`
    );
}
