import { AbiCoder, Interface, getAddress, isAddress } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import {
    buildSeaDropMintCalldata,
    findSeaDropPublicDrop,
    isSeaDropRouter,
    resolveSeaDropFeeRecipient,
    seaDropPublicMintBlockedReason,
} from '../services/seaDropBuilder.js';
import { resolveSeaDropMint } from '../services/seaDropMintResolver.js';
import { replaceRecipientInCalldata } from '../services/strategies/directContractStrategy.js';
import { getContractMintConfig } from './config.js';
import { classifyByAbiFunction, classifyBySelector, calldataContainsWhalePadded } from './MintFunctionClassifier.js';
import { readOnChainPrice, resolveAbi } from './ABIResolver.js';
import { trySignatureMintRoutes } from './signatureMint/router.js';
import type { ContractMintPlan, DetectedContractMint, MintCategory, MintType } from './types.js';

function weiHex(v: bigint): string {
    return v > 0n ? '0x' + v.toString(16) : '0x0';
}

async function trySignatureMintPlan(
    params: {
        detected: DetectedContractMint;
        signerAddress: string;
        quantity: number;
        provider: JsonRpcProvider;
        privateKeyForSign?: string;
    },
    base: {
        chainId: number;
        tokenContract: string;
        executionTarget: string;
        tokenStandard: DetectedContractMint['tokenStandard'];
        sourceTxHash?: string;
        whaleAddress?: string;
        collectionName?: string;
        quantity: number;
    }
): Promise<ContractMintPlan | null> {
    const sig = await trySignatureMintRoutes({
        detected: params.detected,
        signerAddress: params.signerAddress,
        quantity: params.quantity,
        provider: params.provider,
        privateKeyForSign: params.privateKeyForSign,
    });
    if (!sig.plan) return null;
    return { ...base, ...sig.plan, quantity: params.quantity };
}

