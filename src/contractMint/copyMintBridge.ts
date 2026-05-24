import type { JsonRpcProvider } from 'ethers';
import type { MintIntent } from '../types/mintIntent.js';
import type { DetectedMint } from '../utils/trackerCore.js';
import { rewriteMintCalldataForWallet } from '../services/calldataRewriter.js';
import { classifyMintCandidate } from '../services/mintIntentClassifier.js';
import type { MintCandidate } from '../types/mintIntent.js';
import type { MintIntentClassifyCtx } from '../services/mintIntentClassifier.js';
import { ContractMintPipeline } from './ContractMintPipeline.js';
import { getContractMintConfig } from './config.js';
import { resolveAbi } from './ABIResolver.js';
import type { ContractMintPlan, ContractMintPipelineResult, DetectedContractMint } from './types.js';
import { contractPlanToMintIntent } from './copyMintIntentMap.js';

export { contractPlanToMintIntent } from './copyMintIntentMap.js';

/** Per-wallet calldata: SeaDrop hijack + ABI recipient swap on top of pipeline plan. */
export async function finalizeCopyMintCalldataForWallet(params: {
    plan: ContractMintPlan;
    detected: DetectedContractMint;
    whaleAddress: string;
    walletAddress: string;
    provider: JsonRpcProvider;
    whaleTxData?: string;
}): Promise<string> {
    const whaleData = params.whaleTxData || params.detected.calldata;
    const whale = params.whaleAddress.toLowerCase();
    const resolved = await resolveAbi(params.plan.tokenContract, params.provider, params.plan.chainId);
    const rewritten =
        rewriteMintCalldataForWallet(whaleData, whale, params.walletAddress, resolved.iface) ||
        rewriteMintCalldataForWallet(params.plan.calldata, whale, params.walletAddress, resolved.iface);
    return rewritten || params.plan.calldata;
}

/**
 * Build a copy-mint plan from a whale tx (receipt-first). Does not execute.
 */
export async function buildWhaleCopyMintPlan(
    mint: DetectedMint,
    params: { signerAddress: string; provider: JsonRpcProvider; quantity?: number }
): Promise<ContractMintPipelineResult> {
    const cfg = getContractMintConfig();
    if (!cfg.contractMintEnabled || !cfg.copyMintEnabled) {
        return { alertText: 'Copy mint disabled', executed: false };
    }
    const pipeline = new ContractMintPipeline(params.provider);
    return pipeline.buildWhaleMintPlan(mint, {
        signerAddress: params.signerAddress,
        quantity: params.quantity,
    });
}

/**
 * Pipeline-first intent; legacy classifier only when pipeline is off or cannot detect.
 */
export async function resolveCopyMintIntent(
    mint: DetectedMint,
    ctx: MintIntentClassifyCtx & { provider: JsonRpcProvider }
): Promise<{ intent: MintIntent; pipeline?: ContractMintPipelineResult }> {
    const chainId = ctx.chainId;
    const cfg = getContractMintConfig();

    if (cfg.contractMintEnabled && cfg.copyMintEnabled && ctx.walletAddress) {
        const pipelineResult = await buildWhaleCopyMintPlan(mint, {
            signerAddress: ctx.walletAddress,
            provider: ctx.provider,
            quantity: ctx.desiredQuantity,
        });
        if (pipelineResult.plan) {
            return {
                intent: contractPlanToMintIntent(pipelineResult.plan, mint, chainId),
                pipeline: pipelineResult,
            };
        }
    }

    const candidate: MintCandidate = {
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

    const intent = await classifyMintCandidate(candidate, ctx);
    return { intent };
}
