/**
 * Link Mint Service — orchestrates the auto-mint-from-link feature.
 *
 * Flow: detect target → resolve contract → classify → build calldata → preview → execute
 *
 * Safety: admin-only by default, confirmation required, caps enforced,
 * unknown contracts rejected unless explicitly allowed.
 */

import { escapeHtml, uiConfidenceBadge, uiRow, uiScreen } from '../bot/ui/premiumMessages';
import { resolveDropTarget } from '../utils/dropResolver';
import {
    linkMintDedupeKey,
    markLinkMintExecuted,
    shouldBlockLinkMintRetry,
} from './linkMintDedupe';
import {
    detectMintInfo,
    detectRecentDirectMintPattern,
    encodeDirectMintCalldata,
    FREE_MINT_SELECTOR,
} from './mintPriceDetector';
import { findCachedByContract } from './simulationCache';
import { isSeaDropPublicSelector } from './seaDropBuilder';
import {
    getSeaDropPhaseHints,
    resolveSeaDropMint,
    type ResolvedSeaDropMint,
} from './seaDropMintResolver';
import {
    formatSeaDropStatusTelegram,
    seaDropInactiveBlocksLinkMint,
    type SeaDropPublicPhase,
} from './seaDropUx';
import { extractScatterSlug, resolveScatterLinkMint, scatterChainSupported } from './scatterMint';
import { resolveManifoldContractFromUrl } from './manifoldResolver';
import { resolveThirdwebContractFromUrl } from './thirdwebResolver';
import { resolveZoraContractFromUrl } from './zoraResolver';
import { resolvePlatformContractFromUrl } from './platformLinkResolver';
import { AbiCoder, formatEther, JsonRpcProvider } from 'ethers';

// ---- Types ----

export type MintTargetType =
    | 'raw_address'
    | 'etherscan'
    | 'opensea'
    | 'seadrop'
    | 'scatter'
    | 'manifold'
    | 'zora'
    | 'thirdweb'
    | 'catchmint'
    | 'unknown_url';

/** True when resolution targets the NFT contract with a direct mint (not SeaDrop router). */
export function isDirectNftMintResolution(target: ResolvedMintTarget): boolean {
    if (target.mintPath === 'direct_nft') return true;
    const sel = (target.detectedSelector || target.suggestedCalldata?.slice(0, 10) || '').toLowerCase();
    if (sel === FREE_MINT_SELECTOR) return true;
    const to = (target.executionTo || '').toLowerCase();
    const nft = target.contractAddress.toLowerCase();
    return Boolean(to && nft && to === nft && target.suggestedCalldata && target.suggestedCalldata.length <= 10);
}

export interface MintTargetCandidate {
    originalText: string;
    target: string;
    type: MintTargetType;
    confidence: 'high' | 'medium' | 'low';
}

export interface ResolvedMintTarget {
    input: string;
    contractAddress: string;
    /** `to` for the transaction — SeaDrop router when applicable, else NFT contract */
    executionTo: string;
    /** How the mint path was chosen */
    mintPath?: 'direct_nft' | 'seadrop_router' | 'scatter_api' | 'cached' | 'detected';
    /** Set when mintPath is scatter_api — execution rebuilds calldata per wallet */
    scatterSlug?: string;
    /** SeaDrop NFT contract — execution rebuilds router calldata per wallet */
    seaDropNftContract?: string;
    seaDropPhase?: string;
    /** On-chain SeaDrop public phase snapshot (link mint / batch wizard UX). */
    seaDropStatus?: {
        publicPhase: SeaDropPublicPhase;
        summary: string;
        blockedReason: string | null;
        hasOpenSeaSlug: boolean;
    };
    /** When true, link mint may broadcast even if estimateGas reverts (FCFS / gated freeMint). */
    allowSimulationBypass?: boolean;
    /** Gas advisor tier id for link mint broadcast (live gwei + tip). */
    suggestedGasTierId?: string;
    chainSlug: string;
    platform: MintTargetType;
    name: string;
    confidence: 'high' | 'medium' | 'low';
    sourceUrl?: string;
    warnings: string[];
    suggestedCalldata?: string;
    suggestedValue?: string;
    suggestedQuantity?: number;
    detectedSelector?: string;
    detectedFunctionName?: string;
    requiresManualCalldata: boolean;
    /** Link mint already resolved price/calldata — skip engine re-simulation when true */
    paymentPrevalidated: boolean;
    /** high/medium = prevalidated; low = allowUnknown fallback only */
    paymentConfidence: 'high' | 'medium' | 'low';
}

