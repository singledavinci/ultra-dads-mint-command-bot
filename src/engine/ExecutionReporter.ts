import { formatEther } from 'ethers';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionResult } from '../types/copyMint';

const TELEGRAM_MAX = 3900;

export class ExecutionReporter {
    static toTelemetryPayload(
        result: ExecutionResult,
        phase: 'submitted' | 'confirmed' = 'submitted'
    ): Record<string, unknown> {
        return {
            event: 'mint_execution',
            phase,
            executionId: result.executionId,
            triggerType: result.triggerType,
            sourceTxHash: result.sourceTxHash,
            targetContract: result.targetContract,
            walletCount: result.walletCount,
            skippedCount: result.skippedCount,
            submittedCount: result.submittedCount,
            confirmedCount: result.confirmedCount,
            revertedCount: result.revertedCount,
            timeoutCount: result.timeoutCount,
            failedCount: result.failedCount,
            detectionLatencyMs: result.detectionLatencyMs,
            classificationLatencyMs: result.classificationLatencyMs,
            preflightLatencyMs: result.preflightLatencyMs,
            broadcastLatencyMs: result.broadcastLatencyMs,
            confirmationLatencyMs: result.confirmationLatencyMs,
            totalToBroadcastMs:
                result.detectionLatencyMs +
                result.classificationLatencyMs +
                result.preflightLatencyMs +
                result.broadcastLatencyMs,
            errorsByCategory: result.errorsByCategory,
            txHashes: result.receipts
                .map(r => r.mintTxHash || r.txHash)
                .filter((hash): hash is string => Boolean(hash)),
            createdAt: result.createdAt,
            recordedAt: Date.now(),
        };
    }

    /**
     * Emit machine-readable timing to Docker logs and a JSONL ledger on the
     * persistent /app/data volume. Telemetry failure never blocks a mint.
     */
    static async recordTelemetry(
        result: ExecutionResult,
        phase: 'submitted' | 'confirmed' = 'submitted'
    ): Promise<void> {
        const payload = ExecutionReporter.toTelemetryPayload(result, phase);
        console.log(`[ExecutionTiming] ${JSON.stringify(payload)}`);
        if (process.env.EXECUTION_LEDGER_ENABLED === 'false') return;
        try {
            const dataDir = process.env.DATA_DIR?.trim() || path.resolve('data');
            await mkdir(dataDir, { recursive: true });
            const day = new Date().toISOString().slice(0, 10);
            await appendFile(
                path.join(dataDir, `execution-ledger-${day}.jsonl`),
                `${JSON.stringify(payload)}\n`,
                'utf8'
            );
        } catch (err) {
            console.warn('[ExecutionTiming] ledger write failed:', (err as Error).message);
        }
    }

    static toTelegramSummary(result: ExecutionResult): string {
        const p = result.paymentPlan;
        const lines = [
            `🎯 <b>Copy-Mint ${result.triggerType}</b>`,
            `ID: <code>${result.executionId.slice(0, 8)}</code>`,
            `Contract: <code>${result.targetContract}</code>`,
            result.sourceWallet ? `Whale: <code>${result.sourceWallet}</code>` : '',
            '',
            '<b>Payment</b>',
            `Mode: ${p.paymentMode} (${p.confidence})`,
            `Selected: ${formatEther(BigInt(p.selectedValue || '0'))} ETH`,
            `Source: ${formatEther(BigInt(p.sourceTxValue || '0'))} ETH`,
            `Qty: ${p.quantity}`,
            `Reason: ${p.reason}`,
            '',
            '<b>Gas</b>',
            result.gasSummary,
            '',
            '<b>Execution</b>',
            `Wallets: ${result.walletCount} | Skipped: ${result.skippedCount}`,
            `Submitted: ${result.submittedCount} | Confirmed: ${result.confirmedCount}`,
            `Reverted: ${result.revertedCount} | Timeout: ${result.timeoutCount}`,
            `Failed: ${result.failedCount}`,
            '',
            `<b>Latency</b> preflight ${result.preflightLatencyMs}ms | broadcast ${result.broadcastLatencyMs}ms`,
        ].filter(Boolean);

        const body = lines.join('\n');
        if (body.length <= TELEGRAM_MAX) return body;
        return body.slice(0, TELEGRAM_MAX - 40) + '\n\n<i>…truncated</i>';
    }

    static toMempoolLinks(
        result: ExecutionResult,
        maxLines = 12,
        walletName?: (index: number) => string
    ): string {
        const name = walletName || ((i: number) => `W#${i + 1}`);
        const lines: string[] = [];
        for (const r of result.receipts) {
            const label = name(r.walletIndex);
            if (r.status === 'submitted' || r.status === 'confirmed') {
                const link = r.txHash ? `https://etherscan.io/tx/${r.txHash}` : '';
                lines.push(`${label}: <a href="${link}">Etherscan</a> ⏳`);
            } else if (r.status === 'skipped') {
                lines.push(`${label}: ⏭️ ${(r.errorMessage || 'skipped').slice(0, 60)}`);
            } else {
                lines.push(`${label}: ❌ ${(r.errorMessage || r.status).slice(0, 60)}`);
            }
        }
        if (lines.length <= maxLines) return lines.join('\n');
        const head = lines.slice(0, maxLines).join('\n');
        return `${head}\n<i>…${lines.length - maxLines} more wallets</i>`;
    }

    static toApiPayload(result: ExecutionResult): Record<string, unknown> {
        return {
            ...result,
            receipts: result.receipts.map(r => ({
                ...r,
                maxFeePerGas: r.maxFeePerGas.toString(),
                maxPriorityFeePerGas: r.maxPriorityFeePerGas.toString(),
                gasLimit: r.gasLimit.toString(),
                requiredBalance: r.requiredBalance.toString(),
                balance: r.balance.toString(),
                shortage: r.shortage.toString(),
            })),
        };
    }
}
