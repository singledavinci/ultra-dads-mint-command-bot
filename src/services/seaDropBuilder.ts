/**
 * SeaDrop Calldata Builder — constructs correct calldata for SeaDrop mints.
 *
 * Handles:
 *   - mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity)
 *   - Detects SeaDrop-compatible contracts on v1.0 and v1.1 routers
 *   - Self-mints use minterIfNotPayer = address(0) so msg.sender receives the NFT (avoids PayerNotAllowed)
 */

import { AbiCoder, Contract, JsonRpcProvider, ZeroAddress } from 'ethers';

/**
 * SeaDrop `minterIfNotPayer`: use zero when the tx sender mints to themselves.
 * Non-zero requires `_allowedPayers` and reverts with PayerNotAllowed if msg.sender ≠ minter.
 */
export function seaDropMinterIfNotPayerForSelfMint(): string {
    return ZeroAddress;
}

// SeaDrop router addresses
export const SEADROP_ROUTERS = [
    '0x00005ea00ac477b1030ce78506496e8c2de24bf5', // SeaDrop v1.0
    '0x0000000000664ceffed39244a8312556a900b938', // SeaDrop v1.1
] as const;

/** Current mintPublic selector (ethers id: mintPublic(address,address,address,uint256)). */
export const SEADROP_MINT_PUBLIC = '0x161ac21f';
/** Legacy selector still accepted on SeaDrop v1.1. */
export const SEADROP_MINT_PUBLIC_LEGACY = '0x51061988';
/** mintAllowlist(address,address,address,uint256,bytes32[]) */
export const SEADROP_MINT_ALLOWLIST = '0x46332f08';

const SEADROP_DETECT_ABI = [
    'function getMintStats(address nftContract, address minter) view returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply)',
    'function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))',
    'function getAllowedFeeRecipients(address nftContract) view returns (address[])',
];

export interface SeaDropMintParams {
    nftContract: string;
    feeRecipient?: string;
    minter: string;
    quantity: number;
    seaDropRouter?: string;
    mintSelector?: string;
}

export interface SeaDropMintResult {
    to: string;
    data: string;
    value: string;
    gasEstimate?: bigint;
    warnings: string[];
    selector: string;
    functionName: string;
}

export interface SeaDropPublicDropInfo {
    router: string;
    mintPrice: bigint;
    maxPerWallet: number;
    startTime: number;
    endTime: number;
    isActive: boolean;
    restrictFeeRecipients: boolean;
}

export function isSeaDropRouter(address: string): boolean {
    return (SEADROP_ROUTERS as readonly string[]).includes(address.toLowerCase());
}

export function isSeaDropPublicSelector(selector: string): boolean {
    const s = selector.toLowerCase();
    return s === SEADROP_MINT_PUBLIC || s === SEADROP_MINT_PUBLIC_LEGACY;
}

/**
 * Find which SeaDrop router hosts the public drop for this NFT contract.
 */
export async function findSeaDropPublicDrop(
    nftContract: string,
    provider: JsonRpcProvider
): Promise<SeaDropPublicDropInfo | null> {
    for (const router of SEADROP_ROUTERS) {
        try {
            const contract = new Contract(router, SEADROP_DETECT_ABI, provider);
            const drop = await contract.getPublicDrop(nftContract);
            const now = Math.floor(Date.now() / 1000);
            const startTime = Number(drop.startTime);
            const endTime = Number(drop.endTime);
            const isActive = startTime <= now && (endTime === 0 || endTime > now);

            return {
                router,
                mintPrice: BigInt(drop.mintPrice.toString()),
                maxPerWallet: Number(drop.maxTotalMintableByWallet),
                startTime,
                endTime,
                isActive,
                restrictFeeRecipients: Boolean(drop.restrictFeeRecipients),
            };
        } catch {
            /* try next router */
        }
    }
    return null;
}

/** Mints left for `minter` when public drop info is already resolved (skips router lookup). */
export async function getSeaDropRemainingMintsWithDrop(
    drop: SeaDropPublicDropInfo,
    nftContract: string,
    minter: string,
    provider: JsonRpcProvider
): Promise<{ remaining: number; maxPerWallet: number; minted: number } | null> {
    const maxPerWallet = drop.maxPerWallet;
    if (maxPerWallet === 0) {
        return { remaining: 0, maxPerWallet: 0, minted: 0 };
    }

    for (const router of SEADROP_ROUTERS) {
        try {
            const contract = new Contract(router, SEADROP_DETECT_ABI, provider);
            const stats = await contract.getMintStats(nftContract, minter);
            const minted = Number(stats.minterNumMinted);
            const remaining =
                maxPerWallet > 0 ? Math.max(0, maxPerWallet - minted) : maxPerWallet;
            return { remaining, maxPerWallet, minted };
        } catch {
            /* try next router */
        }
    }

    return { remaining: maxPerWallet, maxPerWallet, minted: 0 };
}

