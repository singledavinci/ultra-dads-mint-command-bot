export type TokenStandard = 'ERC721' | 'ERC1155' | 'unknown';
export type MintType = 'free' | 'paid' | 'unknown';
export type MintCategory =
    | 'SUPPORTED_PUBLIC_MINT'
    | 'SUPPORTED_SEADROP_PUBLIC'
    | 'SUPPORTED_SEADROP_ALLOWLIST'
    | 'SUPPORTED_SEADROP_SIGNED'
    | 'CONDITIONAL'
    | 'UNSUPPORTED';

export type SimulationFailureCode =
    | 'SOLD_OUT'
    | 'MINT_NOT_ACTIVE'
    | 'INSUFFICIENT_VALUE'
    | 'MAX_PER_WALLET'
    | 'ALLOWLIST_ONLY'
    | 'INVALID_PROOF'
    | 'INVALID_SIGNATURE'
    | 'ALREADY_MINTED'
    | 'CONTRACT_PAUSED'
    | 'UNKNOWN_REVERT'
    | 'GAS_ESTIMATION_FAILED'
    | 'NOT_RUN';

export type SimulationStatus = 'passed' | 'failed' | 'not_run' | 'skipped';

export interface ContractMintInput {
    chainId?: number;
    contractAddress?: string;
    txHash?: string;
    whaleAddress?: string;
    rawText?: string;
    quantity?: number;
    maxEth?: number;
    signerAddress?: string;
    alertMessageId?: string;
}

export interface DetectedContractMint {
    chainId: number;
    tokenContract: string;
    executionTarget: string;
    txHash?: string;
    whaleAddress?: string;
    fromAddress: string;
    valueWei: string;
    calldata: string;
    selector: string;
    tokenStandard: TokenStandard;
    quantity: number;
    mintRecipient?: string;
    collectionName?: string;
    blockNumber?: number;
    detectionSource: 'tx_receipt' | 'manual' | 'alert_text' | 'tracked_wallet';
    isSeaDrop: boolean;
    seaDropNftContract?: string;
}

export interface ContractMintPlan {
    chainId: number;
    tokenContract: string;
    executionTarget: string;
    mintType: MintType;
    tokenStandard: TokenStandard;
    functionName: string;
    selector: string;
    args?: readonly unknown[];
    quantity: number;
    value: string;
    calldata: string;
    estimatedGas?: bigint;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    simulationStatus: SimulationStatus;
    simulationFailure?: SimulationFailureCode;
    executable: boolean;
    category: MintCategory;
    sourceTxHash?: string;
    whaleAddress?: string;
    collectionName?: string;
    actionTaken?: string;
    skipReason?: string;
}

export interface ContractMintPipelineResult {
    detected?: DetectedContractMint;
    plan?: ContractMintPlan;
    alertText: string;
    executed: boolean;
    executionTxHashes?: string[];
}
