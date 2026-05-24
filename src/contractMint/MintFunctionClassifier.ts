import { Interface } from 'ethers';
import type { MintCategory } from './types.js';

export const PUBLIC_MINT_NAMES = new Set([
    'mint',
    'publicMint',
    'publicSaleMint',
    'mintPublic',
    'freeMint',
    'claim',
    'mintTo',
    'safeMint',
    'purchase',
    'buy',
    'mintNFT',
]);

export const UNSUPPORTED_NAMES = new Set([
    'allowlistMint',
    'mintAllowlist',
    'mintWithProof',
    'mintWithAllowlist',
    'signedMint',
    'mintSigned',
    'claimWithSignature',
    'ownerMint',
    'devMint',
    'reserveMint',
    'adminMint',
    'mintAllowedTokenHolder',
]);

const SEADROP_PUBLIC = new Set(['mintpublic']);

export interface ClassifyResult {
    category: MintCategory;
    functionName: string;
    reason: string;
    hasProofOrSignature: boolean;
}

export function classifyBySelector(selector: string): ClassifyResult | null {
    const knownPublic: Record<string, string> = {
        '0xa0712d68': 'mint(uint256)',
        '0x1249c58b': 'mint()',
        '0x40c10f19': 'mint(address,uint256)',
        '0x2db11544': 'publicMint(uint256)',
        '0x5b70ea9f': 'freeMint()',
        '0x161ac21f': 'mintPublic(address,address,address,uint256)',
        '0x51061988': 'mintPublic(address,address,address,uint256)',
    };
    const unsupported: Record<string, string> = {
        '0x46332f08': 'mintAllowlist',
        '0xefef39a1': 'mint(uint256,bytes32[])',
        '0x8a1361b5': 'mintSigned',
    };
    const s = selector.toLowerCase();
    if (unsupported[s]) {
        return {
            category: 'UNSUPPORTED',
            functionName: unsupported[s],
            reason: 'Proof/signature/allowlist selector',
            hasProofOrSignature: true,
        };
    }
    if (knownPublic[s]) {
        const name = knownPublic[s].split('(')[0];
        if (SEADROP_PUBLIC.has(name.toLowerCase())) {
            return {
                category: 'SUPPORTED_SEADROP_PUBLIC',
                functionName: knownPublic[s],
                reason: 'SeaDrop public mint',
                hasProofOrSignature: false,
            };
        }
        return {
            category: 'SUPPORTED_PUBLIC_MINT',
            functionName: knownPublic[s],
            reason: 'Known public mint selector',
            hasProofOrSignature: false,
        };
    }
    return null;
}

export function classifyByAbiFunction(name: string, inputs: readonly { type: string; name?: string }[]): ClassifyResult {
    const lower = name.toLowerCase();
    if (UNSUPPORTED_NAMES.has(name) || lower.includes('allowlist') || lower.includes('signed')) {
        return {
            category: 'UNSUPPORTED',
            functionName: name,
            reason: 'Allowlist/signature/private mint function',
            hasProofOrSignature: true,
        };
    }
    if (SEADROP_PUBLIC.has(lower)) {
        return {
            category: 'SUPPORTED_SEADROP_PUBLIC',
            functionName: name,
            reason: 'SeaDrop public',
            hasProofOrSignature: false,
        };
    }
    if (PUBLIC_MINT_NAMES.has(name)) {
        const hasProof = inputs.some(i => i.type.includes('bytes32[]') || i.type === 'bytes');
        if (hasProof) {
            return {
                category: 'UNSUPPORTED',
                functionName: name,
                reason: 'Public-named function includes proof bytes',
                hasProofOrSignature: true,
            };
        }
        return {
            category: 'SUPPORTED_PUBLIC_MINT',
            functionName: name,
            reason: 'Known public mint ABI',
            hasProofOrSignature: false,
        };
    }
    const hasAddress = inputs.some(i => i.type === 'address');
    const hasQty = inputs.some(i => i.type.startsWith('uint'));
    if (hasAddress && hasQty) {
        return {
            category: 'CONDITIONAL',
            functionName: name,
            reason: 'Recipient + quantity — replace if simulation passes',
            hasProofOrSignature: false,
        };
    }
    if (hasQty && inputs.length <= 2) {
        return {
            category: 'CONDITIONAL',
            functionName: name,
            reason: 'Quantity mint — msg.sender recipient',
            hasProofOrSignature: false,
        };
    }
    return {
        category: 'UNSUPPORTED',
        functionName: name,
        reason: 'Unknown function shape',
        hasProofOrSignature: false,
    };
}

export function calldataContainsWhalePadded(calldata: string, whale: string): boolean {
    if (!whale || calldata.length < 10) return false;
    const padded = whale.toLowerCase().replace('0x', '').padStart(64, '0');
    return calldata.toLowerCase().includes(padded);
}

export function decodeFunctionName(data: string, iface: Interface): string | null {
    try {
        const parsed = iface.parseTransaction({ data });
        return parsed?.name ?? null;
    } catch {
        return null;
    }
}