/** Mints left for `minter` on the public drop (max per wallet minus already minted). */
export async function getSeaDropRemainingMints(
    nftContract: string,
    minter: string,
    provider: JsonRpcProvider
): Promise<{ remaining: number; maxPerWallet: number; minted: number } | null> {
    const drop = await findSeaDropPublicDrop(nftContract, provider);
    if (!drop) return null;
    return getSeaDropRemainingMintsWithDrop(drop, nftContract, minter, provider);
}

export async function getSeaDropPublicDrop(
    nftContract: string,
    provider: JsonRpcProvider,
    routerAddress?: string
): Promise<{ mintPrice: bigint; maxPerWallet: number; isActive: boolean } | null> {
    if (routerAddress) {
        const info = await findSeaDropPublicDrop(nftContract, provider);
        if (info?.router.toLowerCase() === routerAddress.toLowerCase()) {
            return {
                mintPrice: info.mintPrice,
                maxPerWallet: info.maxPerWallet,
                isActive: info.isActive,
            };
        }
    }
    const info = await findSeaDropPublicDrop(nftContract, provider);
    if (!info) return null;
    return {
        mintPrice: info.mintPrice,
        maxPerWallet: info.maxPerWallet,
        isActive: info.isActive,
    };
}

export async function resolveSeaDropFeeRecipient(
    nftContract: string,
    provider: JsonRpcProvider,
    router: string,
    restrictFeeRecipients: boolean
): Promise<string> {
    if (!restrictFeeRecipients) {
        return '0x0000000000000000000000000000000000000000';
    }
    try {
        const contract = new Contract(router, SEADROP_DETECT_ABI, provider);
        const list: string[] = await contract.getAllowedFeeRecipients(nftContract);
        if (list?.length > 0) return list[0];
    } catch {
        /* fall through */
    }
    return '0x0000000000000000000000000000000000000000';
}

/**
 * Pick a mintPublic selector that estimateGas accepts on this router.
 */
async function pickMintPublicSelector(
    router: string,
    nftContract: string,
    feeRecipient: string,
    minter: string,
    quantity: number,
    value: bigint,
    provider: JsonRpcProvider
): Promise<string> {
    const coder = AbiCoder.defaultAbiCoder();
    const candidates = [SEADROP_MINT_PUBLIC, SEADROP_MINT_PUBLIC_LEGACY];
    for (const sel of candidates) {
        const data =
            sel +
            coder
                .encode(
                    ['address', 'address', 'address', 'uint256'],
                    [nftContract, feeRecipient, seaDropMinterIfNotPayerForSelfMint(), BigInt(quantity)]
                )
                .slice(2);
        try {
            await provider.estimateGas({
                to: router,
                from: minter,
                data,
                value: value > 0n ? value : 0n,
            });
            return sel;
        } catch {
            /* try next */
        }
    }
    return SEADROP_MINT_PUBLIC;
}

export function buildSeaDropMintCalldata(params: SeaDropMintParams): SeaDropMintResult {
    const coder = AbiCoder.defaultAbiCoder();
    const router = params.seaDropRouter || SEADROP_ROUTERS[1];
    const feeRecipient = params.feeRecipient || '0x0000000000000000000000000000000000000000';
    const selector = params.mintSelector || SEADROP_MINT_PUBLIC;
    const warnings: string[] = [];

    if (params.quantity > 20) {
        warnings.push(`High quantity (${params.quantity}) — may exceed per-wallet limit`);
    }

    const data =
        selector +
        coder
            .encode(
                ['address', 'address', 'address', 'uint256'],
                [params.nftContract, feeRecipient, seaDropMinterIfNotPayerForSelfMint(), params.quantity]
            )
            .slice(2);

    return {
        to: router,
        data,
        value: '0',
        warnings,
        selector,
        functionName: 'mintPublic(address,address,address,uint256)',
    };
}

/**
 * Build a link-mint / paste-contract SeaDrop transaction (router + calldata + value).
 */
