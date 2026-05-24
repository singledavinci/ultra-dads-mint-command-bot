import { AbiCoder, Interface, getAddress, isAddress } from 'ethers';
import type { MintCandidate, MintIntent } from '../../types/mintIntent';
import { buildAlertOnlyIntent } from './alertOnlyStrategy';

const PUBLIC_MINT_NAMES = new Set([
    'mint',
    'publicMint',
    'publicSaleMint',
    'mintPublic',
    'purchase',
    'buy',
    'claim',
]);

const ALERT_ONLY_NAMES = new Set([
    'allowlistMint',
    'mintAllowlist',
    'mintWithProof',
    'mintWithAllowlist',
    'signedMint',
    'mintSigned',
    'claimWithSignature',
]);

const COMMON_MINT_FRAGMENTS = [
    'function mint(uint256 quantity)',
    'function mint()',
    'function mint(address to)',
    'function mint(address to, uint256 quantity)',
    'function mint(uint256 quantity, bytes32[] proof)',
    'function publicMint(uint256 quantity)',
    'function publicSaleMint(uint256 quantity)',
    'function mintPublic(uint256 quantity)',
    'function purchase(uint256 quantity)',
    'function buy(uint256 quantity)',
    'function claim(uint256 quantity)',
    'function allowlistMint(uint256 quantity, bytes32[] proof)',
    'function mintAllowlist(uint256 quantity, bytes32[] proof)',
    'function mintWithProof(uint256 quantity, bytes32[] proof)',
    'function signedMint(uint256 quantity, bytes signature)',
    'function mintSigned(uint256 quantity, bytes signature)',
];

const DIRECT_IFACE = new Interface(COMMON_MINT_FRAGMENTS);

export interface DirectContractClassifyCtx {
    chainId: number;
    walletAddress?: string;
    desiredQuantity?: number;
}

function tryDecode(data: string): { name: string; args: readonly unknown[] } | null {
    try {
        const parsed = DIRECT_IFACE.parseTransaction({ data });
        if (!parsed) return null;
        return { name: parsed.name, args: parsed.args as readonly unknown[] };
    } catch {
        return null;
    }
}

function extractQuantity(args: readonly unknown[], fallback: number): number {
    for (const arg of args) {
        if (typeof arg === 'bigint' || typeof arg === 'number') {
            const n = Number(arg);
            if (n > 0 && n < 1_000_000) return n;
        }
    }
    return fallback;
}

function findAddressArgIndex(args: readonly unknown[], whale: string): number {
    const whaleLower = whale.toLowerCase();
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (typeof a === 'string' && a.startsWith('0x') && a.toLowerCase() === whaleLower) {
            return i;
        }
    }
    return -1;
}

/**
 * ABI-aware recipient replacement — no regex deep swap.
 * Replaces a single address argument matching `whale` with `wallet`.
 */
export function replaceRecipientInCalldata(
    data: string,
    whale: string,
    wallet: string,
    iface: Interface = DIRECT_IFACE
): string | null {
    if (!data || data.length < 10 || !isAddress(whale) || !isAddress(wallet)) return null;

    try {
        const parsed = iface.parseTransaction({ data });
        if (!parsed) return null;

        const idx = findAddressArgIndex(parsed.args as readonly unknown[], whale);
        if (idx < 0) return null;

        const newArgs = [...parsed.args];
        newArgs[idx] = getAddress(wallet);
        const encoded = iface.encodeFunctionData(parsed.fragment, newArgs);
        return encoded;
    } catch {
        return null;
    }
}

export async function classifyDirectContractCandidate(
    candidate: MintCandidate,
    ctx: DirectContractClassifyCtx
): Promise<MintIntent | null> {
    const decoded = tryDecode(candidate.txData);
    if (!decoded) return null;

    const desiredQty = ctx.desiredQuantity ?? 1;
    const sourceQty = extractQuantity(decoded.args, 1);
    const sourceValue = BigInt(candidate.txValueWei || '0');
    const whale = candidate.sourceFrom;
    const wallet = ctx.walletAddress;

    let calldata = candidate.txData;
    if (wallet && whale) {
        const replaced = replaceRecipientInCalldata(calldata, whale, wallet);
        if (replaced) calldata = replaced;
    }

    const unitPrice =
        sourceQty > 0 && sourceValue > 0n ? sourceValue / BigInt(sourceQty) : sourceValue;
    const totalValue = unitPrice * BigInt(desiredQty);

    const priceDivisible =
        sourceQty > 0 && sourceValue > 0n && sourceValue % BigInt(sourceQty) === 0n;
    const unknownPrice =
        sourceValue > 0n && sourceQty !== desiredQty && !priceDivisible;

    if (ALERT_ONLY_NAMES.has(decoded.name)) {
        return buildAlertOnlyIntent(
            candidate,
            `Direct contract ${decoded.name} — alert only (proof/signature required)`
        );
    }

    if (!PUBLIC_MINT_NAMES.has(decoded.name)) {
        return null;
    }

    if (unknownPrice) {
        return buildAlertOnlyIntent(
            candidate,
            `Unknown unit price with qty mismatch (source ${sourceQty} → desired ${desiredQty})`
        );
    }

    const paid = totalValue > 0n;

    return {
        chainId: ctx.chainId,
        sourceTxHash: candidate.sourceTxHash,
        sourceFrom: candidate.sourceFrom,
        routeType: 'direct_contract',
        targetContract: candidate.txTo,
        executionTo: candidate.txTo,
        calldata,
        quantity: desiredQty,
        unitPriceWei: unitPrice.toString(),
        totalValueWei: totalValue.toString(),
        mintType: paid ? 'paid' : 'free',
        confidence: candidate.classificationConfidence ?? 'medium',
        requiresProof: false,
        requiresSignature: false,
        requiresTokenGate: false,
        canAutoExecute: true,
        reason: `Direct contract ${decoded.name} — value scaled ${sourceQty}→${desiredQty}`,
        detectedAt: candidate.receivedAt,
        sourceQuantity: sourceQty,
    };
}

/** Pad address to 32-byte word for low-level calldata surgery (tests). */
export function paddedAddress(addr: string): string {
    return AbiCoder.defaultAbiCoder().encode(['address'], [getAddress(addr)]).slice(2);
}
