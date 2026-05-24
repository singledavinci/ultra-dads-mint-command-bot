/**
 * Shared drop resolution for /dropmint, block mint, and scheduled fires.
 * Uses the same path as link mint (SeaDrop, Scatter, Manifold, FCFS on NFT contract).
 */

import { formatEther } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import {
    detectMintTargetFromMessage,
    loadLinkMintConfig,
    resolveMintTarget,
    type LinkMintConfig,
    type MintTargetCandidate,
    type ResolvedMintTarget,
} from './linkMintService.js';
import { extractScatterSlug } from './scatterMint.js';

export interface ResolvedDropExecution {
    contract: string;
    executionTo: string;
    data: string;
    valueEth: string;
    label: string;
    warnings: string[];
    scatterSlug?: string;
    seaDropNftContract?: string;
    mintPath?: ResolvedMintTarget['mintPath'];
    suggestedQuantity?: number;
    paymentPrevalidated?: boolean;
    paymentConfidence?: ResolvedMintTarget['paymentConfidence'];
    allowSimulationBypass?: boolean;
    suggestedGasTierId?: string;
}

function candidateFromInput(sourceInput: string): MintTargetCandidate {
    const trimmed = sourceInput.trim();
    const fromDetect = detectMintTargetFromMessage(trimmed);
    if (fromDetect.length > 0) return fromDetect[0]!;

    return {
        originalText: trimmed,
        target: trimmed,
        type: trimmed.startsWith('http') ? 'opensea' : 'raw_address',
        confidence: 'medium',
    };
}

export function scheduledDropExecuteOptions(
    resolved: ResolvedDropExecution,
    config: LinkMintConfig = loadLinkMintConfig()
): Record<string, unknown> {
    const scatterSlug =
        resolved.scatterSlug ||
        (resolved.mintPath === 'scatter_api' ? extractScatterSlug(resolved.contract) : undefined);
    return {
        scatterSlug,
        seaDropNftContract: resolved.seaDropNftContract,
        maxMintLimit: config.maxMintEth.toString(),
        quantity: resolved.suggestedQuantity ?? config.defaultQuantity,
        paymentPrevalidated: resolved.paymentPrevalidated === true,
        paymentConfidence: resolved.paymentConfidence,
        allowUnknownPayment:
            resolved.allowSimulationBypass === true ||
            process.env.LINK_MINT_ALLOW_UNKNOWN === 'true',
        gasTierId: resolved.suggestedGasTierId || process.env.LINK_MINT_GAS_TIER || 'fcfs_plus',
        forceGasEstimate: true,
        skipClassification: true,
        skipSimulation: config.simulationMode === 'fast',
    };
}

/** Prefer on-chain/API price at fire time unless the user set an explicit ETH hint at schedule. */
export function valueEthFromTarget(
    target: ResolvedMintTarget,
    hint?: string,
    useScheduledHint?: boolean
): string {
    if (useScheduledHint) {
        const hintNum = hint !== undefined && hint !== '' ? parseFloat(hint) : NaN;
        if (!Number.isNaN(hintNum) && hintNum > 0) return String(hintNum);
    }

    try {
        const raw = target.suggestedValue || '0';
        const v = raw.startsWith('0x') ? BigInt(raw) : BigInt(raw === '0' ? 0 : raw);
        return formatEther(v);
    } catch {
        if (useScheduledHint && hint && !Number.isNaN(parseFloat(hint))) return hint;
        return '0';
    }
}

/**
 * Resolve mint calldata at fire time for a URL, slug, or contract address.
 */
export async function resolveDropMintAtFireTime(params: {
    sourceInput: string;
    provider: JsonRpcProvider;
    minter: string;
    valueEthHint?: string;
    /** When true, user supplied a non-zero ETH value at schedule time — may override resolved price. */
    valueEthIsHint?: boolean;
}): Promise<ResolvedDropExecution> {
    const candidate = candidateFromInput(params.sourceInput);
    const target = await resolveMintTarget(candidate, params.provider, params.minter);
    if (!target) {
        throw new Error('Could not resolve mint calldata for this drop');
    }

    if (target.requiresManualCalldata) {
        throw new Error(target.warnings.join(' ') || 'Manual calldata required');
    }

    return {
        contract: target.contractAddress,
        executionTo: target.executionTo,
        data: target.suggestedCalldata || '0x',
        valueEth: valueEthFromTarget(target, params.valueEthHint, params.valueEthIsHint),
        label: target.name,
        warnings: target.warnings,
        scatterSlug: target.scatterSlug,
        seaDropNftContract: target.seaDropNftContract,
        mintPath: target.mintPath,
        suggestedQuantity: target.suggestedQuantity,
        paymentPrevalidated: target.paymentPrevalidated,
        paymentConfidence: target.paymentConfidence,
        allowSimulationBypass: target.allowSimulationBypass,
        suggestedGasTierId: target.suggestedGasTierId,
    };
}