/** Human-readable block when SeaDrop public mint cannot run. */
export function seaDropPublicMintBlockedReason(drop: SeaDropPublicDropInfo): string | null {
    const now = Math.floor(Date.now() / 1000);
    if (drop.maxPerWallet === 0) {
        return 'SeaDrop public allows 0 mints per wallet (GTD/allowlist or private phase). Use OPENSEA_API_KEY for GTD, or copy calldata from a live mint tx.';
    }
    if (drop.startTime > now) {
        return `SeaDrop public has not started (opens ${new Date(drop.startTime * 1000).toISOString().slice(0, 16)} UTC).`;
    }
    if (drop.endTime > 0 && drop.endTime <= now) {
        return `SeaDrop public ended (${new Date(drop.endTime * 1000).toISOString().slice(0, 16)} UTC). Try direct NFT mint calldata or a later phase.`;
    }
    if (!drop.isActive) {
        return 'SeaDrop public mint is outside the on-chain start/end window.';
    }
    return null;
}

export async function buildSeaDropLinkMint(
    nftContract: string,
    minter: string,
    quantity: number,
    provider: JsonRpcProvider
): Promise<SeaDropMintResult | null> {
    const drop = await findSeaDropPublicDrop(nftContract, provider);
    if (!drop) return null;

    const blocked = seaDropPublicMintBlockedReason(drop);
    if (blocked) {
        throw new Error(blocked);
    }

    const feeRecipient = await resolveSeaDropFeeRecipient(
        nftContract,
        provider,
        drop.router,
        drop.restrictFeeRecipients
    );

    const totalValue = drop.mintPrice * BigInt(quantity);
    const selector = await pickMintPublicSelector(
        drop.router,
        nftContract,
        feeRecipient,
        minter,
        quantity,
        totalValue,
        provider
    );

    const result = buildSeaDropMintCalldata({
        nftContract,
        minter,
        quantity,
        seaDropRouter: drop.router,
        feeRecipient,
        mintSelector: selector,
    });
    result.value = totalValue > 0n ? '0x' + totalValue.toString(16) : '0x0';

    if (drop.restrictFeeRecipients && feeRecipient === '0x0000000000000000000000000000000000000000') {
        result.warnings.push('⚠️ Could not resolve allowed fee recipient');
    }
    if (quantity > drop.maxPerWallet && drop.maxPerWallet > 0) {
        result.warnings.push(
            `Quantity ${quantity} exceeds max per wallet (${drop.maxPerWallet}) — use a lower qty`
        );
    }

    return result;
}

export async function buildSeaDropMintWithPrice(
    nftContract: string,
    minter: string,
    quantity: number,
    provider: JsonRpcProvider
): Promise<SeaDropMintResult | null> {
    return buildSeaDropLinkMint(nftContract, minter, quantity, provider);
}

/**
 * Rewrite SeaDrop mintPublic for self-mint replay (`minterIfNotPayer` = 0, NFT to msg.sender).
 * Only public selectors — never hijacks allowlist (whale proof is not transferable).
 */
export function isSeaDropAllowlistSelector(selector: string): boolean {
    return selector.toLowerCase() === SEADROP_MINT_ALLOWLIST;
}

/**
 * Rewrite allowlist minter slot only — proof stays unchanged (same-wallet replay only).
 * For different wallets use OpenSea Drops API via resolveSeaDropMint().
 */
export function hijackSeaDropAllowlistCalldata(originalData: string, newMinter: string): string | null {
    if (!isSeaDropAllowlistSelector(originalData.slice(0, 10))) return null;
    try {
        const coder = AbiCoder.defaultAbiCoder();
        const payload = ('0x' + originalData.slice(10)) as `0x${string}`;
        const [nft, feeRecipient, , quantity, proof] = coder.decode(
            ['address', 'address', 'address', 'uint256', 'bytes32[]'],
            payload
        );
        return (
            SEADROP_MINT_ALLOWLIST +
            coder
                .encode(
                    ['address', 'address', 'address', 'uint256', 'bytes32[]'],
                    [nft, feeRecipient, seaDropMinterIfNotPayerForSelfMint(), quantity, proof]
                )
                .slice(2)
        );
    } catch {
        return null;
    }
}

export function hijackSeaDropCalldata(originalData: string, newMinter: string): string | null {
    const selector = originalData.slice(0, 10).toLowerCase();

    if (isSeaDropAllowlistSelector(selector)) {
        return hijackSeaDropAllowlistCalldata(originalData, newMinter);
    }

    if (!isSeaDropPublicSelector(selector)) {
        return null;
    }

    try {
        const coder = AbiCoder.defaultAbiCoder();
        const payload = ('0x' + originalData.slice(10)) as `0x${string}`;
        const [nft, feeRecipient, , quantity] = coder.decode(
            ['address', 'address', 'address', 'uint256'],
            payload
        );
        return (
            selector +
            coder
                .encode(
                    ['address', 'address', 'address', 'uint256'],
                    [nft, feeRecipient, seaDropMinterIfNotPayerForSelfMint(), quantity]
                )
                .slice(2)
        );
    } catch {
        return null;
    }
}
