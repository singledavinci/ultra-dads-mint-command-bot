import type { Provider } from 'ethers';
import type { InclusionMode } from './inclusion';

export type DetectionSource = 'pending' | 'block' | 'manual' | 'link' | 'scheduled';
export type TriggerType = 'automint' | 'manual' | 'link' | 'scheduled' | 'preview';
export type Confidence = 'high' | 'medium' | 'low';
export type PaymentMode = 'free' | 'paid' | 'unknown' | 'rejected';
export type GasMode = 'normal' | 'mirror' | 'overdrive' | 'fixed';
export type MintType =
    | 'erc721_direct'
    | 'erc721a'
    | 'seadrop'
    | 'manifold'
    | 'zora'
    | 'thirdweb'
    | 'custom'
    | 'unknown'
    | 'rejected';

export interface DetectedMintCandidate {
    detectionId: string;
    sourceTxHash?: string;
    sourceWallet?: string;
    target: string;
    to: string;
    data: string;
    value: string;
    chainId?: number;
    nonce?: number;
    gasLimit?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    detectedAtMs: number;
    detectionSource: DetectionSource;
    rawTxSummary?: string;
    warnings?: string[];
}

export interface MintClassification {
    isLikelyMint: boolean;
    confidence: Confidence;
    mintType: MintType;
    methodSelector: string;
    methodName?: string;
    decodedQuantity?: number;
    detectedRecipient?: string;
    calldataNeedsWalletRewrite: boolean;
    rejectionReason?: string;
    warnings: string[];
}

export interface PaymentPlan {
    paymentMode: PaymentMode;
    selectedValue: string;
    sourceTxValue: string;
    valuePerToken: bigint;
    quantity: number;
    confidence: Confidence;
    shouldExecute: boolean;
    reason: string;
    warnings: string[];
    simulation: {
        zeroValueWorks: boolean;
        sourceValueWorks: boolean;
        scaledValueWorks: boolean;
        adjustedValueWorks: boolean;
        errors: string[];
    };
}

export interface GasPlan {
    gasMode: GasMode;
    estimatedGas: bigint;
    gasLimit: bigint;
    gasLimitMultiplier: number;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    estimatedGasCostEth: string;
    requiredBalanceEth: string;
    sourceGasMirrored: boolean;
    warnings: string[];
}

export interface WalletExecutionPlan {
    walletIndex: number;
    walletAddress: string;
    maskedWalletAddress: string;
    privateKey: string;
    nonce: number;
    to: string;
    data: string;
    value: string;
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    requiredBalance: bigint;
    balance: bigint;
    shortage: bigint;
    canBroadcast: boolean;
    skipReason?: string;
    warnings: string[];
}

export type WalletReceiptStatus =
    | 'skipped'
    | 'signed'
    | 'submitted'
    | 'confirmed'
    | 'reverted'
    | 'dropped'
    | 'timeout'
    | 'failed';

export type ErrorCategory =
    | 'insufficient_funds'
    | 'payment_unknown'
    | 'non_mint'
    | 'allowlist'
    | 'already_minted'
    | 'max_cap'
    | 'gas_estimate_failed'
    | 'rpc_rate_limit'
    | 'nonce_error'
    | 'reverted'
    | 'duplicate'
    | 'other';

export interface WalletReceipt {
    walletIndex: number;
    walletAddress?: string;
    maskedWalletAddress: string;
    status: WalletReceiptStatus;
    /** On-chain mint tx hash (set for builder bundles after submit) */
    mintTxHash?: string;
    /** Flashbots bundle hash when submissionRoute is bundle */
    bundleHash?: string;
    bundleTargetBlock?: number;
    txHash?: string;
    nonce?: number;
    value: string;
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    requiredBalance: bigint;
    balance: bigint;
    shortage: bigint;
    errorCategory?: ErrorCategory;
    errorMessage?: string;
    rpcUsed?: string;
    timings?: { broadcastMs?: number; confirmMs?: number };
}

