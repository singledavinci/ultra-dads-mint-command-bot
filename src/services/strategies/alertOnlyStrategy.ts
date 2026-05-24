import type { MintCandidate, MintIntent } from '../../types/mintIntent';

export function buildAlertOnlyIntent(candidate: MintCandidate, reason: string): MintIntent {
    const valueWei = candidate.txValueWei || '0';
    const paid = BigInt(valueWei) > 0n;

    return {
        chainId: candidate.chainId,
        sourceTxHash: candidate.sourceTxHash,
        sourceFrom: candidate.sourceFrom,
        routeType: 'alert_only',
        targetContract: candidate.txTo,
        executionTo: candidate.txTo,
        calldata: candidate.txData,
        quantity: 1,
        unitPriceWei: valueWei,
        totalValueWei: valueWei,
        mintType: paid ? 'paid' : 'free',
        confidence: candidate.classificationConfidence ?? 'low',
        requiresProof: false,
        requiresSignature: false,
        requiresTokenGate: false,
        canAutoExecute: false,
        reason,
        detectedAt: candidate.receivedAt,
        sourceQuantity: 1,
    };
}
