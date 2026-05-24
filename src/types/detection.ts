/**
 * Detection event types for the mint tracker.
 * Supports both pending (mempool) and confirmed (block) detection paths.
 */

export type DetectionSource = 'pending' | 'confirmed' | 'manual';

export interface DetectedMintEvent {
    hash: string;
    from: string;
    to: string;
    value: string;
    data: string;
    timestamp: number;
    source: DetectionSource;
    blockNumber?: number;
    confidence: 'high' | 'medium' | 'low';
}

export interface MintClassification {
    isMint: boolean;
    confidence: 'high' | 'medium' | 'low';
    selector: string;
    selectorName?: string;
    reason?: string;
}

export interface TrackerStats {
    blocksProcessed: number;
    pendingTxsSeen: number;
    mintsDetected: number;
    duplicatesSkipped: number;
    nonMintsRejected: number;
    wsConnected: boolean;
    wsReconnects: number;
    lastBlockTime: number;
    lastPendingTime: number;
    /** Pending getTransaction lookups skipped due to rate/concurrency caps. */
    pendingLookupThrottled: number;
    /** Snapshot: pending fetches in flight right now. */
    pendingInFlight: number;
}
