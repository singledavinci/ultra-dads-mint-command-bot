/**
 * Core pipeline types: detection -> classification -> execution.
 */

export type DetectionSource = 'pending' | 'block' | 'catchup' | 'manual';

export type MatchedReason =
    | 'trackedFrom'
    | 'mintTransferToTrackedWallet'
    | 'knownRouter'
    | 'manualContract';

export type TrackerSkipReason =
    | 'walletNotTracked'
    | 'duplicateTx'
    | 'noMintSignal'
    | 'unsupportedRouter'
    | 'receiptFetchFailed'
    | 'rpcRateLimited'
    | 'blockAlreadySeen'
    | 'pendingDisabled'
    | 'bootGrace'
    | 'staleBlock'
    | 'classifierRejected';

export interface MintCandidate {
    chainId: number;
    sourceTxHash: string;
    sourceFrom: string;
    txTo: string;
    txData: string;
    txValueWei: string;
    blockNumber?: number;
    detectionSource: DetectionSource;
    matchedReason: MatchedReason;
    receivedAt: number;
    classificationConfidence?: 'high' | 'medium' | 'low';
}

export type MintRouteType =
    | 'seadrop_public'
    | 'seadrop_allowlist'
    | 'seadrop_signed'
    | 'seadrop_token_gated'
    | 'direct_contract'
    | 'copied_replay'
    | 'manual_custom'
    | 'alert_only'
    | 'unknown';

export type MintType = 'free' | 'paid' | 'unknown';
export type IntentConfidence = 'high' | 'medium' | 'low';

export interface MintIntent {
    chainId: number;
    sourceTxHash: string;
    sourceFrom: string;
    routeType: MintRouteType;
    targetContract: string;
    executionTo: string;
    calldata: string;
    quantity: number;
    unitPriceWei: string;
    totalValueWei: string;
    mintType: MintType;
    confidence: IntentConfidence;
    requiresProof: boolean;
    requiresSignature: boolean;
    requiresTokenGate: boolean;
    canAutoExecute: boolean;
    reason: string;
    detectedAt: number;
    sourceQuantity?: number;
}

export type SimulationStatus =
    | 'not_run'
    | 'passed'
    | 'failed'
    | 'skipped'
    | 'timeout';

export type SafetyDecision =
    | 'execute'
    | 'alert_only'
    | 'blocked'
    | 'blind_broadcast';

export interface MintPlan {
    intent: MintIntent;
    walletAddress: string;
    to: string;
    data: string;
    valueWei: string;
    gasLimit?: number;
    gasMode: 'normal' | 'overdrive';
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    nonce?: number;
    simulationStatus: SimulationStatus;
    safetyDecision: SafetyDecision;
}

export type ExecutionStatus =
    | 'planned'
    | 'blocked'
    | 'skipped'
    | 'submitted'
    | 'confirmed'
    | 'reverted'
    | 'dropped'
    | 'replaced'
    | 'failed'
    | 'pending';

export interface ExecutionResult {
    walletAddress: string;
    status: ExecutionStatus;
    txHash?: string;
    errorCode?: string;
    errorMessage?: string;
    explorerUrl?: string;
    latencyMs?: number;
}
