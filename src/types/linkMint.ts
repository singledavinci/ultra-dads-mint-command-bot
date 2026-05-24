/**
 * Types for the Auto Mint From Link feature.
 */

export type MintTargetType =
    | 'raw_address'
    | 'etherscan'
    | 'opensea'
    | 'seadrop'
    | 'manifold'
    | 'zora'
    | 'thirdweb'
    | 'catchmint'
    | 'unknown_url';

export type MintPlatform =
    | 'direct_erc721'
    | 'seadrop'
    | 'manifold'
    | 'zora'
    | 'thirdweb'
    | 'unknown';

export type GasMode = 'normal' | 'mirror' | 'overdrive' | 'fixed';

export interface MintTargetCandidate {
    originalText: string;
    target: string;
    type: MintTargetType;
    confidence: 'high' | 'medium' | 'low';
}

export interface ResolvedMintTarget {
    input: string;
    contractAddress: string;
    chainId: number;
    platform: MintPlatform;
    name: string;
    mintType: MintPlatform;
    confidence: 'high' | 'medium' | 'low';
    sourceUrl?: string;
    warnings: string[];
    requiresManualCalldata: boolean;
    suggestedCalldata?: string;
    suggestedValue?: string;
    suggestedQuantity?: number;
    detectedSelector?: string;
    detectedFunctionName?: string;
}

export interface GasPlan {
    mode: GasMode;
    gasLimit: bigint;
    estimatedGas: bigint;
    gasLimitMultiplier: number;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    estimatedGasCostEth: string;
    requiredBalanceEth: string;
    sourceTxGasWasMirrored: boolean;
    warnings: string[];
}

export interface WalletFundingStatus {
    address: string;
    index: number;
    balance: bigint;
    requiredBalance: bigint;
    funded: boolean;
    shortage: bigint;
}

export interface LinkMintPreview {
    resolved: ResolvedMintTarget;
    gasPlan: GasPlan;
    walletCount: number;
    fundedWallets: number;
    skippedWallets: number;
    totalEthRequired: string;
    totalEthAttempted: string;
    fundingDetails: WalletFundingStatus[];
    riskLevel: 'low' | 'medium' | 'high';
    canAutoExecute: boolean;
    blockReasons: string[];
}

export interface LinkMintExecutionResult {
    executionId: string;
    targetContract: string;
    platform: MintPlatform;
    walletCount: number;
    submittedCount: number;
    confirmedCount: number;
    failedCount: number;
    skippedCount: number;
    totalEthAttempted: string;
    totalGasEstimated: string;
    txHashes: string[];
    errors: Array<{ wallet: number; error: string; category: string }>;
    latencyMs: number;
    gasPlan: GasPlan;
}

export interface LinkMintConfig {
    autoMintFromLinks: boolean;
    confirmationRequired: boolean;
    adminOnly: boolean;
    maxMintEth: number;
    maxTotalBatchEth: number;
    defaultQuantity: number;
    simulationMode: 'strict' | 'fast' | 'skip';
    allowUnknownLinkMint: boolean;
    requireKnownSelector: boolean;
    dedupeTtlMs: number;
    gasMode: GasMode;
    overdriveGas: boolean;
    normalGasMultiplier: number;
    mirrorSourceGasThreshold: number;
    maxFeeGwei: number;
    maxPriorityFeeGwei: number;
    overdriveMaxFeeGwei: number;
    overdrivePriorityFeeGwei: number;
    gasLimitMultiplier: number;
    fallbackGasLimit: number;
    strictBalanceCheck: boolean;
    skipUnfundedWallets: boolean;
    minWalletBufferEth: number;
}
