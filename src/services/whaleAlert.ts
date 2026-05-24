/**
 * Whale mint alert formatting — rich Telegram HTML + optional collection image.
 */
import { formatEther, type JsonRpcProvider } from 'ethers';
import type { DetectedMint } from '../utils/trackerCore';
import { fetchNFTMetadata, type NFTMetadata } from '../utils/nftMetadata';
import { shortenAddress, uiRow, uiScreen } from '../bot/ui/premiumMessages';
import { escapeHtml, formatSupplyLine } from '../bot/telegramFormat';
import { fetchCollectionImageUrl } from './mintedNftReport';

export interface WhaleAlertPayload {
    text: string;
    imageUrl?: string;
}

export interface WhaleAlertBuildInput {
    mint: DetectedMint;
    meta: NFTMetadata;
    imageUrl?: string;
    tokenIds?: string[];
}

export function formatWhaleAlertMessage(input: WhaleAlertBuildInput): string {
    const { mint, meta, tokenIds } = input;
    const safeName = escapeHtml(meta.name || 'Unknown');
    const sym =
        meta.symbol && meta.symbol !== 'Unknown'
            ? ` <code>${escapeHtml(meta.symbol)}</code>`
            : '';
    const contract = mint.to;
    const supply = formatSupplyLine(meta.totalSupply, meta.maxSupply);
    const valueEth = formatEther(mint.value);

    const conf = mint.classificationConfidence
        ? uiRow('Signal', `${mint.classificationConfidence} (${mint.detectionPath})`)
        : '';
    const tokenLine =
        tokenIds && tokenIds.length > 0
            ? uiRow(
                  'Tokens',
                  `${tokenIds.slice(0, 8).join(', ')}${tokenIds.length > 8 ? ` (+${tokenIds.length - 8})` : ''}`
              )
            : '';

    const body =
        `<b>${safeName}</b>${sym}\n` +
        uiRow('Supply', escapeHtml(supply)) +
        '\n' +
        uiRow('Paid', `<b>${valueEth}</b> ETH`) +
        '\n' +
        uiRow('Whale', `<code>${shortenAddress(mint.from, 8, 6)}</code>`) +
        '\n' +
        uiRow('Contract', `<code>${shortenAddress(contract || '', 8, 6)}</code>`) +
        '\n' +
        uiRow('Tx', `<a href="https://etherscan.io/tx/${mint.hash}">${mint.hash.slice(0, 12)}…</a>`) +
        (conf ? `\n${conf}` : '') +
        (tokenLine ? `\n${tokenLine}` : '');

    return uiScreen({
        icon: '🐋',
        title: 'Whale mint',
        body,
        footer:
            `<a href="https://etherscan.io/address/${contract}">Etherscan</a> · ` +
            `<a href="https://blur.io/collection/${contract}">Blur</a> · ` +
            `<a href="https://opensea.io/assets/ethereum/${contract}">OpenSea</a>`,
    });
}

export async function buildWhaleAlertPayload(
    mint: DetectedMint,
    provider: JsonRpcProvider,
    opts?: { meta?: NFTMetadata; imageUrl?: string; tokenIds?: string[]; skipImage?: boolean }
): Promise<WhaleAlertPayload> {
    const meta =
        opts?.meta ||
        (await fetchNFTMetadata(mint.to, provider).catch(() => ({
            name: 'Unknown',
            symbol: 'Unknown',
        })));

    let imageUrl = opts?.imageUrl;
    if (!imageUrl && !opts?.skipImage) {
        imageUrl = (await fetchCollectionImageUrl(mint.to)) || undefined;
    }

    const text = formatWhaleAlertMessage({ mint, meta, imageUrl, tokenIds: opts?.tokenIds });
    return { text, imageUrl };
}