export interface LinkMintConfig {
    autoMintFromLinks: boolean;
    confirmationRequired: boolean;
    adminOnly: boolean;
    maxMintEth: number;
    maxTotalBatchEth: number;
    defaultQuantity: number;
    simulationMode: 'strict' | 'fast';
    allowUnknownLinkMint: boolean;
    requireKnownSelector: boolean;
    dedupeTtlMs: number;
    /** When false, same contract can be link-minted again immediately */
    linkMintDedupeEnabled: boolean;
}

export function loadLinkMintConfig(): LinkMintConfig {
    return {
        autoMintFromLinks: process.env.AUTO_MINT_FROM_LINKS === 'true',
        confirmationRequired: process.env.AUTO_MINT_CONFIRMATION_REQUIRED !== 'false',
        /** When true, only PERSONAL_ID may use pasted-link mint. Default: all users. */
        adminOnly: process.env.AUTO_MINT_LINKS_ADMIN_ONLY === 'true',
        maxMintEth: parseFloat(process.env.MAX_MINT_ETH || '0.03'),
        maxTotalBatchEth: parseFloat(process.env.MAX_TOTAL_BATCH_ETH || '0.1'),
        defaultQuantity: parseInt(process.env.DEFAULT_MINT_QUANTITY || '1', 10),
        simulationMode: (process.env.LINK_MINT_SIMULATION_MODE as 'strict' | 'fast') || 'strict',
        allowUnknownLinkMint: process.env.ALLOW_UNKNOWN_LINK_MINT === 'true',
        requireKnownSelector: process.env.REQUIRE_KNOWN_SELECTOR !== 'false',
        dedupeTtlMs: parseInt(process.env.LINK_MINT_DEDUPE_TTL_MS || '300000', 10),
        linkMintDedupeEnabled: process.env.LINK_MINT_DEDUPE_ENABLED === 'true',
    };
}

export function getLinkMintDedupeKey(target: ResolvedMintTarget): string {
    return linkMintDedupeKey(target.contractAddress, target.suggestedCalldata);
}

/** Call when user executes link mint (not on preview). */
export function recordLinkMintExecution(target: ResolvedMintTarget): void {
    markLinkMintExecuted(getLinkMintDedupeKey(target));
}

// ---- Detection ----

const ADDRESS_REGEX = /\b(0x[a-fA-F0-9]{40})\b/g;
const ETHERSCAN_REGEX = /etherscan\.io\/(address|token)\/(0x[a-fA-F0-9]{40})/i;
const OPENSEA_ASSET_REGEX = /opensea\.io\/assets\/([a-z0-9_-]+)\/(0x[a-fA-F0-9]{40})/i;
const OPENSEA_COLLECTION_REGEX = /opensea\.io\/(collection|drops)\/([a-z0-9_-]+)/i;
const CATCHMINT_REGEX = /catchmint\.xyz\/(collections|mints|address)\/(0x[a-fA-F0-9]{40})/i;
const SCATTER_COLLECTION_REGEX = /scatter\.art\/collection\/([a-z0-9_-]+)/i;
const MANIFOLD_REGEX = /app\.manifold\.xyz/i;
const ZORA_REGEX = /zora\.co\/(collect|mint)/i;
const THIRDWEB_REGEX = /thirdweb\.com/i;

/**
 * Detect mint targets from a plain Telegram message.
 * Returns candidates sorted by confidence (high first).
 */
