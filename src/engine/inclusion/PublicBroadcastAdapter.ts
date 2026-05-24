import { Wallet, type JsonRpcProvider } from 'ethers';
import { confirmNonce, handleNonceError, reserveNonce } from '../NonceManager';
import { EngineRpcPool } from '../RpcPool';
import { DEFERRED_NONCE } from '../GasPlanner';
import type { ErrorCategory, WalletExecutionPlan, WalletReceipt } from '../../types/copyMint';

export class PublicBroadcastAdapter {
    static async broadcast(
        provider: JsonRpcProvider,
        plan: WalletExecutionPlan
    ): Promise<WalletReceipt> {
        if (!plan.canBroadcast) {
            return skippedReceipt(plan);
        }

        const start = Date.now();
        const wallet = new Wallet(plan.privateKey, provider);

        let nonce = plan.nonce;
        if (nonce === DEFERRED_NONCE) {
            const rpcNonce = await EngineRpcPool.safePreflight(
                () => provider.getTransactionCount(plan.walletAddress, 'pending'),
                `nonce/${plan.maskedWalletAddress}`
            );
            if (rpcNonce === null) {
                return {
                    ...baseFields(plan),
                    status: 'skipped',
                    errorCategory: 'rpc_rate_limit',
                    errorMessage: 'RPC rate limit fetching nonce at broadcast',
                };
            }
            nonce = reserveNonce(plan.walletAddress, rpcNonce);
        }

        try {
            const receipt = await sendWithRetry(wallet, {
                to: plan.to,
                data: plan.data,
                value: BigInt(plan.value || '0'),
                nonce,
                gasLimit: plan.gasLimit,
                maxFeePerGas: plan.maxFeePerGas,
                maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
                type: 2 as const,
            });

            confirmNonce(plan.walletAddress, nonce);

            return {
                walletIndex: plan.walletIndex,
                walletAddress: plan.walletAddress,
                maskedWalletAddress: plan.maskedWalletAddress,
                status: 'submitted',
                txHash: receipt.hash,
                nonce,
                value: plan.value,
                gasLimit: plan.gasLimit,
                maxFeePerGas: plan.maxFeePerGas,
                maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
                requiredBalance: plan.requiredBalance,
                balance: plan.balance,
                shortage: 0n,
                timings: { broadcastMs: Date.now() - start },
            };
        } catch (err: unknown) {
            const msg = (err as Error).message || String(err);
            handleNonceError(plan.walletAddress, msg);
            return {
                ...baseFields(plan),
                status: 'failed',
                nonce,
                shortage: 0n,
                errorCategory: categorizeError(msg),
                errorMessage: msg.slice(0, 200),
                timings: { broadcastMs: Date.now() - start },
            };
        }
    }
}

function baseFields(plan: WalletExecutionPlan) {
    return {
        walletIndex: plan.walletIndex,
        maskedWalletAddress: plan.maskedWalletAddress,
        value: plan.value,
        gasLimit: plan.gasLimit,
        maxFeePerGas: plan.maxFeePerGas,
        maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
        requiredBalance: plan.requiredBalance,
        balance: plan.balance,
        shortage: plan.shortage,
    };
}

function skippedReceipt(plan: WalletExecutionPlan): WalletReceipt {
    return {
        ...baseFields(plan),
        status: 'skipped',
        errorCategory: categorizeSkip(plan.skipReason),
        errorMessage: plan.skipReason,
    };
}

function categorizeSkip(reason?: string): ErrorCategory {
    if (!reason) return 'other';
    if (reason.includes('Insufficient')) return 'insufficient_funds';
    if (reason.includes('RPC rate')) return 'rpc_rate_limit';
    if (reason.includes('MAX_TOTAL')) return 'max_cap';
    return 'other';
}

async function sendWithRetry(
    wallet: Wallet,
    tx: Parameters<Wallet['sendTransaction']>[0],
    attempts = 3
) {
    let lastErr: unknown;
    for (let a = 0; a < attempts; a++) {
        try {
            return await wallet.sendTransaction(tx);
        } catch (err: unknown) {
            lastErr = err;
            const msg = ((err as Error).message || '').toLowerCase();
            const retryable =
                msg.includes('coalesce') ||
                msg.includes('rate limit') ||
                msg.includes('-32007') ||
                msg.includes('timeout');
            if (!retryable || a === attempts - 1) throw err;
            await new Promise(r => setTimeout(r, 150 * (a + 1)));
        }
    }
    throw lastErr;
}

function categorizeError(msg: string): ErrorCategory {
    const m = msg.toLowerCase();
    if (m.includes('insufficient funds')) return 'insufficient_funds';
    if (m.includes('nonce too low')) return 'nonce_error';
    if (m.includes('replacement transaction underpriced')) return 'nonce_error';
    if (m.includes('rate limit') || m.includes('-32007')) return 'rpc_rate_limit';
    return 'other';
}