export async function buildMintPlan(params: {
    detected: DetectedContractMint;
    signerAddress: string;
    quantity?: number;
    provider: JsonRpcProvider;
    privateKeyForSign?: string;
}): Promise<ContractMintPlan> {
    const cfg = getContractMintConfig();
    const qty = params.quantity ?? cfg.defaultMintQuantity;
    const { detected } = params;
    const signer = getAddress(params.signerAddress);

    const base = {
        chainId: detected.chainId,
        tokenContract: detected.tokenContract,
        executionTarget: detected.executionTarget,
        tokenStandard: detected.tokenStandard,
        sourceTxHash: detected.txHash,
        whaleAddress: detected.whaleAddress,
        collectionName: detected.collectionName,
        quantity: qty,
    };

    const selectorEarly = detected.calldata.slice(0, 10).toLowerCase();
    const isSignedSeaDrop =
        detected.isSeaDrop &&
        isSeaDropRouter(detected.executionTarget) &&
        selectorEarly === '0x8a1361b5';

    if (isSignedSeaDrop) {
        const sigPlan = await trySignatureMintPlan(
            { ...params, quantity: qty, signerAddress: signer },
            base
        );
        if (sigPlan) return sigPlan;
    }

    if (detected.isSeaDrop && isSeaDropRouter(detected.executionTarget) && !isSignedSeaDrop) {
        return buildSeaDropPlan(params, signer, qty);
    }

    const selector = selectorEarly;
    let classification = classifyBySelector(selector);
    const resolved = await resolveAbi(detected.tokenContract, params.provider, detected.chainId);

    if (!classification && detected.calldata.length > 10) {
        try {
            const parsed = resolved.iface.parseTransaction({ data: detected.calldata });
            if (parsed) {
                classification = classifyByAbiFunction(
                    parsed.name,
                    parsed.fragment.inputs.map(i => ({ type: i.type, name: i.name }))
                );
            }
        } catch {
            /* fall through */
        }
    }

    if (!classification) {
        classification = {
            category: 'CONDITIONAL',
            functionName: selector,
            reason: 'Unknown selector — replay if simulation passes',
            hasProofOrSignature: false,
        };
    }

    if (classification.category === 'UNSUPPORTED' || classification.hasProofOrSignature) {
        const sigPlan = await trySignatureMintPlan(
            { ...params, quantity: qty, signerAddress: signer },
            base
        );
        if (sigPlan) return sigPlan;
        return {
            ...base,
            mintType: 'unknown',
            functionName: classification.functionName,
            selector,
            value: '0x0',
            calldata: detected.calldata,
            confidence: 'low',
            reason: classification.reason,
            simulationStatus: 'not_run',
            executable: false,
            category: 'UNSUPPORTED',
            skipReason: `skipped: ${classification.reason}`,
        };
    }

    if (
        detected.whaleAddress &&
        calldataContainsWhalePadded(detected.calldata, detected.whaleAddress) &&
        !replaceRecipientInCalldata(detected.calldata, detected.whaleAddress, signer, resolved.iface)
    ) {
        const sigPlan = await trySignatureMintPlan(
            { ...params, quantity: qty, signerAddress: signer },
            base
        );
        if (sigPlan) return sigPlan;
        return {
            ...base,
            mintType: 'unknown',
            functionName: classification.functionName,
            selector,
            value: detected.valueWei,
            calldata: detected.calldata,
            confidence: 'low',
            reason: 'Whale address embedded in calldata cannot be safely replaced',
            simulationStatus: 'not_run',
            executable: false,
            category: 'UNSUPPORTED',
            skipReason: 'skipped: signature mint tied to whale wallet',
        };
    }

    let calldata = detected.calldata;
    if (detected.whaleAddress) {
        const replaced = replaceRecipientInCalldata(calldata, detected.whaleAddress, signer, resolved.iface);
        if (replaced) calldata = replaced;
    }

    const sourceValue = BigInt(detected.valueWei || '0');
    let unitPrice = sourceValue;
    if (detected.quantity > 0 && sourceValue > 0n) {
        unitPrice = sourceValue / BigInt(detected.quantity);
    }

    let totalValue = unitPrice * BigInt(qty);
    let mintType: MintType = totalValue > 0n ? 'paid' : 'free';

    if (mintType === 'free' || totalValue === 0n) {
        const onChain = await readOnChainPrice(detected.tokenContract, params.provider);
        if (onChain && onChain.price > 0n) {
            totalValue = onChain.price * BigInt(qty);
            mintType = 'paid';
        }
    }

    const maxWei = BigInt(Math.floor(cfg.maxMintValueEth * 1e18));
    if (totalValue > maxWei) {
        return {
            ...base,
            mintType,
            functionName: classification.functionName,
            selector,
            value: weiHex(totalValue),
            calldata,
            confidence: 'medium',
            reason: `Value ${totalValue} exceeds MAX_MINT_VALUE_ETH`,
            simulationStatus: 'not_run',
            executable: false,
            category: classification.category,
            skipReason: 'skipped: max value exceeded',
        };
    }

    return {
        ...base,
        executionTarget: detected.executionTarget,
        mintType,
        functionName: classification.functionName,
        selector,
        value: weiHex(totalValue),
        calldata,
        confidence: classification.category === 'SUPPORTED_PUBLIC_MINT' ? 'high' : 'medium',
        reason: classification.reason,
        simulationStatus: 'not_run',
        executable: true,
        category: classification.category,
    };
}

function seaDropCategoryForPhase(phase: string): MintCategory {
    if (phase === 'allowlist') return 'SUPPORTED_SEADROP_ALLOWLIST';
    if (phase === 'signed') return 'SUPPORTED_SEADROP_SIGNED';
    return 'SUPPORTED_SEADROP_PUBLIC';
}