export function detectMintTargetFromMessage(text: string): MintTargetCandidate[] {
    if (!text || text.startsWith('/')) return [];

    const candidates: MintTargetCandidate[] = [];

    // Etherscan links
    const etherscanMatch = text.match(ETHERSCAN_REGEX);
    if (etherscanMatch) {
        candidates.push({
            originalText: etherscanMatch[0],
            target: etherscanMatch[0],
            type: 'etherscan',
            confidence: 'high',
        });
    }

    // OpenSea asset links (contain contract address)
    const openseaAssetMatch = text.match(OPENSEA_ASSET_REGEX);
    if (openseaAssetMatch) {
        candidates.push({
            originalText: openseaAssetMatch[0],
            target: `https://${openseaAssetMatch[0]}`,
            type: 'opensea',
            confidence: 'high',
        });
    }

    // OpenSea collection/drops links
    const openseaCollMatch = text.match(OPENSEA_COLLECTION_REGEX);
    if (openseaCollMatch && !openseaAssetMatch) {
        candidates.push({
            originalText: openseaCollMatch[0],
            target: `https://${openseaCollMatch[0]}`,
            type: 'opensea',
            confidence: 'medium',
        });
    }

    // Scatter.art collection links
    const scatterMatch = text.match(SCATTER_COLLECTION_REGEX);
    if (scatterMatch) {
        const slug = scatterMatch[1];
        const raw = scatterMatch[0];
        const target = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        candidates.push({
            originalText: raw,
            target,
            type: 'scatter',
            confidence: 'high',
        });
    }

    // CatchMint links
    const catchmintMatch = text.match(CATCHMINT_REGEX);
    if (catchmintMatch) {
        candidates.push({
            originalText: catchmintMatch[0],
            target: catchmintMatch[0],
            type: 'catchmint',
            confidence: 'high',
        });
    }

    // Manifold links
    if (MANIFOLD_REGEX.test(text)) {
        const urlMatch = text.match(/https?:\/\/app\.manifold\.xyz[^\s]*/i);
        if (urlMatch) {
            candidates.push({
                originalText: urlMatch[0],
                target: urlMatch[0],
                type: 'manifold',
                confidence: 'medium',
            });
        }
    }

    // Zora links
    if (ZORA_REGEX.test(text)) {
        const urlMatch = text.match(/https?:\/\/zora\.co[^\s]*/i);
        if (urlMatch) {
            candidates.push({
                originalText: urlMatch[0],
                target: urlMatch[0],
                type: 'zora',
                confidence: 'medium',
            });
        }
    }

    // Thirdweb links
    if (THIRDWEB_REGEX.test(text)) {
        const urlMatch = text.match(/https?:\/\/thirdweb\.com[^\s]*/i);
        if (urlMatch) {
            candidates.push({
                originalText: urlMatch[0],
                target: urlMatch[0],
                type: 'thirdweb',
                confidence: 'low',
            });
        }
    }

    // Raw contract addresses (only if no URL matched for them already)
    const addressMatches = text.matchAll(ADDRESS_REGEX);
    for (const match of addressMatches) {
        const addr = match[1];
        const alreadyFound = candidates.some(c =>
            c.target.toLowerCase().includes(addr.toLowerCase())
        );
        if (!alreadyFound) {
            candidates.push({
                originalText: addr,
                target: addr,
                type: 'raw_address',
                confidence: 'medium',
            });
        }
    }

    // Sort by confidence
    const order = { high: 0, medium: 1, low: 2 };
    candidates.sort((a, b) => order[a.confidence] - order[b.confidence]);

    return candidates;
}

/**
 * Resolve a detected candidate into a full mint target.
 * If a provider is passed, queries on-chain for mint price and function.
 */
const DEFAULT_RESOLVE_DEADLINE_MS = parseInt(process.env.LINK_MINT_RESOLVE_DEADLINE_MS || '28000', 10);

/** Hard cap so link-mint handler cannot block the Telegram webhook indefinitely. */
export async function resolveMintTargetWithDeadline(
    candidate: MintTargetCandidate,
    provider?: JsonRpcProvider,
    simulateFrom?: string,
    deadlineMs: number = DEFAULT_RESOLVE_DEADLINE_MS
): Promise<ResolvedMintTarget | null> {
    return Promise.race([
        resolveMintTarget(candidate, provider, simulateFrom),
        new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error(`Mint resolve timed out after ${Math.round(deadlineMs / 1000)}s`)),
                deadlineMs
            )
        ),
    ]);
}

