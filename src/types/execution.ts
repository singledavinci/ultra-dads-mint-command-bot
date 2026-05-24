/**
 * Structured execution model for mint and copy-trade broadcasts.
 *
 * Replaces the previous untyped `{ status: 'fulfilled' | 'rejected', ... }`
 * tuples returned by `batchCopyTrade`. The union below is exhaustive — adding
 * a new outcome here will surface compile errors in any consumer that doesn't
 * handle it.
 */

import type { TransactionResponse, TransactionReceipt } from 'ethers';

export type ExecutionPhase =
    | 'detected'      // event observed by tracker / user
    | 'submitted'     // tx broadcast accepted by RPC
    | 'mined'         // included in a block
    | 'confirmed'     // reached TX_CONFIRMATION_BLOCKS
    | 'reverted'      // mined but receipt.status !== 1
    | 'dropped'       // submitted then disappeared from mempool
    | 'replaced'      // replaced by another tx with same nonce
    | 'rejected_pre_submit'; // never broadcast

export type ExecutionFailureKind =
    | 'rpc_rate_limit'
    | 'insufficient_funds'
    | 'nonce_too_low'
    | 'underpriced'
    | 'simulation_revert'
    | 'router_blocked'
    | 'max_mint_exceeded'
    | 'unknown';

export interface ExecutionTimings {
    /** Whale event detected by tracker, or command received. */
    detectedAt: number;
    /** First moment we started broadcasting for this wallet. */
    startedAt?: number;
    /** Tx hash returned by RPC. */
    submittedAt?: number;
    /** Receipt fetched. */
    confirmedAt?: number;
}

export interface ExecutionContext {
    walletAddress: string;
    target: string;
    valueWei: string;
    nonce?: number;
    label?: string;
}

export type ExecutionResult =
    | {
        kind: 'submitted';
        phase: 'submitted' | 'mined' | 'confirmed' | 'reverted' | 'dropped' | 'replaced';
        ctx: ExecutionContext;
        tx: TransactionResponse;
        receipt?: TransactionReceipt | null;
        timings: ExecutionTimings;
    }
    | {
        kind: 'failed';
        phase: 'rejected_pre_submit';
        ctx: ExecutionContext;
        failure: ExecutionFailureKind;
        message: string;
        timings: ExecutionTimings;
    };

export function classifyError(err: unknown): { failure: ExecutionFailureKind; message: string } {
    const e = err as { message?: string; info?: any; error?: any; reason?: string; data?: any };
    const raw = (e?.message || (typeof err === 'string' ? err : '') || JSON.stringify(err) || 'unknown').toString();

    if (/429|compute units/i.test(raw)) {
        return { failure: 'rpc_rate_limit', message: 'RPC capacity exhausted (429 / compute units exceeded)' };
    }
    if (/insufficient funds/i.test(raw)) {
        return { failure: 'insufficient_funds', message: raw.slice(0, 200) };
    }
    if (/nonce too low/i.test(raw)) {
        return { failure: 'nonce_too_low', message: 'Nonce too low (previous tx still pending or already mined)' };
    }
    if (/replacement transaction underpriced|underpriced/i.test(raw)) {
        return { failure: 'underpriced', message: 'Gas price too low to replace the pending transaction' };
    }
    if (/missing revert data|execution reverted|payernotallowed/i.test(raw)) {
        return { failure: 'simulation_revert', message: raw.slice(0, 200) };
    }
    if (/router/i.test(raw) && /blocked|invalid target/i.test(raw)) {
        return { failure: 'router_blocked', message: raw.slice(0, 200) };
    }
    if (/exceeds max mint limit/i.test(raw)) {
        return { failure: 'max_mint_exceeded', message: raw.slice(0, 200) };
    }
    return { failure: 'unknown', message: raw.slice(0, 200) };
}

/** Backwards-compatible wrapper used while the rest of the bot is still tuple-shaped. */
export interface LegacySettledShape {
    status: 'fulfilled' | 'rejected';
    value?: TransactionResponse;
    reason?: { message: string };
}

export function toLegacy(result: ExecutionResult): LegacySettledShape {
    if (result.kind === 'submitted') {
        return { status: 'fulfilled', value: result.tx };
    }
    return { status: 'rejected', reason: { message: result.message } };
}
