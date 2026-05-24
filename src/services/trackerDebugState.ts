import type { MintCandidate } from '../types/mintIntent';
import type { TrackerSkipReason } from '../types/mintIntent';

export type TrackerMode = 'stopped' | 'pending' | 'block' | 'hybrid';

export interface TrackerDebugSnapshot {
    mode: TrackerMode;
    lastSkipReason?: TrackerSkipReason | string;
    lastCandidate?: MintCandidate;
    rpcErrors: number;
    duplicateCount: number;
    lastUpdatedAt: number;
}

const state: TrackerDebugSnapshot = {
    mode: 'stopped',
    rpcErrors: 0,
    duplicateCount: 0,
    lastUpdatedAt: Date.now(),
};

export const trackerDebugState = {
    get(): TrackerDebugSnapshot {
        return { ...state };
    },

    setMode(mode: TrackerMode): void {
        state.mode = mode;
        state.lastUpdatedAt = Date.now();
    },

    setLastSkipReason(reason: TrackerSkipReason | string | undefined): void {
        state.lastSkipReason = reason;
        state.lastUpdatedAt = Date.now();
    },

    setLastCandidate(candidate: MintCandidate | undefined): void {
        state.lastCandidate = candidate;
        state.lastUpdatedAt = Date.now();
    },

    incrementRpcErrors(): void {
        state.rpcErrors++;
        state.lastUpdatedAt = Date.now();
    },

    incrementDuplicates(): void {
        state.duplicateCount++;
        state.lastUpdatedAt = Date.now();
    },

    reset(): void {
        state.mode = 'stopped';
        state.lastSkipReason = undefined;
        state.lastCandidate = undefined;
        state.rpcErrors = 0;
        state.duplicateCount = 0;
        state.lastUpdatedAt = Date.now();
    },
};