export async function resolveMintTarget(
    candidate: MintTargetCandidate,
    provider?: JsonRpcProvider,
    simulateFrom?: string
): Promise<ResolvedMintTarget | null> {
    const config = loadLinkMintConfig();
    const warnings: string[] = [];

    const scatterSlug = extractScatterSlug(candidate.target);
    if (scatterSlug && simulateFrom) {
        const quantity = config.defaultQuantity;
        const built = await resolveScatterLinkMint({
            slug: scatterSlug,
            minterAddress: simulateFrom,
            quantity,
            affiliateAddress: process.env.SCATTER_AFFILIATE_ADDRESS?.trim(),
        });
        if (built && scatterChainSupported(built.collection.chainId)) {
            return {
                input: candidate.originalText,
                contractAddress: built.collection.address,
                executionTo: built.tx.to,
                chainSlug: built.collection.chainId === 8453 ? 'base' : built.collection.chainId === 137 ? 'polygon' : 'ethereum',
                platform: 'scatter',
                name: built.collection.name || scatterSlug,
                confidence: 'high',
                sourceUrl: candidate.target,
                warnings: built.warnings,
                suggestedCalldata: built.tx.data,
                suggestedValue: built.tx.value,
                suggestedQuantity: quantity,
                detectedSelector: built.tx.data.slice(0, 10),
                detectedFunctionName: `scatter:${built.list.name || built.list.id}`,
                requiresManualCalldata: false,
                paymentPrevalidated: false,
                paymentConfidence: 'high',
                allowSimulationBypass: true,
                mintPath: 'scatter_api',
                scatterSlug,
            };
        } else if (built && !scatterChainSupported(built.collection.chainId)) {
            warnings.push(
                `Scatter collection is on chain ${built.collection.chainId} — bot executes on Ethereum mainnet only`
            );
        } else {
            warnings.push('Scatter API mint build failed — falling back to generic contract resolution');
        }
    }

    if (candidate.type === 'manifold' && !resolvePlatformContractFromUrl(candidate.target)) {
        const manifold = await resolveManifoldContractFromUrl(candidate.target);
        if (manifold) {
            const qty = config.defaultQuantity;
            let selector = '0xa0712d68';
            let functionName = 'mint(uint256)';
            let value = '0';
            let paymentConfidence: 'high' | 'medium' | 'low' = 'medium';
            if (provider && simulateFrom) {
                try {
                    const mintInfo = await detectMintInfo(
                        manifold.contract,
                        provider,
                        qty,
                        simulateFrom
                    );
                    if (mintInfo) {
                        selector = mintInfo.mintSelector;
                        functionName = mintInfo.mintFunctionName;
                        value = mintInfo.price > 0n ? '0x' + mintInfo.price.toString(16) : '0';
                        paymentConfidence = mintInfo.confidence;
                    }
                } catch {
                    warnings.push('Manifold: on-chain price probe failed');
                }
            }
            return {
                input: candidate.originalText,
                contractAddress: manifold.contract,
                executionTo: manifold.contract,
                chainSlug: 'ethereum',
                platform: 'manifold',
                name: manifold.label,
                confidence: 'high',
                sourceUrl: candidate.target,
                warnings: [...warnings, `Manifold slug <code>${manifold.slug}</code> → ETH contract`],
                suggestedCalldata: encodeDirectMintCalldata(selector, qty),
                suggestedValue: value,
                suggestedQuantity: qty,
                detectedSelector: selector,
                detectedFunctionName: functionName,
                requiresManualCalldata: false,
                paymentPrevalidated: false,
                paymentConfidence,
                mintPath: 'direct_nft',
            };
        }
        warnings.push('Manifold page found but could not resolve Ethereum contract — paste the 0x address or a whale mint tx');
    }

    if (/zora\.co\/collect\/(base|polygon|optimism|arbitrum|zora|oeth)(?:[:\/]|$)/i.test(candidate.target)) {
        warnings.push('Zora link is not on Ethereum mainnet — this bot only executes on ETH');
        return null;
    }

    if (candidate.type === 'zora' && !resolvePlatformContractFromUrl(candidate.target)) {
        const zora = await resolveZoraContractFromUrl(candidate.target);
        if (zora) {
            const qty = config.defaultQuantity;
            let selector = '0xa0712d68';
            let functionName = 'mint(uint256)';
            let value = '0';
            let paymentConfidence: 'high' | 'medium' | 'low' = 'medium';
            if (provider && simulateFrom) {
                try {
                    const mintInfo = await detectMintInfo(
                        zora.contract,
                        provider,
                        qty,
                        simulateFrom
                    );
                    if (mintInfo) {
                        selector = mintInfo.mintSelector;
                        functionName = mintInfo.mintFunctionName;
                        value = mintInfo.price > 0n ? '0x' + mintInfo.price.toString(16) : '0';
                        paymentConfidence = mintInfo.confidence;
                    }
                } catch {
                    warnings.push('Zora: on-chain price probe failed');
                }
            }
            return {
                input: candidate.originalText,
                contractAddress: zora.contract,
                executionTo: zora.contract,
                chainSlug: 'ethereum',
                platform: 'zora',
                name: zora.label,
                confidence: 'high',
                sourceUrl: candidate.target,
                warnings: [...warnings, `Zora <code>${zora.slug}</code> → ETH contract`],
                suggestedCalldata: encodeDirectMintCalldata(selector, qty),
                suggestedValue: value,
                suggestedQuantity: qty,
                detectedSelector: selector,
                detectedFunctionName: functionName,
                requiresManualCalldata: false,
                paymentPrevalidated: false,
                paymentConfidence,
                mintPath: 'direct_nft',
            };
        }
        warnings.push(
            'Zora page found but could not resolve Ethereum contract — try <code>zora.co/collect/eth:0x…</code> or paste the contract'
        );
    }

    if (
        /thirdweb\.com\/(?:explore\/)?(base|polygon|optimism|arbitrum|zora|avalanche|bnb|binance|linea|scroll|blast)(?:\/|$)/i.test(
            candidate.target
        )
    ) {
        warnings.push('Thirdweb link is not on Ethereum mainnet — this bot only executes on ETH');
        return null;
    }

    if (candidate.type === 'thirdweb' && !resolvePlatformContractFromUrl(candidate.target)) {
        const thirdweb = await resolveThirdwebContractFromUrl(candidate.target);
        if (thirdweb) {
            const qty = config.defaultQuantity;
            let selector = '0xa0712d68';
            let functionName = 'mint(uint256)';
            let value = '0';
            let paymentConfidence: 'high' | 'medium' | 'low' = 'medium';
            if (provider && simulateFrom) {
                try {
                    const mintInfo = await detectMintInfo(
                        thirdweb.contract,
                        provider,
                        qty,
                        simulateFrom
                    );
                    if (mintInfo) {
                        selector = mintInfo.mintSelector;
                        functionName = mintInfo.mintFunctionName;
                        value = mintInfo.price > 0n ? '0x' + mintInfo.price.toString(16) : '0';
                        paymentConfidence = mintInfo.confidence;
                    }
                } catch {
                    warnings.push('Thirdweb: on-chain price probe failed');
                }
            }
            return {
                input: candidate.originalText,
                contractAddress: thirdweb.contract,
                executionTo: thirdweb.contract,
                chainSlug: 'ethereum',
                platform: 'thirdweb',
                name: thirdweb.label,
                confidence: 'high',
                sourceUrl: candidate.target,
                warnings: [...warnings, `Thirdweb <code>${thirdweb.slug}</code> → ETH contract`],
                suggestedCalldata: encodeDirectMintCalldata(selector, qty),
                suggestedValue: value,
                suggestedQuantity: qty,
                detectedSelector: selector,
                detectedFunctionName: functionName,
                requiresManualCalldata: false,
                paymentPrevalidated: false,
                paymentConfidence,
                mintPath: 'direct_nft',
            };
        }
        warnings.push(
            'Thirdweb page found but could not resolve Ethereum contract — try <code>thirdweb.com/ethereum/0x…</code> or paste the contract'
        );
    }

    const platformTarget = resolvePlatformContractFromUrl(candidate.target);
    if (
        platformTarget &&
        (candidate.type === 'manifold' || candidate.type === 'zora' || candidate.type === 'thirdweb')
    ) {
        const qty = config.defaultQuantity;
        let selector = '0xa0712d68';
        let functionName = 'mint(uint256)';
        let value = '0';
        let paymentConfidence: 'high' | 'medium' | 'low' = 'medium';
        if (provider) {
            try {
                const mintInfo = await detectMintInfo(
                    platformTarget.contract,
                    provider,
                    qty,
                    simulateFrom
                );
                if (mintInfo) {
                    selector = mintInfo.mintSelector;
                    functionName = mintInfo.mintFunctionName;
                    value = mintInfo.price > 0n ? '0x' + mintInfo.price.toString(16) : '0';
                    paymentConfidence = mintInfo.confidence;
                }
            } catch {
                warnings.push(`${platformTarget.platform}: on-chain price probe failed`);
            }
        }
        const calldata = encodeDirectMintCalldata(selector, qty);
        return {
            input: candidate.originalText,
            contractAddress: platformTarget.contract,
            executionTo: platformTarget.contract,
            chainSlug: platformTarget.chainSlug,
            platform: candidate.type,
            name: platformTarget.label,
            confidence: candidate.confidence,
            sourceUrl: candidate.target,
            warnings: [
                ...warnings,
                `${platformTarget.platform} contract resolved from URL`,
            ],
            suggestedCalldata: calldata,
            suggestedValue: value,
            suggestedQuantity: qty,
            detectedSelector: selector,
            detectedFunctionName: functionName,
            requiresManualCalldata: false,
            paymentPrevalidated: false,
            paymentConfidence,
            mintPath: 'direct_nft',
        };
    }

    // Use existing dropResolver
    const drop = await resolveDropTarget(candidate.target);
    if (!drop) {
        return null;
    }

    const coder = new AbiCoder();
    let selector = '0xa0712d68';
    let functionName = 'mint(uint256)';
    let value = '0';
    let quantity = config.defaultQuantity;
    let paymentConfidence: 'high' | 'medium' | 'low' = 'low';
    let executionTo = drop.contract;
    let seaDropPublicClosed = false;
    let seaDropStatus: ResolvedMintTarget['seaDropStatus'];

    const buildSeaDropResolvedTarget = (sea: ResolvedSeaDropMint): ResolvedMintTarget => {
        const isFcfsStyle = sea.phase === 'allowlist' || sea.phase === 'signed';
        return {
            input: candidate.originalText,
            contractAddress: sea.nftContract,
            executionTo: sea.to,
            chainSlug: drop.chainSlug || 'ethereum',
            platform: candidate.type === 'opensea' ? 'seadrop' : candidate.type,
            name: drop.label || drop.contract.slice(0, 10) + '...',
            confidence: 'high',
            sourceUrl: candidate.target,
            warnings: [...warnings, ...sea.warnings],
            suggestedCalldata: sea.data,
            suggestedValue: sea.value,
            suggestedQuantity: quantity,
            detectedSelector: sea.selector,
            detectedFunctionName: sea.functionName,
            requiresManualCalldata: false,
            paymentPrevalidated: false,
            paymentConfidence: 'high',
            mintPath: 'seadrop_router',
            seaDropNftContract: sea.nftContract,
            seaDropPhase: sea.phase,
            allowSimulationBypass: isFcfsStyle || sea.phase === 'public',
            suggestedGasTierId:
                isFcfsStyle || sea.phase === 'public'
                    ? process.env.LINK_MINT_GAS_TIER || 'fcfs_plus'
                    : process.env.LINK_MINT_GAS_TIER || 'normal',
        };
    };

    // SeaDrop — GTD/allowlist/public via OpenSea API, then on-chain public
    if (provider && simulateFrom) {
        try {
            const sea = await resolveSeaDropMint({
                nftContract: drop.contract,
                minter: simulateFrom,
                quantity,
                provider,
            });
            if (sea) {
                return buildSeaDropResolvedTarget(sea);
            }
            const hints = await getSeaDropPhaseHints(drop.contract, provider);
            seaDropStatus = {
                publicPhase: hints.publicPhase,
                summary: formatSeaDropStatusTelegram(hints, drop.contract),
                blockedReason: hints.blockedReason,
                hasOpenSeaSlug: hints.hasOpenSeaSlug,
            };
            if (!hints.publicActive) {
                seaDropPublicClosed = true;
            }
        } catch (e: unknown) {
            warnings.push(`⚠️ SeaDrop resolve: ${((e as Error).message || '').slice(0, 160)}`);
        }
    }

    // FCFS / direct NFT contract mint (e.g. freeMint when SeaDrop public is 0/wallet)
    if (provider && simulateFrom) {
        try {
            const recentDirect = await detectRecentDirectMintPattern(drop.contract, provider);
            if (recentDirect) {
                executionTo = drop.contract;
                selector = recentDirect.selector;
                functionName = recentDirect.functionName;
                paymentConfidence = 'high';
                warnings.push(
                    `Direct NFT mint: <code>${functionName}</code> (${recentDirect.sampleCount} recent tx(s) to contract)`
                );
                const calldata = encodeDirectMintCalldata(selector, quantity);
                return {
                    input: candidate.originalText,
                    contractAddress: drop.contract,
                    executionTo,
                    chainSlug: drop.chainSlug || 'ethereum',
                    platform: candidate.type,
                    name: drop.label || drop.contract.slice(0, 10) + '...',
                    confidence: candidate.confidence,
                    sourceUrl: candidate.target,
                    warnings,
                    suggestedCalldata: calldata,
                    suggestedValue: '0',
                    suggestedQuantity: quantity,
                    detectedSelector: selector,
                    detectedFunctionName: functionName,
                    requiresManualCalldata: false,
                    paymentPrevalidated: false,
                    paymentConfidence,
                    mintPath: 'direct_nft',
                    allowSimulationBypass: true,
                    suggestedGasTierId: process.env.LINK_MINT_GAS_TIER || 'fcfs_plus',
                };
            }
        } catch (e: unknown) {
            warnings.push(`⚠️ Direct mint detection failed: ${((e as Error).message || '').slice(0, 120)}`);
        }
    }

    if (seaDropPublicClosed) {
        warnings.push(`ℹ️ Trying direct NFT contract mint (e.g. <code>freeMint()</code>) if recent txs use it`);
    }

    // Reuse last successful automint simulation for this contract when available
    const cached = findCachedByContract(drop.contract);
    if (cached) {
        selector = cached.selector;
        functionName = `cached (${cached.selector})`;
        value = cached.value;
        quantity = cached.quantity;
        paymentConfidence = 'medium';
        if (isSeaDropPublicSelector(selector)) {
            executionTo = cached.targetAddress;
            warnings.push('Using SeaDrop calldata from recent whale mint (will re-simulate before send)');
        } else {
            warnings.push('Using calldata from recent tracked-wallet mint (will re-simulate before send)');
        }
    } else if (provider) {
        try {
            const mintInfo = await detectMintInfo(drop.contract, provider, quantity, simulateFrom);
            if (mintInfo) {
                selector = mintInfo.mintSelector;
                functionName = mintInfo.mintFunctionName;
                value = mintInfo.price > 0n ? '0x' + mintInfo.price.toString(16) : '0';
                paymentConfidence = mintInfo.confidence;

                if (mintInfo.isSoldOut) {
                    warnings.push('⚠️ Collection appears SOLD OUT');
                }
                if (mintInfo.confidence === 'low') {
                    warnings.push('Could not detect mint price — will try whale-style broadcast if you confirm');
                }
                if (mintInfo.totalSupply) {
                    warnings.push(`Supply: ${mintInfo.totalSupply}${mintInfo.maxSupply ? '/' + mintInfo.maxSupply : ''}`);
                }
                if (mintInfo.priceEth && parseFloat(mintInfo.priceEth) > 0) {
                    warnings.push(`Detected price: ${mintInfo.priceEth} ETH (via ${mintInfo.priceSource})`);
                }
            }
        } catch {
            warnings.push('On-chain price detection failed — will use copy-mint fallback path');
        }
    }

    if (seaDropPublicClosed && selector.toLowerCase() === '0xa0712d68') {
        selector = FREE_MINT_SELECTOR;
        functionName = 'freeMint()';
        warnings.push('Mint path: <code>freeMint()</code> on NFT contract (live txs use this, not SeaDrop).');
    }

    const calldata = encodeDirectMintCalldata(selector, quantity);

    if (selector.toLowerCase() === FREE_MINT_SELECTOR) {
        executionTo = drop.contract;
    }

    let mintPath: ResolvedMintTarget['mintPath'] = cached
        ? 'cached'
        : executionTo.toLowerCase() === drop.contract.toLowerCase() &&
            (selector.toLowerCase() === FREE_MINT_SELECTOR || selector === '0x1249c58b')
          ? 'direct_nft'
          : 'detected';

    const directFreeMint =
        mintPath === 'direct_nft' || selector.toLowerCase() === FREE_MINT_SELECTOR;
    const allowSimulationBypass = directFreeMint;
    const suggestedGasTierId = directFreeMint
        ? process.env.LINK_MINT_GAS_TIER || 'fcfs_plus'
        : process.env.LINK_MINT_GAS_TIER || 'normal';

    if (allowSimulationBypass) {
        warnings.push(
            'FCFS: simulation may revert on probe wallets — will still broadcast with competitive gas if you mint.'
        );
    }

    // Always re-run payment simulation at execution (never trust resolve-time probes alone)
    const paymentPrevalidated = false;

    return {
        input: candidate.originalText,
        contractAddress: drop.contract,
        executionTo,
        chainSlug: drop.chainSlug || 'ethereum',
        platform: candidate.type,
        name: drop.label || drop.contract.slice(0, 10) + '...',
        confidence: candidate.confidence,
        sourceUrl: candidate.target,
        warnings,
        suggestedCalldata: calldata,
        suggestedValue: value,
        suggestedQuantity: quantity,
        detectedSelector: selector,
        detectedFunctionName: functionName,
        requiresManualCalldata: candidate.confidence === 'low' && paymentConfidence === 'low' && !cached,
        paymentPrevalidated,
        paymentConfidence,
        mintPath,
        allowSimulationBypass,
        suggestedGasTierId,
        seaDropStatus,
    };
}