async function buildSeaDropPlan(
    params: { detected: DetectedContractMint; signerAddress: string; quantity?: number; provider: JsonRpcProvider },
    signer: string,
    qty: number
): Promise<ContractMintPlan> {
    const { detected } = params;
    const nft = detected.seaDropNftContract || detected.tokenContract;

    const resolved = await resolveSeaDropMint({
        nftContract: nft,
        minter: signer,
        quantity: qty,
        provider: params.provider,
    });
    if (resolved) {
        const valueWei =
            resolved.value === '0' || resolved.value === '0x0'
                ? 0n
                : BigInt(resolved.value.startsWith('0x') ? resolved.value : resolved.value);
        const category = seaDropCategoryForPhase(resolved.phase);
        return {
            chainId: detected.chainId,
            tokenContract: nft,
            executionTarget: resolved.to,
            mintType: valueWei > 0n ? 'paid' : 'free',
            tokenStandard: detected.tokenStandard,
            functionName: resolved.functionName,
            selector: resolved.selector,
            quantity: qty,
            value: resolved.value,
            calldata: resolved.data,
            confidence: 'high',
            reason: resolved.warnings[0] || `SeaDrop ${resolved.phase} (copy-mint)`,
            simulationStatus: 'not_run',
            executable: true,
            category,
            sourceTxHash: detected.txHash,
            whaleAddress: detected.whaleAddress,
        };
    }

    const drop = await findSeaDropPublicDrop(nft, params.provider);
    const basePartial = {
        chainId: detected.chainId,
        tokenContract: nft,
        tokenStandard: detected.tokenStandard,
        sourceTxHash: detected.txHash,
        whaleAddress: detected.whaleAddress,
        quantity: qty,
    };
    if (!drop) {
        return {
            ...basePartial,
            executionTarget: detected.executionTarget,
            mintType: 'unknown',
            functionName: 'mintPublic',
            selector: detected.selector,
            value: '0x0',
            calldata: detected.calldata,
            confidence: 'low',
            reason: 'SeaDrop public drop not found',
            simulationStatus: 'not_run',
            executable: false,
            category: 'UNSUPPORTED',
            skipReason: 'skipped: SeaDrop drop inactive',
        };
    }
    const blocked = seaDropPublicMintBlockedReason(drop);
    if (blocked) {
        return {
            ...basePartial,
            executionTarget: detected.executionTarget,
            mintType: drop.mintPrice > 0n ? 'paid' : 'free',
            functionName: 'mintPublic',
            selector: detected.selector,
            value: '0x0',
            calldata: detected.calldata,
            confidence: 'medium',
            reason: blocked,
            simulationStatus: 'not_run',
            executable: false,
            category: 'UNSUPPORTED',
            skipReason: `skipped: ${blocked}`,
        };
    }
    const feeRecipient = await resolveSeaDropFeeRecipient(
        nft,
        params.provider,
        drop.router,
        drop.restrictFeeRecipients
    );
    const built = buildSeaDropMintCalldata({
        nftContract: nft,
        minter: signer,
        quantity: qty,
        seaDropRouter: drop.router,
        feeRecipient,
    });
    const total = drop.mintPrice * BigInt(qty);
    return {
        ...basePartial,
        executionTarget: drop.router,
        mintType: total > 0n ? 'paid' : 'free',
        functionName: 'mintPublic',
        selector: built.selector,
        value: weiHex(total),
        calldata: built.data,
        confidence: 'high',
        reason: 'SeaDrop public mint plan',
        simulationStatus: 'not_run',
        executable: true,
        category: 'SUPPORTED_SEADROP_PUBLIC',
    };
}

export function buildReplayPlanFromTx(
    detected: DetectedContractMint,
    signerAddress: string,
    quantity: number
): ContractMintPlan {
    const cfg = getContractMintConfig();
    const sourceValue = BigInt(detected.valueWei || '0');
    const srcQty = detected.quantity || 1;
    const unit = srcQty > 0 ? sourceValue / BigInt(srcQty) : sourceValue;
    const total = unit * BigInt(quantity);
    return {
        chainId: detected.chainId,
        tokenContract: detected.tokenContract,
        executionTarget: detected.executionTarget,
        mintType: total > 0n ? 'paid' : 'free',
        tokenStandard: detected.tokenStandard,
        functionName: 'replay',
        selector: detected.selector,
        quantity,
        value: weiHex(total),
        calldata: detected.calldata,
        confidence: 'medium',
        reason: 'Calldata replay from whale tx',
        simulationStatus: 'not_run',
        executable: true,
        category: 'CONDITIONAL',
        sourceTxHash: detected.txHash,
        whaleAddress: detected.whaleAddress,
    };
}
