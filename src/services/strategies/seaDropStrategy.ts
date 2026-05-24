import { AbiCoder, Interface, type JsonRpcProvider } from 'ethers';
import type { MintCandidate, MintIntent } from '../../types/mintIntent';
import {
    buildSeaDropMintCalldata,
    findSeaDropPublicDrop,
    getSeaDropPublicDrop,
    isSeaDropPublicSelector,
    isSeaDropRouter,
    resolveSeaDropFeeRecipient,
    seaDropPublicMintBlockedReason,
    SEADROP_MINT_PUBLIC,
} from '../seaDropBuilder';
import { fetchOpenSeaSeaDropMint, phaseLabel, resolveSeaDropMint, type SeaDropPhase } from '../seaDropMintResolver';

const SEADROP_IFACE = new Interface([
    'function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity)',
    'function mintAllowlist(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity, bytes32[] proof)',
    'function mintSigned(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity, tuple(uint256 mintPrice, uint256 maxTotalMintableByWallet, uint256 startTime, uint256 endTime, uint256 dropStageIndex, uint256 maxTokenSupplyForStage, uint256 feeBps) mintParams, bytes signature)',
    'function mintAllowedTokenHolder(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity, address mintToken, tuple(uint256 mintPrice, uint256 maxTotalMintableByWallet, uint256 startTime, uint256 endTime, uint256 dropStageIndex, uint256 maxTokenSupplyForStage, uint256 feeBps) mintParams)',
]);

export interface SeaDropClassifyCtx {
    chainId: number;
    walletAddress?: string;
    desiredQuantity?: number;
    provider?: JsonRpcProvider;
}


const SEADROP_SELECTOR_ROUTE: Record<string, 'mintPublic' | 'mintAllowlist' | 'mintSigned' | 'mintAllowedTokenHolder'> = {
    '0x161ac21f': 'mintPublic',
    '0x51061988': 'mintPublic',
    '0x46332f08': 'mintAllowlist',
    '0x8a1361b5': 'mintSigned',
    '0x6e179c0f': 'mintAllowedTokenHolder',
};

function routeFromSelector(data: string): (typeof SEADROP_SELECTOR_ROUTE)[string] | null {
    return SEADROP_SELECTOR_ROUTE[selectorOf(data)] ?? null;
}

function selectorOf(data: string): string {
    return data.slice(0, 10).toLowerCase();
}

function tryExtractMintPublicNftContract(data: string): string | null {
    return tryExtractSeaDropNftContract(data);
}

function tryExtractSeaDropNftContract(data: string): string | null {
    if (!data || data.length < 10 + 64) return null;
    try {
        const body = `0x${data.slice(10)}`;
        const [nftContract] = AbiCoder.defaultAbiCoder().decode(
            ['address', 'address', 'address', 'uint256'],
            body
        );
        return String(nftContract).toLowerCase();
    } catch {
        return null;
    }
}

function routeTypeForPhase(phase: SeaDropPhase): MintIntent['routeType'] {
    switch (phase) {
        case 'allowlist':
            return 'seadrop_allowlist';
        case 'signed':
            return 'seadrop_signed';
        case 'token_gated':
            return 'seadrop_token_gated';
        default:
            return 'seadrop_public';
    }
}