/**
 * Validate a resolved target against safety rules.
 */
export function validateMintTarget(target: ResolvedMintTarget, walletCount: number): { valid: boolean; errors: string[] } {
    const config = loadLinkMintConfig();
    const errors: string[] = [];

    // Check max mint ETH per wallet
    const valueEth = parseFloat(formatEther(target.suggestedValue || '0'));
    if (valueEth > config.maxMintEth) {
        errors.push(`Value ${valueEth} ETH exceeds MAX_MINT_ETH (${config.maxMintEth})`);
    }

    // Check total batch ETH
    const totalEth = valueEth * walletCount;
    if (totalEth > config.maxTotalBatchEth) {
        errors.push(`Total batch ${totalEth.toFixed(4)} ETH exceeds MAX_TOTAL_BATCH_ETH (${config.maxTotalBatchEth})`);
    }

    // Check if unknown and not allowed
    if (target.platform === 'unknown_url' && !config.allowUnknownLinkMint) {
        errors.push('Unknown platform — ALLOW_UNKNOWN_LINK_MINT is false');
    }

    if (
        config.linkMintDedupeEnabled &&
        shouldBlockLinkMintRetry(getLinkMintDedupeKey(target), config.dedupeTtlMs)
    ) {
        errors.push(
            'Duplicate target — link mint ran recently. Wait for cooldown, use /mint, or set LINK_MINT_DEDUPE_ENABLED=false'
        );
    }

    // Check requires manual calldata
    if (target.requiresManualCalldata && config.requireKnownSelector) {
        errors.push('Cannot determine mint calldata — use /mint <contract> <eth> <data> instead');
    }

    const seaDropBlock = seaDropInactiveBlocksLinkMint(target);
    if (seaDropBlock) {
        errors.push(seaDropBlock);
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Build a Telegram preview message for a resolved mint target.
 */
export function buildPreviewMessage(
    target: ResolvedMintTarget,
    walletCount: number,
    gasReport?: string
): string {
    const config = loadLinkMintConfig();
    const valueEth = formatEther(target.suggestedValue || '0');
    const totalEth = (parseFloat(valueEth) * walletCount).toFixed(4);

    let body = '';

    if (
        target.seaDropStatus &&
        target.seaDropStatus.publicPhase !== 'active' &&
        target.seaDropStatus.publicPhase !== 'no_drop' &&
        target.mintPath !== 'seadrop_router'
    ) {
        body += `⏸️ <b>SeaDrop phase</b>\n<i>${escapeHtml(target.seaDropStatus.summary)}</i>\n\n`;
    }

    body += uiRow('Platform', escapeHtml(target.platform)) + '\n';
    body += uiRow('Collection', `<code>${target.contractAddress}</code>`) + '\n';
    if (target.executionTo.toLowerCase() !== target.contractAddress.toLowerCase()) {
        body += uiRow('Router', `<code>${target.executionTo}</code>`) + '\n';
    }
    body += uiRow('Name', escapeHtml(target.name || 'Unknown')) + '\n';
    body += uiRow('Confidence', uiConfidenceBadge(target.confidence)) + '\n';
    body += uiRow('Quantity', `<b>${target.suggestedQuantity}</b>`) + '\n';
    body += uiRow('Per wallet', `<b>${valueEth}</b> ETH`) + '\n';
    body += uiRow('Fleet total', `<b>${totalEth}</b> ETH (${walletCount} wallets)`) + '\n';
    body +=
        uiRow('Function', `<code>${target.detectedSelector || '?'}</code>`) +
        ` <i>${escapeHtml(target.detectedFunctionName || 'unknown')}</i>`;

    if (gasReport) {
        body += `\n\n${gasReport}`;
    }

    if (target.warnings.length > 0) {
        body += `\n\n⚠️ <b>Notes</b>\n${target.warnings.map(w => `• ${escapeHtml(w)}`).join('\n')}`;
    }

    const mode = config.autoMintFromLinks
        ? 'Auto-execute'
        : config.confirmationRequired
          ? 'Confirmation required'
          : 'Preview only';

    return uiScreen({
        icon: '🎯',
        title: 'Mint target',
        body,
        footer: `<i>Mode: ${mode}</i>`,
    });
}

/** @deprecated Use recordLinkMintExecution — kept for callers */
export function markContractMinted(contract: string, calldata?: string): void {
    markLinkMintExecuted(linkMintDedupeKey(contract, calldata));
}
