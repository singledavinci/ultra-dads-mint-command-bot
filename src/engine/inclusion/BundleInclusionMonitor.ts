import { Transaction, type JsonRpcProvider, type TransactionReceipt } from 'ethers';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { inclusionMetrics } from './inclusionMetrics';
import { resolveBundleRunOutcome } from './bundleInclusionLogic';
import { FlashbotsBuilder } from './builders/FlashbotsBuilder';
import type { BuilderAdapter } from './builders/BuilderAdapter';
import { confirmNonce, resetNonce } from '../NonceManager';
import type { WalletReceipt } from '../../types/copyMint';

export type { BundleRunOutcome } from './bundleInclusionLogic';
export { resolveBundleRunOutcome } from './bundleInclusionLogic';

export interface BundleMonitorStats {
    confirmed: number;
    reverted: number;
    timeout: number;
}

interface PendingBundleTrack {
    bundleHash: string;
    targetBlock: number;
    builderName: string;
    submittedAt: number;
    receipts: WalletReceipt[];
}

const pendingTracks: PendingBundleTrack[] = [];

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class BundleInclusionMonitor {
    static getPendingCount(): number {
        return pendingTracks.length;
    }

    static getPendingSummary(): Array<{
        bundleHash: string;
        targetBlock: number;
        wallets: number;
        ageMs: number;
    }> {
        const now = Date.now();
        return pendingTracks.map(t => ({
            bundleHash: t.bundleHash,
            targetBlock: t.targetBlock,
            wallets: t.receipts.length,
            ageMs: now - t.submittedAt,
        }));
    }

    /**
     * Poll mint tx receipts until included, reverted, or missed.
     * Confirms or resets nonces per BUNDLE_MECHANICS_SPEC.md.
     */
    static async monitorSubmitted(
        provider: JsonRpcProvider,
        receipts: WalletReceipt[],
        options?: {
            builder?: BuilderAdapter;
            onUpdate?: (receipt: WalletReceipt) => void;
        }
    ): Promise<BundleMonitorStats> {
        const bundleReceipts = receipts.filter(
            r => r.status === 'submitted' && r.bundleHash && r.mintTxHash && r.walletAddress
        );
        if (bundleReceipts.length === 0) {
            return { confirmed: 0, reverted: 0, timeout: 0 };
        }

        const cfg = getRuntimeConfig();
        const targetBlock = bundleReceipts[0]!.bundleTargetBlock ?? 0;
        const bundleHash = bundleReceipts[0]!.bundleHash!;
        const builder = options?.builder ?? new FlashbotsBuilder();
        const submittedAt = Date.now();

        const track: PendingBundleTrack = {
            bundleHash,
            targetBlock,
            builderName: bundleReceipts[0]!.rpcUsed?.split('@')[0] || 'flashbots',
            submittedAt,
            receipts: bundleReceipts,
        };
        pendingTracks.push(track);

        const stats: BundleMonitorStats = { confirmed: 0, reverted: 0, timeout: 0 };
        const deadlineMs = submittedAt + cfg.txWaitTimeoutMs;
        const lastPollBlock = targetBlock + cfg.builderInclusionGraceBlocks;

        try {
            while (Date.now() < deadlineMs) {
                const head = await provider.getBlockNumber();
                const mintHashes = bundleReceipts.map(r => r.mintTxHash!);
                const chainReceipts = await Promise.all(
                    mintHashes.map(h => provider.getTransactionReceipt(h).catch(() => null))
                );

                const outcome = resolveBundleRunOutcome(chainReceipts);

                if (outcome === 'pending') {
                    if (head >= targetBlock && builder.getBundleStats) {
                        try {
                            await builder.getBundleStats(bundleHash, targetBlock);
                        } catch {
                            /* optional relay signal */
                        }
                    }
                    await sleep(cfg.builderInclusionPollMs);
                    continue;
                }

                if (outcome === 'confirmed') {
                    BundleInclusionMonitor.finalizeWallets(
                        bundleReceipts,
                        chainReceipts,
                        'confirmed',
                        stats,
                        options?.onUpdate
                    );
                    inclusionMetrics.bundlesIncluded++;
                    return stats;
                }

                if (outcome === 'reverted') {
                    BundleInclusionMonitor.finalizeWallets(
                        bundleReceipts,
                        chainReceipts,
                        'reverted',
                        stats,
                        options?.onUpdate
                    );
                    return stats;
                }

                if (head > lastPollBlock) {
                    break;
                }

                await sleep(cfg.builderInclusionPollMs);
            }

            stats.timeout = bundleReceipts.length;
            for (const receipt of bundleReceipts) {
                receipt.status = 'timeout';
                receipt.errorMessage = `Bundle not included by block ${lastPollBlock}`;
                if (receipt.walletAddress) resetNonce(receipt.walletAddress);
                options?.onUpdate?.(receipt);
            }
            return stats;
        } finally {
            const idx = pendingTracks.indexOf(track);
            if (idx >= 0) pendingTracks.splice(idx, 1);
        }
    }

    private static finalizeWallets(
        bundleReceipts: WalletReceipt[],
        chainReceipts: (TransactionReceipt | null)[],
        finalStatus: 'confirmed' | 'reverted',
        stats: BundleMonitorStats,
        onUpdate?: (receipt: WalletReceipt) => void
    ): void {
        for (let i = 0; i < bundleReceipts.length; i++) {
            const receipt = bundleReceipts[i]!;
            const chain = chainReceipts[i];
            const walletOk = chain && chain.status === 1;

            if (finalStatus === 'confirmed' && walletOk) {
                receipt.status = 'confirmed';
                receipt.txHash = chain!.hash;
                if (receipt.walletAddress && receipt.nonce !== undefined) {
                    confirmNonce(receipt.walletAddress, receipt.nonce);
                }
                stats.confirmed++;
            } else {
                receipt.status = 'reverted';
                receipt.errorCategory = 'reverted';
                receipt.errorMessage = 'Mint tx reverted on-chain';
                if (chain?.hash) receipt.txHash = chain.hash;
                if (receipt.walletAddress && receipt.nonce !== undefined) {
                    confirmNonce(receipt.walletAddress, receipt.nonce);
                }
                stats.reverted++;
            }
            onUpdate?.(receipt);
        }
    }
}

/** Parse hash from a signed tx hex (for tests). */
export function hashFromSignedTx(signedTx: string): string {
    return Transaction.from(signedTx).hash!;
}