async function tryOpenSeaSeaDropAutoIntent(
    nftContract: string,
    wallet: string,
    qty: number,
    base: Omit<MintIntent, 'routeType' | 'executionTo' | 'calldata' | 'quantity' | 'canAutoExecute' | 'reason' | 'requiresProof' | 'requiresSignature' | 'requiresTokenGate' | 'unitPriceWei' | 'totalValueWei' | 'mintType'>,
    provider?: JsonRpcProvider
): Promise<MintIntent | null> {
    const resolved = provider
        ? await resolveSeaDropMint({
              nftContract,
              minter: wallet,
              quantity: qty,
              provider,
          })
        : await fetchOpenSeaSeaDropMint({
              nftContract,
              minter: wallet,
              quantity: qty,
          });
    if (!resolved) return null;

    const phase = resolved.phase;
    const valueWei = resolved.value === '0x0' || resolved.value === '0' ? '0' : BigInt(resolved.value).toString();
  const paid = BigInt(valueWei || '0') > 0n;

    return {
        ...base,
        targetContract: nftContract,
        routeType: routeTypeForPhase(phase),
        executionTo: resolved.to,
        calldata: resolved.data,
        quantity: qty,
        unitPriceWei: valueWei,
        totalValueWei: valueWei,
        mintType: paid ? 'paid' : 'free',
        requiresProof: phase === 'allowlist',
        requiresSignature: phase === 'signed',
        requiresTokenGate: phase === 'token_gated',
        canAutoExecute: phase === 'public' || phase === 'allowlist' || phase === 'signed',
        reason:
            resolved.source === 'on_chain_allowlist'
                ? `SeaDrop GTD — ${phaseLabel(phase)} (on-chain merkle proof)`
                : `OpenSea SeaDrop — ${phaseLabel(phase)} (auto when wallet eligible)`,
    };
}

function decodeSeaDrop(data: string): { name: string; args: readonly unknown[] } | null {
    if (!data || data.length < 10) return null;
    try {
        const parsed = SEADROP_IFACE.parseTransaction({ data });
        if (!parsed) return null;
        return { name: parsed.name, args: parsed.args as readonly unknown[] };
    } catch {
        return null;
    }
}