export interface ExecutionResult {
    executionId: string;
    triggerType: TriggerType;
    sourceTxHash?: string;
    sourceWallet?: string;
    targetContract: string;
    classification: MintClassification;
    paymentPlan: PaymentPlan;
    gasSummary: string;
    walletCount: number;
    skippedCount: number;
    submittedCount: number;
    confirmedCount: number;
    revertedCount: number;
    timeoutCount: number;
    failedCount: number;
    duplicateSkippedCount: number;
    totalValueAttempted: string;
    totalGasEstimated: string;
    detectionLatencyMs: number;
    classificationLatencyMs: number;
    preflightLatencyMs: number;
    broadcastLatencyMs: number;
    confirmationLatencyMs: number;
    receipts: WalletReceipt[];
    errorsByCategory: Partial<Record<ErrorCategory, number>>;
    createdAt: number;
    /** Legacy PromiseSettledResult compatibility for bot/index.ts */
    legacyResults: Array<{ status: 'fulfilled' | 'rejected'; value?: unknown; reason?: unknown; uid?: string }>;
}

export interface CopyMintExecuteInput {
    triggerType: TriggerType;
    provider: Provider;
    privateKeys: string[];
    candidate: DetectedMintCandidate;
    options?: CopyMintEngineOptions;
    /** Override value passed to legacy wrapper paths */
    paymentPlanValue?: string;
}

export interface CopyMintEngineOptions {
    maxMintLimit?: string;
    gasBribeGwei?: string;
    /** /mint gas advisor tier — fees derived from live network gwei at broadcast */
    gasTierId?: string;
    gasLimitOverride?: string;
    /** Inclusion routing: public | protected | builder_flashbots | builder_titan */
    inclusionMode?: InclusionMode;
    /** Builder coinbase tip in wei (capped by MAX_BUILDER_TIP_ETH) */
    builderTipWei?: string;
    /** Legacy alias for builder tip (priority boost in wei) */
    priorityBoostWei?: string;
    /** Target block for builder bundle (default: head+1) */
    targetBlock?: number;
    /** Submit all wallets in one atomic builder bundle */
    bundleAllWallets?: boolean;
    /** @deprecated Use inclusionMode=protected */
    mevProtection?: boolean;
    skipSimulation?: boolean;
    disableMaxMint?: boolean;
    overdrive?: boolean;
    throttleSimulations?: boolean;
    whaleAddress?: string;
    uid?: string;
    quantity?: number;
    allowUnknownPayment?: boolean;
    skipClassification?: boolean;
    /** Bot already ran payment detection — skip engine re-sim with stricter caps */
    paymentPrevalidated?: boolean;
    /** Link mint / SeaDrop / Scatter: always estimateGas (ignore SKIP_RPC_PREFLIGHT fast path) */
    forceGasEstimate?: boolean;
    /** Match whale source tx maxFee/priority when higher (copy-mint competitiveness) */
    mirrorWhaleGas?: boolean;
    /** Active HD keys at the start of privateKeys (from getUserWallets) — used for execution cap */
    hdWalletKeyCount?: number;
    /** @deprecated Use hdWalletKeyCount — trailing imported count (fallback only) */
    importedWalletCount?: number;
    /** Admin override: do not apply MAX_WALLETS_PER_EXECUTION cap. */
    bypassWalletCap?: boolean;
    /** Admin override: attempt broadcast even when preflight balance is below required threshold. */
    ignoreInsufficientBalance?: boolean;
    /** Scatter.art collection slug — rebuild mint calldata per wallet via Scatter API */
    scatterSlug?: string;
    /** SeaDrop NFT contract — rebuild mint calldata per wallet (GTD/public/signed) */
    seaDropNftContract?: string;
    /** Whale source tx calldata — per-wallet SeaDrop quantity cap in preflight */
    whaleTxData?: string;
    /** SeaDrop public automint: hijack whale calldata per wallet (skip resolveSeaDropMint RPC) */
    skipSeaDropRebuild?: boolean;
    /** Tx `to` for link mint (SeaDrop router, Scatter batch contract, etc.) */
    executionTo?: string;
}

export interface EngineStatus {
    paused: boolean;
    panic: boolean;
    lastExecution?: ExecutionResult;
    lastCandidate?: DetectedMintCandidate;
    lastSkipReason?: string;
    queueDepth: number;
    dedupeSize: number;
    rpcHealth: Array<{ urls: string[]; errorCount: number; lastLatencyMs: number }>;
}
