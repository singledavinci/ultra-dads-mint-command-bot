/**
 * SeaDrop mint resolution — public, GTD/allowlist, signed, and FCFS paths (Ethereum).
 *
 * Priority:
 *   1. OpenSea Drops mint API (wallet-specific proof/signature for active phase)
 *   2. On-chain public drop (mintPublic)
 *   3. Caller may fall back to direct NFT contract mint (FCFS) via linkMintService
 */

import type { JsonRpcProvider } from 'ethers';
import { resolveOpenSeaSlugFromContract } from '../contractMint/signatureMint/slugResolver.js';
import {
    buildSeaDropLinkMint,
    findSeaDropPublicDrop,
    SEADROP_MINT_ALLOWLIST,
    SEADROP_MINT_PUBLIC,
    SEADROP_MINT_PUBLIC_LEGACY,
    type SeaDropMintResult,
} from './seaDropBuilder';
import {
    resolveOnChainAllowlistMint,
    SEADROP_MINT_ALLOWLIST_V2,
} from './seaDropAllowlistMint.js';
import { buildSeaDropPublicStatus, type SeaDropPublicStatus } from './seaDropUx';

export { SEADROP_MINT_ALLOWLIST, SEADROP_MINT_PUBLIC } from './seaDropBuilder';
export { SEADROP_MINT_ALLOWLIST_V2 } from './seaDropAllowlistMint.js';
export const SEADROP_MINT_SIGNED = '0x8a1361b5';
export const SEADROP_MINT_TOKEN_GATED = '0x6e179c0f';

export type SeaDropPhase = 'public' | 'allowlist' | 'signed' | 'token_gated' | 'unknown';
export type SeaDropMintSource = 'opensea_api' | 'on_chain_allowlist' | 'on_chain_public';

export interface ResolvedSeaDropMint extends SeaDropMintResult {
    phase: SeaDropPhase;
    source: SeaDropMintSource;
    nftContract: string;
}

export function inferSeaDropPhaseFromSelector(selector: string): SeaDropPhase {
    const s = selector.toLowerCase();
    if (s === SEADROP_MINT_PUBLIC || s === SEADROP_MINT_PUBLIC_LEGACY) return 'public';
    if (s === SEADROP_MINT_ALLOWLIST || s === SEADROP_MINT_ALLOWLIST_V2) return 'allowlist';
    if (s === SEADROP_MINT_SIGNED) return 'signed';
    if (s === SEADROP_MINT_TOKEN_GATED) return 'token_gated';
    return 'unknown';
}

export function phaseLabel(phase: SeaDropPhase): string {
    switch (phase) {
        case 'public':
            return 'Public';
        case 'allowlist':
            return 'GTD / Allowlist';
        case 'signed':
            return 'Signed drop';
        case 'token_gated':
            return 'Token-gated';
        default:
            return 'SeaDrop';
    }
}

function useOpenSeaSeaDropApi(): boolean {
    return process.env.SEADROP_USE_OPENSEA_API !== 'false';
}

function formatValueHex(value: string | undefined): string {
    if (!value || value === '0') return '0x0';
    if (value.startsWith('0x')) return value;
    return '0x' + BigInt(value).toString(16);
}

/**
 * OpenSea builds the correct tx for the wallet's current eligible phase (GTD, public, signed, etc.).
 */
export async function fetchOpenSeaSeaDropMint(params: {
    nftContract: string;
    minter: string;
    quantity: number;
    chainId?: number;
}): Promise<ResolvedSeaDropMint | null> {
    const slug = await resolveOpenSeaSlugFromContract(
        params.nftContract,
        params.chainId ?? 1
    );
    if (!slug) return null;

    const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/json',
    };
    const apiKey = process.env.OPENSEA_API_KEY?.trim();
    if (apiKey) headers['x-api-key'] = apiKey;

    try {
        const url = `https://api.opensea.io/api/v2/drops/${encodeURIComponent(slug)}/mint`;
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ minter: params.minter, quantity: params.quantity }),
            signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
            return null;
        }

        const json = (await res.json()) as { to?: string; data?: string; value?: string };
        if (!json.to || !json.data) return null;

        const selector = json.data.slice(0, 10).toLowerCase();
        const phase = inferSeaDropPhaseFromSelector(selector);
        const value = formatValueHex(json.value);

        return {
            to: json.to.toLowerCase(),
            data: json.data,
            value,
            selector,
            functionName: `seadrop_${phase}`,
            warnings: [
                `OpenSea drop mint (${slug}) — <b>${phaseLabel(phase)}</b>`,
                `Phase selector <code>${selector}</code>`,
            ],
            phase,
            source: 'opensea_api',
            nftContract: params.nftContract.toLowerCase(),
        };
    } catch {
        return null;
    }
}

export interface ResolveSeaDropMintParams {
    nftContract: string;
    minter: string;
    quantity: number;
    provider: JsonRpcProvider;
    /** When false, skip OpenSea API even if configured */
    tryOpenSea?: boolean;
}

/**
 * Resolve a SeaDrop mint for `minter` — tries OpenSea API then on-chain public.
 */
export async function resolveSeaDropMint(
    params: ResolveSeaDropMintParams
): Promise<ResolvedSeaDropMint | null> {
    const nft = params.nftContract.toLowerCase();
    const tryOs = params.tryOpenSea !== false && useOpenSeaSeaDropApi();

    if (tryOs) {
        const fromApi = await fetchOpenSeaSeaDropMint({
            nftContract: nft,
            minter: params.minter,
            quantity: params.quantity,
        });
        if (fromApi) return fromApi;
    }

    try {
        const allowlistMint = await resolveOnChainAllowlistMint({
            nftContract: nft,
            minter: params.minter,
            quantity: params.quantity,
            provider: params.provider,
        });
        if (allowlistMint) {
            return {
                ...allowlistMint,
                phase: 'allowlist',
                source: 'on_chain_allowlist',
                nftContract: nft,
                warnings: [
                    ...allowlistMint.warnings,
                    'On-chain SeaDrop <b>GTD / allowlist</b> (merkle proof)',
                ],
            };
        }
    } catch {
        /* fall through to public */
    }

    try {
        const publicMint = await buildSeaDropLinkMint(
            nft,
            params.minter,
            params.quantity,
            params.provider
        );
        if (!publicMint) return null;
        return {
            ...publicMint,
            phase: 'public',
            source: 'on_chain_public',
            nftContract: nft,
            warnings: [
                ...publicMint.warnings,
                'On-chain SeaDrop <b>public</b> phase',
            ],
        };
    } catch {
        return null;
    }
}

/** Snapshot of which phases appear configured on-chain (for UI warnings). */
export async function getSeaDropPhaseHints(
    nftContract: string,
    provider: JsonRpcProvider
): Promise<
    SeaDropPublicStatus & {
        publicActive: boolean;
        publicMaxPerWallet: number;
        hasOpenSeaSlug: boolean;
    }
> {
    const drop = await findSeaDropPublicDrop(nftContract, provider);
    const slug = await resolveOpenSeaSlugFromContract(nftContract, 1);
    const hasOpenSeaSlug = Boolean(slug);
    const status = buildSeaDropPublicStatus(drop, hasOpenSeaSlug);
    return {
        ...status,
        publicActive: status.publicPhase === 'active',
        publicMaxPerWallet: drop?.maxPerWallet ?? 0,
        hasOpenSeaSlug,
    };
}
