/**
 * User-facing SeaDrop public-phase status for Telegram (link mint, /mint wizard, automint).
 */

import { formatEther } from 'ethers';
import type { SeaDropPublicDropInfo } from './seaDropBuilder';
import { seaDropPublicMintBlockedReason } from './seaDropBuilder';

const FREE_MINT_SELECTOR = '0xa0712d68';

/** Mirrors linkMintService.isDirectNftMintResolution (kept local to avoid import cycles). */
export interface SeaDropMintResolutionLike {
    mintPath?: string;
    executionTo: string;
    contractAddress: string;
    detectedSelector?: string;
    suggestedCalldata?: string;
    allowSimulationBypass?: boolean;
    seaDropStatus?: {
        publicPhase: SeaDropPublicPhase;
        summary?: string;
        blockedReason?: string | null;
    };
    paymentConfidence?: string;
}

function isDirectNftMintResolution(target: SeaDropMintResolutionLike): boolean {
    if (target.mintPath === 'direct_nft') return true;
    const sel = (target.detectedSelector || target.suggestedCalldata?.slice(0, 10) || '').toLowerCase();
    if (sel === FREE_MINT_SELECTOR) return true;
    const to = (target.executionTo || '').toLowerCase();
    const nft = target.contractAddress.toLowerCase();
    return Boolean(to && nft && to === nft && target.suggestedCalldata && target.suggestedCalldata.length <= 10);
}

export type SeaDropPublicPhase =
    | 'active'
    | 'not_started'
    | 'ended'
    | 'zero_wallet_limit'
    | 'no_drop';

export interface SeaDropPublicStatus {
    publicPhase: SeaDropPublicPhase;
    blockedReason: string | null;
    hasOpenSeaSlug: boolean;
    drop: SeaDropPublicDropInfo | null;
}

export function formatUnixUtc(ts: number): string {
    if (!ts) return '—';
    return `${new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

export function classifySeaDropPublicPhase(drop: SeaDropPublicDropInfo): SeaDropPublicPhase {
    const now = Math.floor(Date.now() / 1000);
    if (drop.maxPerWallet === 0) return 'zero_wallet_limit';
    if (drop.startTime > now) return 'not_started';
    if (drop.endTime > 0 && drop.endTime <= now) return 'ended';
    if (!drop.isActive) return 'ended';
    return 'active';
}

export function buildSeaDropPublicStatus(
    drop: SeaDropPublicDropInfo | null,
    hasOpenSeaSlug: boolean
): SeaDropPublicStatus {
    if (!drop) {
        return {
            publicPhase: 'no_drop',
            blockedReason: null,
            hasOpenSeaSlug,
            drop: null,
        };
    }
    const publicPhase = classifySeaDropPublicPhase(drop);
    return {
        publicPhase,
        blockedReason: seaDropPublicMintBlockedReason(drop),
        hasOpenSeaSlug,
        drop,
    };
}

function phaseHeadline(phase: SeaDropPublicPhase): string {
    switch (phase) {
        case 'not_started':
            return 'Public mint has not started yet';
        case 'ended':
            return 'Public mint window has ended';
        case 'zero_wallet_limit':
            return 'Public mint is closed (0 per wallet on-chain)';
        case 'no_drop':
            return 'No SeaDrop public drop on known routers';
        default:
            return 'SeaDrop public mint is active';
    }
}

/** Short HTML block for previews and batch-mint blocks. */
export function formatSeaDropStatusTelegram(
    status: SeaDropPublicStatus,
    nftContract: string
): string {
    const lines: string[] = [];
    lines.push(`<b>SeaDrop:</b> ${phaseHeadline(status.publicPhase)}`);

    const drop = status.drop;
    if (drop) {
        const priceEth = formatEther(drop.mintPrice);
        const windowEnd =
            drop.endTime === 0
                ? '<i>no end time</i>'
                : `<code>${formatUnixUtc(drop.endTime)}</code>`;
        lines.push(`Window: <code>${formatUnixUtc(drop.startTime)}</code> → ${windowEnd}`);
        lines.push(
            `Price: <b>${priceEth}</b> ETH · max <b>${drop.maxPerWallet}</b>/wallet · router <code>${drop.router.slice(0, 10)}…</code>`
        );
    }

    if (status.publicPhase !== 'active' && status.publicPhase !== 'no_drop') {
        if (status.hasOpenSeaSlug) {
            lines.push(
                `<b>GTD / allowlist:</b> set <code>OPENSEA_API_KEY</code> and paste the link again — OpenSea can build the tx for your wallet’s current phase.`
            );
        } else if (status.publicPhase === 'zero_wallet_limit') {
            lines.push(
                `<b>Next:</b> wait for public to open, or copy calldata from a live mint tx on Etherscan.`
            );
        } else if (status.publicPhase === 'not_started') {
            lines.push(`<b>Next:</b> wait until the start time above, or use an allowlist/GTD path if you have one.`);
        } else {
            lines.push(
                `<b>Next:</b> check for a direct <code>freeMint()</code> on the NFT contract, or use calldata from a recent successful mint.`
            );
        }
    }

    lines.push(`NFT: <code>${nftContract}</code>`);
    return lines.join('\n');
}

export function formatSeaDropBlockedWizardMessage(nftContract: string, summary?: string): string {
    return (
        `⚠️ <b>SeaDrop public mint unavailable</b>\n\n` +
        `${summary || 'On-chain SeaDrop public mint is not open for this contract.'}\n\n` +
        `<b>Workaround:</b> copy calldata from a successful mint on Etherscan, then:\n` +
        `<code>/blockmint ${nftContract} raw 0 0x5b70ea9f next</code>`
    );
}

export function shouldBlockBatchMintForSeaDrop(resolved: SeaDropMintResolutionLike): boolean {
    if (isDirectNftMintResolution(resolved)) return false;
    if (resolved.mintPath === 'seadrop_router') return false;
    if (resolved.allowSimulationBypass && resolved.mintPath === 'direct_nft') return false;

    const phase = resolved.seaDropStatus?.publicPhase;
    if (!phase || phase === 'active' || phase === 'no_drop') return false;
    if (phase === 'zero_wallet_limit') return true;
    if ((phase === 'not_started' || phase === 'ended') && resolved.mintPath === 'detected') {
        return true;
    }
    return false;
}

export function seaDropInactiveBlocksLinkMint(resolved: SeaDropMintResolutionLike): string | null {
    if (isDirectNftMintResolution(resolved)) return null;
    if (resolved.mintPath === 'seadrop_router') return null;
    if (resolved.allowSimulationBypass) return null;

    const phase = resolved.seaDropStatus?.publicPhase;
    if (!phase || phase === 'active' || phase === 'no_drop') return null;

    if (phase === 'zero_wallet_limit') {
        return (
            resolved.seaDropStatus?.blockedReason ||
            'SeaDrop public allows 0 mints per wallet — use OPENSEA_API_KEY for GTD or copy live mint calldata'
        );
    }
    if ((phase === 'not_started' || phase === 'ended') && resolved.paymentConfidence === 'low') {
        return resolved.seaDropStatus?.blockedReason || 'SeaDrop public phase is not open on-chain';
    }
    return null;
}
