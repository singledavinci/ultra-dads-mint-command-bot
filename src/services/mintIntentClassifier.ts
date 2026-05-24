import type { JsonRpcProvider } from 'ethers';
import type { MintCandidate, MintIntent } from '../types/mintIntent';
import type { DetectedMint } from '../utils/trackerCore';
import { classifySeaDropCandidate } from './strategies/seaDropStrategy';
import { classifyDirectContractCandidate } from './strategies/directContractStrategy';
import { classifyCopiedReplayCandidate } from './strategies/copiedReplayStrategy';
import { buildAlertOnlyIntent } from './strategies/alertOnlyStrategy';

export interface MintIntentClassifyCtx {
    chainId: number;
    walletAddress?: string;
    desiredQuantity?: number;
    provider?: JsonRpcProvider;
}

export function mintCandidateFromDetectedMint(mint: DetectedMint, chainId: number): MintCandidate {
    return {
        chainId,
        sourceTxHash: mint.hash,
        sourceFrom: mint.from,
        txTo: mint.to,
        txData: mint.data,
        txValueWei: mint.value,
        detectionSource: mint.detectionPath === 'pending' ? 'pending' : 'block',
        matchedReason: 'trackedFrom',
        receivedAt: mint.timestamp,
        classificationConfidence: mint.classificationConfidence,
    };
}

function isProofBoundSeaDrop(intent: MintIntent): boolean {
    return (
        intent.routeType === 'seadrop_allowlist' ||
        intent.routeType === 'seadrop_signed' ||
        intent.routeType === 'seadrop_token_gated'
    );
}

/**
 * Classify a tracked-whale mint candidate into an execution intent.
 * Order: executable SeaDrop → executable direct → copied replay → alert-only.
 * Non-executable SeaDrop (allowlist/signed/gated) does not block replay fallthrough.
 */
export async function classifyMintCandidate(
    candidate: MintCandidate,
    ctx: MintIntentClassifyCtx
): Promise<MintIntent> {
    const seaDrop = await classifySeaDropCandidate(candidate, ctx);
    if (seaDrop?.canAutoExecute) return seaDrop;

    const direct = await classifyDirectContractCandidate(candidate, ctx);
    if (direct?.canAutoExecute) return direct;

    const replay = classifyCopiedReplayCandidate(candidate, ctx);
    if (replay) return replay;

    const automintReplay = classifyCopiedReplayCandidate(candidate, ctx, { forceAutomint: true });
    if (automintReplay) return automintReplay;

    if (seaDrop && isProofBoundSeaDrop(seaDrop)) return seaDrop;
    if (direct && !direct.canAutoExecute) return direct;
    if (seaDrop) return seaDrop;

    return buildAlertOnlyIntent(
        candidate,
        'No SeaDrop or known direct-contract route — alert only'
    );
}
