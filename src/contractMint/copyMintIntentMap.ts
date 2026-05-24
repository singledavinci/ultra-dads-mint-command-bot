import type { MintIntent } from '../types/mintIntent.js';
import type { DetectedMint } from '../utils/trackerCore.js';
import type { ContractMintPlan } from './types.js';

export function contractPlanToMintIntent(
    plan: ContractMintPlan,
    mint: Pick<DetectedMint, 'hash' | 'from'>,
    chainId: number
): MintIntent {
    return {
        chainId,
        sourceTxHash: mint.hash,
        sourceFrom: mint.from,
        routeType:
            plan.category === 'SUPPORTED_SEADROP_PUBLIC'
                ? 'seadrop_public'
                : plan.category === 'SUPPORTED_SEADROP_ALLOWLIST'
                  ? 'seadrop_allowlist'
                  : plan.category === 'SUPPORTED_SEADROP_SIGNED'
                    ? 'seadrop_signed'
                    : plan.category === 'SUPPORTED_PUBLIC_MINT'
                      ? 'direct_contract'
                      : 'copied_replay',
        targetContract: plan.tokenContract,
        executionTo: plan.executionTarget,
        calldata: plan.calldata,
        quantity: plan.quantity,
        unitPriceWei: plan.value,
        totalValueWei: plan.value,
        mintType: plan.mintType,
        confidence: plan.confidence,
        requiresProof: plan.category === 'SUPPORTED_SEADROP_ALLOWLIST',
        requiresSignature: plan.category === 'SUPPORTED_SEADROP_SIGNED',
        requiresTokenGate: false,
        canAutoExecute: plan.executable,
        reason: plan.skipReason || plan.reason,
        detectedAt: Date.now(),
    };
}