export async function classifySeaDropCandidate(
    candidate: MintCandidate,
    ctx: SeaDropClassifyCtx
): Promise<MintIntent | null> {
    if (!isSeaDropRouter(candidate.txTo)) return null;

    const decoded = decodeSeaDrop(candidate.txData);
    const selectorRoute = routeFromSelector(candidate.txData);

    if (!decoded && selectorRoute) {
        const qty = ctx.desiredQuantity ?? 1;
        const wallet = ctx.walletAddress;
        const base = {
            chainId: ctx.chainId,
            sourceTxHash: candidate.sourceTxHash,
            sourceFrom: candidate.sourceFrom,
            targetContract: candidate.txTo,
            detectedAt: candidate.receivedAt,
            sourceQuantity: qty,
            confidence: candidate.classificationConfidence ?? ('high' as const),
            executionTo: candidate.txTo,
            calldata: candidate.txData,
            quantity: qty,
            unitPriceWei: candidate.txValueWei,
            totalValueWei: candidate.txValueWei,
            mintType: (BigInt(candidate.txValueWei || '0') > 0n ? 'paid' : 'free') as 'paid' | 'free',
        };
        if (selectorRoute === 'mintAllowlist' || selectorRoute === 'mintSigned') {
            const nft = tryExtractSeaDropNftContract(candidate.txData);
            if (wallet && nft) {
                const fromOs = await tryOpenSeaSeaDropAutoIntent(nft, wallet, qty, base, ctx.provider);
                if (fromOs) return fromOs;
            }
            if (selectorRoute === 'mintAllowlist') {
                return {
                    ...base,
                    routeType: 'seadrop_allowlist',
                    requiresProof: true,
                    requiresSignature: false,
                    requiresTokenGate: false,
                    canAutoExecute: false,
                    reason: 'SeaDrop allowlist — set OPENSEA_API_KEY or use link mint for GTD',
                };
            }
            return {
                ...base,
                routeType: 'seadrop_signed',
                requiresProof: false,
                requiresSignature: true,
                requiresTokenGate: false,
                canAutoExecute: false,
                reason: 'SeaDrop signed — set OPENSEA_API_KEY for wallet-specific mint',
            };
        }
        if (selectorRoute === 'mintAllowedTokenHolder') {
            return { ...base, routeType: 'seadrop_token_gated', requiresProof: false, requiresSignature: false, requiresTokenGate: true, canAutoExecute: false, reason: 'SeaDrop token-gated (selector)' };
        }
        if (selectorRoute === 'mintPublic') {
            const nftContract = tryExtractMintPublicNftContract(candidate.txData);
            const wallet = ctx.walletAddress;
            if (!wallet || !ctx.provider) {
                return {
                    ...base,
                    routeType: 'seadrop_public',
                    targetContract: nftContract || candidate.txTo,
                    requiresProof: false,
                    requiresSignature: false,
                    requiresTokenGate: false,
                    canAutoExecute: false,
                    reason: 'SeaDrop public mint requires walletAddress and provider for drop lookup',
                };
            }
            if (!nftContract) {
                return {
                    ...base,
                    routeType: 'seadrop_public',
                    executionTo: candidate.txTo,
                    calldata: candidate.txData,
                    requiresProof: false,
                    requiresSignature: false,
                    requiresTokenGate: false,
                    canAutoExecute: false,
                    reason: 'SeaDrop public (selector) — could not decode NFT contract from calldata',
                };
            }
            const drop = await findSeaDropPublicDrop(nftContract, ctx.provider);
            if (!drop) {
                return {
                    ...base,
                    routeType: 'seadrop_public',
                    targetContract: nftContract,
                    executionTo: candidate.txTo,
                    calldata: candidate.txData,
                    requiresProof: false,
                    requiresSignature: false,
                    requiresTokenGate: false,
                    canAutoExecute: false,
                    reason: 'SeaDrop public drop not found on known routers',
                };
            }
            const blocked = seaDropPublicMintBlockedReason(drop);
            const unitPriceWei = drop.mintPrice.toString();
            const totalValueWei = (drop.mintPrice * BigInt(qty)).toString();
            const mintType = drop.mintPrice > 0n ? ('paid' as const) : ('free' as const);
            const feeRecipient = await resolveSeaDropFeeRecipient(
                nftContract,
                ctx.provider,
                drop.router,
                drop.restrictFeeRecipients
            );
            const built = buildSeaDropMintCalldata({
                nftContract,
                feeRecipient,
                minter: wallet,
                quantity: qty,
                seaDropRouter: drop.router,
                mintSelector: selectorOf(candidate.txData),
            });
            return {
                ...base,
                routeType: 'seadrop_public',
                targetContract: nftContract,
                executionTo: drop.router,
                calldata: built.data,
                unitPriceWei,
                totalValueWei,
                mintType,
                requiresProof: false,
                requiresSignature: false,
                requiresTokenGate: false,
                canAutoExecute: !blocked && drop.isActive,
                reason: blocked ?? 'SeaDrop public mint (selector decode) — auto-execute when drop active',
            };
        }
    }

    if (!decoded) return null;

    const qty = ctx.desiredQuantity ?? 1;
    const wallet = ctx.walletAddress;
    const nftContract = String(decoded.args[0]);
    const sourceQty = Number(decoded.args[3] ?? 1) || 1;

    const base = {
        chainId: ctx.chainId,
        sourceTxHash: candidate.sourceTxHash,
        sourceFrom: candidate.sourceFrom,
        targetContract: nftContract,
        detectedAt: candidate.receivedAt,
        sourceQuantity: sourceQty,
        confidence: candidate.classificationConfidence ?? ('high' as const),
    };

    if (decoded.name === 'mintPublic') {
        if (!wallet || !ctx.provider) {
            return {
                ...base,
                routeType: 'seadrop_public',
                executionTo: candidate.txTo,
                calldata: candidate.txData,
                quantity: qty,
                unitPriceWei: '0',
                totalValueWei: '0',
                mintType: 'unknown',
                requiresProof: false,
                requiresSignature: false,
                requiresTokenGate: false,
                canAutoExecute: false,
                reason: 'SeaDrop public mint requires walletAddress and provider for drop lookup',
            };
        }

        const drop = await findSeaDropPublicDrop(nftContract, ctx.provider);
        if (!drop) {
            return {
                ...base,
                routeType: 'seadrop_public',
                executionTo: candidate.txTo,
                calldata: candidate.txData,
                quantity: qty,
                unitPriceWei: '0',
                totalValueWei: '0',
                mintType: 'unknown',
                requiresProof: false,
                requiresSignature: false,
                requiresTokenGate: false,
                canAutoExecute: false,
                reason: 'SeaDrop public drop not found on known routers',
            };
        }

        const blocked = seaDropPublicMintBlockedReason(drop);
        const unitPriceWei = drop.mintPrice.toString();
        const totalValueWei = (drop.mintPrice * BigInt(qty)).toString();
        const mintType = drop.mintPrice > 0n ? ('paid' as const) : ('free' as const);

        const feeRecipient = await resolveSeaDropFeeRecipient(
            nftContract,
            ctx.provider,
            drop.router,
            drop.restrictFeeRecipients
        );

        const built = buildSeaDropMintCalldata({
            nftContract,
            feeRecipient,
            minter: wallet,
            quantity: qty,
            seaDropRouter: drop.router,
            mintSelector: selectorOf(candidate.txData),
        });

        return {
            ...base,
            routeType: 'seadrop_public',
            executionTo: drop.router,
            calldata: built.data,
            quantity: qty,
            unitPriceWei,
            totalValueWei,
            mintType,
            requiresProof: false,
            requiresSignature: false,
            requiresTokenGate: false,
            canAutoExecute: !blocked && drop.isActive,
            reason: blocked ?? 'SeaDrop public mint — auto-execute when drop active',
        };
    }

    if (decoded.name === 'mintAllowlist' || decoded.name === 'mintSigned') {
        if (wallet) {
            const fromOs = await tryOpenSeaSeaDropAutoIntent(nftContract, wallet, qty, base, ctx.provider);
            if (fromOs) return fromOs;
        }
        if (decoded.name === 'mintAllowlist') {
            return {
                ...base,
                routeType: 'seadrop_allowlist',
                executionTo: candidate.txTo,
                calldata: candidate.txData,
                quantity: sourceQty,
                unitPriceWei: candidate.txValueWei,
                totalValueWei: candidate.txValueWei,
                mintType: BigInt(candidate.txValueWei || '0') > 0n ? 'paid' : 'free',
                requiresProof: true,
                requiresSignature: false,
                requiresTokenGate: false,
                canAutoExecute: false,
                reason:
                    'SeaDrop allowlist — set OPENSEA_API_KEY, publish allowlist URI, or use link mint for GTD',
            };
        }
        return {
            ...base,
            routeType: 'seadrop_signed',
            executionTo: candidate.txTo,
            calldata: candidate.txData,
            quantity: sourceQty,
            unitPriceWei: candidate.txValueWei,
            totalValueWei: candidate.txValueWei,
            mintType: BigInt(candidate.txValueWei || '0') > 0n ? 'paid' : 'free',
            requiresProof: false,
            requiresSignature: true,
            requiresTokenGate: false,
            canAutoExecute: false,
            reason: 'SeaDrop signed — set OPENSEA_API_KEY for wallet-specific mint',
        };
    }

    if (decoded.name === 'mintAllowedTokenHolder') {
        return {
            ...base,
            routeType: 'seadrop_token_gated',
            executionTo: candidate.txTo,
            calldata: candidate.txData,
            quantity: sourceQty,
            unitPriceWei: candidate.txValueWei,
            totalValueWei: candidate.txValueWei,
            mintType: BigInt(candidate.txValueWei || '0') > 0n ? 'paid' : 'free',
            requiresProof: false,
            requiresSignature: false,
            requiresTokenGate: true,
            canAutoExecute: false,
            reason: 'SeaDrop token-gated mint — alert only (requires holder token)',
        };
    }

    // Legacy selector without full ABI decode
    const sel = selectorOf(candidate.txData);
    if (isSeaDropPublicSelector(sel) && ctx.provider) {
        const dropInfo = await getSeaDropPublicDrop(nftContract, ctx.provider, candidate.txTo);
        if (dropInfo) {
            const unitPriceWei = dropInfo.mintPrice.toString();
            const totalValueWei = (dropInfo.mintPrice * BigInt(qty)).toString();
            return {
                ...base,
                routeType: 'seadrop_public',
                executionTo: candidate.txTo,
                calldata: candidate.txData,
                quantity: qty,
                unitPriceWei,
                totalValueWei,
                mintType: dropInfo.mintPrice > 0n ? 'paid' : 'free',
                requiresProof: false,
                requiresSignature: false,
                requiresTokenGate: false,
                canAutoExecute: dropInfo.isActive,
                reason: 'SeaDrop public mint (legacy decode)',
            };
        }
    }

    return null;
}

/** Exported for tests — canonical public selector. */
export { SEADROP_MINT_PUBLIC };
