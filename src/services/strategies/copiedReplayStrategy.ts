import type { MintCandidate, MintIntent } from '../../types/mintIntent';
import type { MintIntentClassifyCtx } from '../mintIntentClassifier';
import { isKnownMintSelector } from '../txSignalClassifier';
import { rewriteMintCalldataForWallet } from '../calldataRewriter';
import { decodeWhaleMintQuantity } from '../copyMintQuantity';

/** Selectors that must never use blind calldata replay (proof/signature/token gate). */
const BLOCKED_SELECTORS = new Set([
    '0x46332f08', // mintAllowlist
    '0x8a1361b5', // mintSigned
    '0x6e179c0f', // mintAllowedTokenHolder
]);

/**
 * Permissive replay for tracked-whale txs that passed detection but no structured route matched.
 * Gated by TRACKER_PERMISSIVE_CLASSIFIER (default on) and medium+ confidence.
 */
export interface CopiedReplayOptions {
    /** Automint-only: relax rules when tracker already flagged a mint (medium+). */
    forceAutomint?: boolean;
}

export function classifyCopiedReplayCandidate(
    candidate: MintCandidate,
    ctx: MintIntentClassifyCtx,
    opts?: CopiedReplayOptions
): MintIntent | null {
    if (process.env.TRACKER_PERMISSIVE_CLASSIFIER === 'false' && !opts?.forceAutomint) return null;

    const conf = candidate.classificationConfidence ?? 'low';
    if (conf === 'low') return null;

    const data = candidate.txData || '';
    if (data.length < 10) return null;

    const selector = data.slice(0, 10).toLowerCase();
    if (BLOCKED_SELECTORS.has(selector)) return null;

    const valueWei = candidate.txValueWei || '0';
    const paid = BigInt(valueWei) > 0n;
    const knownMint = isKnownMintSelector(selector);
    const tailLen = data.length - 10;
    const abiShaped = tailLen > 0 && tailLen % 64 === 0;
    const maxPaidLen = parseInt(process.env.COPIED_REPLAY_MAX_PAID_CALLDATA || '600', 10);
    const maxFreeLen = parseInt(
        process.env.COPIED_REPLAY_MAX_FREE_CALLDATA || (opts?.forceAutomint ? '4096' : '200'),
        10
    );
    const maxAutomintLen = parseInt(process.env.AUTOMINT_MAX_REPLAY_CALLDATA || '8192', 10);

    // Paid: unknown selector only when compact ABI-shaped calldata.
    const paidReplay = paid && abiShaped && data.length <= maxPaidLen;
    // Free: allow short public-style mints (unknown selector OK at medium+ confidence).
    // Block long 0 ETH calldata — usually allowlist/proof mints that cannot be copied safely.
    const freeReplay =
        !paid &&
        abiShaped &&
        data.length >= 10 &&
        data.length <= maxFreeLen;

    // Automint: tracker already classified as mint — replay whale calldata unless proof-bound selector.
    const automintReplay =
        opts?.forceAutomint &&
        abiShaped &&
        data.length >= 10 &&
        data.length <= maxAutomintLen;

    if (!knownMint && !paidReplay && !freeReplay && !automintReplay) return null;

    let calldata = data;
    if (ctx.walletAddress && candidate.sourceFrom) {
        const rewritten = rewriteMintCalldataForWallet(data, candidate.sourceFrom, ctx.walletAddress);
        if (rewritten) calldata = rewritten;
    }

    const whaleQty = decodeWhaleMintQuantity(data);
    const qty = ctx.desiredQuantity ?? whaleQty;

    return {
        chainId: ctx.chainId,
        sourceTxHash: candidate.sourceTxHash,
        sourceFrom: candidate.sourceFrom,
        routeType: 'copied_replay',
        targetContract: candidate.txTo,
        executionTo: candidate.txTo,
        calldata,
        quantity: qty,
        unitPriceWei: valueWei,
        totalValueWei: valueWei,
        mintType: paid ? 'paid' : 'free',
        confidence: conf,
        requiresProof: false,
        requiresSignature: false,
        requiresTokenGate: false,
        canAutoExecute: true,
        reason: opts?.forceAutomint
            ? 'Automint copied replay of whale calldata'
            : 'Copied replay of whale calldata (permissive classifier)',
        detectedAt: candidate.receivedAt,
        sourceQuantity: whaleQty,
    };
}
