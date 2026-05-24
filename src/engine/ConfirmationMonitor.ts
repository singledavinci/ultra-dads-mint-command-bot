import type { JsonRpcProvider } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { resetNonce } from './NonceManager';
import type { WalletReceipt } from '../types/copyMint';

export class ConfirmationMonitor {
    static async monitorSubmitted(
        provider: JsonRpcProvider,
        receipts: WalletReceipt[],
        onUpdate?: (receipt: WalletReceipt) => void
    ): Promise<{ confirmed: number; reverted: number; timeout: number }> {
        const cfg = getRuntimeConfig();
        let confirmed = 0;
        let reverted = 0;
        let timeout = 0;

        const tasks = receipts
            .filter(r => r.status === 'submitted' && r.txHash && !r.bundleHash)
            .map(async (receipt) => {
                const start = Date.now();
                const watchHash = receipt.mintTxHash ?? receipt.txHash!;
                try {
                    const tx = await provider.getTransaction(watchHash);
                    if (!tx) {
                        receipt.status = 'dropped';
                        if (receipt.walletAddress) resetNonce(receipt.walletAddress);
                        return;
                    }

                    const result = await Promise.race([
                        tx.wait(cfg.confirmationBlocks),
                        new Promise<null>((_, reject) =>
                            setTimeout(() => reject(new Error('timeout')), cfg.txWaitTimeoutMs)
                        ),
                    ]);

                    if (!result) return;

                    if (result.status === 1) {
                        receipt.status = 'confirmed';
                        confirmed++;
                    } else {
                        receipt.status = 'reverted';
                        reverted++;
                    }
                    receipt.timings = {
                        ...receipt.timings,
                        confirmMs: Date.now() - start,
                    };
                    onUpdate?.(receipt);
                } catch (e: unknown) {
                    const msg = (e as Error).message || '';
                    if (msg.includes('timeout')) {
                        receipt.status = 'timeout';
                        timeout++;
                    } else {
                        receipt.status = 'failed';
                    }
                    onUpdate?.(receipt);
                }
            });

        await Promise.allSettled(tasks);
        return { confirmed, reverted, timeout };
    }
}
