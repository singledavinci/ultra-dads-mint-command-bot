/**
 * Per-wallet mint calldata rewrite — SeaDrop, Manifold, Zora, and generic ABI paths.
 */

import { AbiCoder, Interface } from 'ethers';
import {
    hijackSeaDropCalldata,
    isSeaDropAllowlistSelector,
    isSeaDropPublicSelector,
} from './seaDropBuilder';
import { replaceRecipientInCalldata } from './strategies/directContractStrategy';

const MANIFOLD_SELECTORS = new Set([
    '0xfa2b068f',
    '0x731133e9',
    '0x156e29f6',
]);

const ZORA_MINT_WITH_REWARDS = '0x0f4a1e5e';

const MANIFOLD_IFACE = new Interface([
    'function mint(address,uint256,uint256,address[],uint256[])',
    'function mint(address,uint256,uint256,bytes)',
    'function mint(address,uint256,uint256)',
]);

const ZORA_IFACE = new Interface([
    'function mintWithRewards(address,uint256,string,address)',
]);

const EXTENDED_DIRECT_IFACE = new Interface([
    'function mint(uint256 quantity)',
    'function mint()',
    'function mint(address to)',
    'function mint(address to, uint256 quantity)',
    'function mint(uint256 quantity, bytes32[] proof)',
    'function publicMint(uint256 quantity)',
    'function mintPublic(uint256 quantity)',
    'function purchase(uint256 quantity)',
    'function mintWithRewards(address,uint256,string,address)',
    'function mint(address,uint256,uint256,address[],uint256[])',
    'function mint(address,uint256,uint256,bytes)',
    'function mint(address,uint256,uint256)',
]);

function normalizeAddr(a: string): string {
    return a.toLowerCase();
}

function padAddressInCalldata(addr: string): string {
    return addr.toLowerCase().replace('0x', '').padStart(64, '0');
}

/**
 * Manifold mint functions use `address` as first arg (minter/recipient).
 */
export function hijackManifoldCalldata(originalData: string, newMinter: string, whaleAddress?: string): string | null {
    const selector = originalData.slice(0, 10).toLowerCase();
    if (!MANIFOLD_SELECTORS.has(selector)) return null;

    try {
        const coder = AbiCoder.defaultAbiCoder();
        const payload = ('0x' + originalData.slice(10)) as `0x${string}`;

        if (selector === '0x156e29f6') {
            const [to, a, b] = coder.decode(['address', 'uint256', 'uint256'], payload);
            const current = String(to);
            if (whaleAddress && normalizeAddr(current) !== normalizeAddr(whaleAddress)) return null;
            return (
                selector +
                coder.encode(['address', 'uint256', 'uint256'], [newMinter, a, b]).slice(2)
            );
        }
        if (selector === '0x731133e9') {
            const [to, a, b, extra] = coder.decode(['address', 'uint256', 'uint256', 'bytes'], payload);
            const current = String(to);
            if (whaleAddress && normalizeAddr(current) !== normalizeAddr(whaleAddress)) return null;
            return (
                selector +
                coder.encode(['address', 'uint256', 'uint256', 'bytes'], [newMinter, a, b, extra]).slice(2)
            );
        }
        if (selector === '0xfa2b068f') {
            const [to, a, b, addrs, amounts] = coder.decode(
                ['address', 'uint256', 'uint256', 'address[]', 'uint256[]'],
                payload
            );
            const current = String(to);
            if (whaleAddress && normalizeAddr(current) !== normalizeAddr(whaleAddress)) return null;
            return (
                selector +
                coder
                    .encode(
                        ['address', 'uint256', 'uint256', 'address[]', 'uint256[]'],
                        [newMinter, a, b, addrs, amounts]
                    )
                    .slice(2)
            );
        }
    } catch {
        return null;
    }
    return null;
}

/** Zora mintWithRewards — first address is `to`. */
export function hijackZoraCalldata(originalData: string, newMinter: string, whaleAddress?: string): string | null {
    if (originalData.slice(0, 10).toLowerCase() !== ZORA_MINT_WITH_REWARDS) return null;
    try {
        const coder = AbiCoder.defaultAbiCoder();
        const payload = ('0x' + originalData.slice(10)) as `0x${string}`;
        const [to, qty, comment, referral] = coder.decode(
            ['address', 'uint256', 'string', 'address'],
            payload
        );
        const current = String(to);
        if (whaleAddress && normalizeAddr(current) !== normalizeAddr(whaleAddress)) return null;
        return (
            ZORA_MINT_WITH_REWARDS +
            coder
                .encode(['address', 'uint256', 'string', 'address'], [newMinter, qty, comment, referral])
                .slice(2)
        );
    } catch {
        return null;
    }
}

