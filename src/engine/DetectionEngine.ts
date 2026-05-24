import type { DetectedMint } from '../utils/trackerCore';
import type { DetectedMintCandidate } from '../types/copyMint';

let lastSeenBlock = 0;
let lastPendingTxSeen = 0;
let lastDetectedTrackedTx = 0;

export class DetectionEngine {
    static candidateFromTracker(mint: DetectedMint): DetectedMintCandidate {
        lastDetectedTrackedTx = Date.now();
        return {
            detectionId: `det-${mint.hash.slice(0, 18)}-${Date.now()}`,
            sourceTxHash: mint.hash,
            sourceWallet: mint.from,
            target: mint.to,
            to: mint.to,
            data: mint.data,
            value: mint.value,
            detectedAtMs: mint.timestamp || Date.now(),
            detectionSource: mint.detectionPath === 'pending' ? 'pending' : 'block',
            warnings: [],
        };
    }

    static candidateFromManual(params: {
        to: string;
        data: string;
        value: string;
        sourceWallet?: string;
    }): DetectedMintCandidate {
        return {
            detectionId: `manual-${Date.now()}`,
            sourceWallet: params.sourceWallet,
            target: params.to,
            to: params.to,
            data: params.data,
            value: params.value,
            detectedAtMs: Date.now(),
            detectionSource: 'manual',
        };
    }

    static noteBlock(blockNumber: number): void {
        lastSeenBlock = blockNumber;
    }

    static notePending(): void {
        lastPendingTxSeen = Date.now();
    }

    static getStats() {
        return { lastSeenBlock, lastPendingTxSeen, lastDetectedTrackedTx };
    }
}
