/**
 * Transaction inclusion modes — public mempool, MEV protection, or builder bundles.
 *
 * | User-facing      | Mode                 | Use case                          |
 * |------------------|----------------------|-----------------------------------|
 * | Public mempool   | public               | Default FCFS via user RPC         |
 * | Protected        | protected            | Anti-sandwich (MEV Blocker)       |
 * | Builder (FCFS)   | builder_flashbots    | Competitive sniping via bundles   |
 * | Builder (alt)    | builder_titan        | Phase 4 fallback relay            |
 */

export type InclusionMode = 'public' | 'protected' | 'builder_flashbots' | 'builder_titan';

export const INCLUSION_MODES: InclusionMode[] = [
    'public',
    'protected',
    'builder_flashbots',
    'builder_titan',
];

export interface SignedBundleTx {
    signedTx: string;
    walletAddress: string;
    nonce: number;
    /** mint = NFT tx; coinbase_tip = helper contract payment (excluded from partial regen drops) */
    role?: 'mint' | 'coinbase_tip';
}

export interface BundleSpec {
    txs: SignedBundleTx[];
    targetBlock: number;
    minTimestamp?: number;
    maxTimestamp?: number;
}

export interface BundleSimulationResult {
    success: boolean;
    error?: string;
    gasUsed?: bigint;
    coinbaseDiff?: bigint;
}

export interface BundleSubmitResult {
    bundleHash: string;
    targetBlock: number;
}

export interface InclusionBroadcastOptions {
    inclusionMode?: InclusionMode;
    /** @deprecated Use inclusionMode=protected */
    mevProtection?: boolean;
    /** EIP-1559 priority boost budget (wei) — not a coinbase transfer */
    builderTipWei?: bigint;
    priorityBoostWei?: bigint;
    targetBlock?: number;
    /** Phase 3: submit all wallet txs in one atomic bundle */
    bundleAllWallets?: boolean;
}

export interface InclusionMetrics {
    bundlesSubmitted: number;
    bundlesIncluded: number;
    bundlesPartialRegen: number;
    publicBroadcasts: number;
    protectedBroadcasts: number;
    lastBundleHash?: string;
    lastError?: string;
}