/**
 * Best-effort rewrite so minted NFTs go to `walletAddress` instead of whale.
 * Returns null if no safe rewrite applies (caller should use original or skip).
 */
export function rewriteMintCalldataForWallet(
    originalData: string,
    whaleAddress: string,
    walletAddress: string,
    extraIface?: Interface
): string | null {
    if (!originalData || originalData.length < 10) return null;

    const sea = hijackSeaDropCalldata(originalData, walletAddress);
    if (sea) return sea;

    const manifold = hijackManifoldCalldata(originalData, walletAddress, whaleAddress);
    if (manifold) return manifold;

    const zora = hijackZoraCalldata(originalData, walletAddress, whaleAddress);
    if (zora) return zora;

    const ifaces = extraIface ? [extraIface, EXTENDED_DIRECT_IFACE, MANIFOLD_IFACE, ZORA_IFACE] : [
        EXTENDED_DIRECT_IFACE,
        MANIFOLD_IFACE,
        ZORA_IFACE,
    ];

    for (const iface of ifaces) {
        const replaced = replaceRecipientInCalldata(originalData, whaleAddress, walletAddress, iface);
        if (replaced) return replaced;
    }

    // Last resort: padded address slot in calldata (same pattern as MintClassifier wallet rewrite hint)
    if (whaleAddress.startsWith('0x')) {
        const whalePad = padAddressInCalldata(whaleAddress);
        const walletPad = padAddressInCalldata(walletAddress);
        const lower = originalData.toLowerCase();
        if (lower.includes(whalePad)) {
            return '0x' + lower.replace(whalePad, walletPad).slice(2);
        }
    }

    return null;
}

/**
 * Bump mint quantity in calldata when automint should max-fill per wallet.
 * Replaces uint256 slots that match `previousQuantity` (defaults to SeaDrop decode).
 */
export function rewriteMintCalldataQuantity(
    originalData: string,
    newQuantity: number,
    previousQuantity?: number
): string | null {
    if (!originalData || originalData.length < 10 || newQuantity < 1) return null;

    const prevQty = previousQuantity ?? 1;
    if (newQuantity === prevQty) return originalData;

    const selector = originalData.slice(0, 10).toLowerCase();

    if (isSeaDropPublicSelector(selector)) {
        try {
            const coder = AbiCoder.defaultAbiCoder();
            const payload = ('0x' + originalData.slice(10)) as `0x${string}`;
            const [nft, feeRecipient, minter, qty] = coder.decode(
                ['address', 'address', 'address', 'uint256'],
                payload
            );
            const oldQ = Number(qty);
            if (prevQty > 1 && oldQ !== prevQty) return null;
            return (
                selector +
                coder
                    .encode(
                        ['address', 'address', 'address', 'uint256'],
                        [nft, feeRecipient, minter, BigInt(newQuantity)]
                    )
                    .slice(2)
            );
        } catch {
            return null;
        }
    }

    for (const iface of [EXTENDED_DIRECT_IFACE, MANIFOLD_IFACE, ZORA_IFACE]) {
        try {
            const parsed = iface.parseTransaction({ data: originalData });
            if (!parsed) continue;
            const args = [...parsed.args];
            let changed = false;
            for (let i = 0; i < args.length; i++) {
                const a = args[i];
                if (typeof a === 'bigint' && a > 0n && a < 1_000_000n && Number(a) === prevQty) {
                    args[i] = BigInt(newQuantity);
                    changed = true;
                }
            }
            if (changed) {
                return iface.encodeFunctionData(parsed.fragment, args);
            }
        } catch {
            /* try next iface */
        }
    }

    return null;
}

export function isPlatformMintSelector(selector: string): boolean {
    const s = selector.toLowerCase();
    return (
        isSeaDropPublicSelector(s) ||
        isSeaDropAllowlistSelector(s) ||
        MANIFOLD_SELECTORS.has(s) ||
        s === ZORA_MINT_WITH_REWARDS
    );
}
