/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty, no-dupe-else-if, @typescript-eslint/ban-ts-comment */
import { Telegraf, Markup, type Context } from 'telegraf';
import { JsonRpcProvider, FallbackProvider, formatEther, parseEther, ethers } from 'ethers';
import type { BotState, BlockMintJob } from './stateManager';
import { StateManager } from './stateManager';
import type { DetectedMint } from '../utils/trackerCore';
import { MintTracker } from '../utils/trackerCore';
import { buildTrackingAudit } from '../services/trackingAudit';
import {
    applyUserTrackingPrefs,
    formatPrefsSummary,
    getUserTrackingPrefs,
    getUsersForWhaleAlerts,
    getUsersForWhaleAutomint,
    TRACKING_PRESET_ALERTS_ONLY_PERSONAL,
    TRACKING_PRESET_ALL_SOURCES,
    TRACKING_PRESET_GLOBAL_AND_PERSONAL,
    TRACKING_PRESET_PERSONAL_ONLY,
    type UserTrackingPrefs,
    userAllowsAutomintPayment,
} from '../services/userTrackingPrefs';
import { log, logRateLimited } from '../utils/logger';
import { batchCopyTrade } from '../utils/mintCore';
import { InclusionRouter } from '../engine/inclusion/InclusionRouter';
import { BundleInclusionMonitor } from '../engine/inclusion/BundleInclusionMonitor';
import {
    inclusionModeFromState,
    inclusionModeLabel,
    inclusionModeShort,
    isBuilderMode,
    type InclusionMode,
} from '../utils/inclusionMode';
import { INCLUSION_MODES } from '../types/inclusion';
import {
    detectMintTargetFromMessage,
    loadLinkMintConfig,
    recordLinkMintExecution,
    resolveMintTarget,
    buildPreviewMessage,
    validateMintTarget,
    type ResolvedMintTarget,
} from '../services/linkMintService';
import { resolveDropTarget } from '../utils/dropResolver';
import { formatLinkMintFailureHint, isSimulationFailureMessage, shortLinkMintError } from '../utils/linkMintErrors';
import { waitWithTimeout, waitForTxReceipt } from '../utils/mintCore';
import { getBalances, splitGas, findHighestActiveWalletIndex } from '../utils/walletCore';
import { fetchNFTMetadata } from '../utils/nftMetadata';
import { checkProfitTarget, autoListTokens, autoAcceptOffers } from '../utils/profitCore';
import { sweepCollectionNfts } from '../utils/collectionSweep';
import { runTurboSweep } from '../services/sweepEth.js';
import { isDuplicateTelegramUpdate } from './telegramUpdateDedupe.js';
import {
    applyWalletLabels,
    getWalletDisplayName,
    getWalletLabelsForUser,
    setWalletLabel,
    trimWalletLabels,
} from '../utils/walletLabels';
import {
    getActiveHdIndices,
    getHdWalletCount,
    getStoredImportedCount,
    removeUserWallet,
} from '../utils/walletDeletion';
import {
    assertMintWalletAvailable,
    clearAllCompromisedWallets,
    compromisedEntryForPersistence,
    filterDistributeReceivers,
    filterWalletsForMint,
    formatCompromisedSummary,
    isDisplayIndexCompromised,
    listCompromisedDisplayIndices,
    markWalletCompromised,
    unmarkWalletCompromised,
    validateSweepDestination,
} from '../utils/compromisedWallets.js';
import {
    formatClearSeedInstructions,
    getBotMnemonic,
    purgeStoredSeed,
} from '../utils/seedStorage.js';
import { loadEnv } from '../config/env';
import { isKnownRouter } from '../config/constants';
import { requireAdmin, isAdmin } from './middleware/adminGuard';
import {
    getUserProvider as getCachedUserProvider,
    getDefaultProvider,
    measureLatency,
    getHealthStats,
    resolveRpcUrlList,
    resolveUserRpcUrlList,
    probeRpcEndpoints,
    probeWebSocketLatency,
    maskRpcHostname,
    measurePooledLatency,
    validateUserRpcUrl,
} from '../services/rpcPool';
import { normalizeUserRpcUrl } from '../services/rpcUrlUtils';
import { debouncedSave, flushSave } from '../services/stateDebouncer';
import {
    accessCodesMatch,
    grantUserUnlock,
    invalidateAllUnlocks,
    isUserRevoked,
    normalizeAccessCode,
    revokeUserAccess,
    userCanUseBot,
} from './accessGate';
import { tryAcquireExecutionLock, releaseExecutionLock, warmDedupeLedger } from '../services/deduplicator';
import { claimNotification, hashBroadcastMessage } from '../services/notificationLedger';
import { describeDiscordBroadcastTargets } from '../config/discordBroadcast';
import {
    broadcastToDiscordChannels,
    tryLoadDiscordBroadcastConfig,
} from '../services/discordBroadcastService';
import { CopyMintEngine } from '../engine/CopyMintEngine';
import { ExecutionQueue } from '../engine/ExecutionQueue';
import { DetectionEngine } from '../engine/DetectionEngine';
import { ExecutionReporter } from '../engine/ExecutionReporter';
import { getRuntimeConfig } from '../config/runtimeConfig';
import {
    checkBuilderEnvironment,
    formatBuilderDebugHtml,
    logBuilderStartupChecks,
} from '../services/builderEnvGuard';
import { getCachedMetadata, setCachedMetadata } from '../services/metadataCache';
import { registerLinkMintHandler } from './handlers/linkMintHandler';
import { registerBatchMintWizard, startBatchMintWizard } from './handlers/batchMintWizard';
import { confidenceMeetsMinimum } from '../services/mintClassifier';
import {
    classifyMintCandidate,
    mintCandidateFromDetectedMint,
} from '../services/mintIntentClassifier';
import { classifyCopiedReplayCandidate } from '../services/strategies/copiedReplayStrategy';
import { getOrchestratorDebug } from '../services/mintOrchestrator';
import { trackerDebugState } from '../services/trackerDebugState';
import { getDebugStats as getRpcBudgetDebug } from '../services/rpcBudgetManager';
import { getStats as getMessageDedupeStats } from '../services/messageDedupeStore';
import {
    configureNotificationSenders,
    isDiscordMirrorEnabled,
    notifyMintConfirmed,
    notifyWhaleAlertMirror,
} from '../services/notificationService';
import { getTrackerHttpUrl, resolveTrackerWsUrl } from '../config/rpcEndpoints';
import { getSingletonStatus, PROCESS_START_ID } from '../services/singletonGuards';
import { rewriteMintCalldataForWallet, rewriteMintCalldataQuantity } from '../services/calldataRewriter';
import {
    automintRequiresForceGasEstimate,
    decodeWhaleMintQuantity,
    mintIntentUnitPriceWei,
    resolveAutomintQuantityAcrossWallets,
    scaleMintValueWei,
} from '../services/copyMintQuantity';
import type { MintIntent } from '../types/mintIntent';
import { formatAutomintPlanContext } from '../contractMint/alertFormatter.js';
import {
    formatActiveScheduledDropsList,
    formatDropMintExplainText,
    registerDropMintHandlers,
    rearmPendingDropMints,
    type DropMintSchedulerDeps,
} from './handlers/dropMintScheduler.js';
import { registerDropMintWizard } from './handlers/dropMintWizard.js';
import { clearRpcLoad, formatRpcLoadStatus } from '../services/rpcLoadGuard.js';
import {
    filterWalletsForAutomint,
    markSuccessfulWalletMint,
} from '../services/successfulMintDedupe.js';
import { getContractMintConfig } from '../contractMint/config.js';
import {
    finalizeCopyMintCalldataForWallet,
    resolveCopyMintIntent,
} from '../contractMint/copyMintBridge.js';
import { registerContractMintHandler } from './handlers/contractMintHandler.js';
import { serializeEngineStatus, serializeExecutionResult } from '../utils/serializeEngine';
import {
    armBlockMint,
    cancelBlockMint,
    getActiveBlockMintJobs,
    parseBlockTarget,
    rearmBlockMints,
    resolveBlockMintCalldata,
    OEGP_CONTRACT,
    type BlockMintFireContext,
} from '../services/blockMintScheduler';
import {
    enrichMintedTokens,
    extractMintedTokensFromReceipt,
    formatCompactGlobalMintReport,
    formatUserMintSuccessDm,
    loadCollectionMeta,
    type MintedToken,
    type UserMintOutcome,
} from '../services/mintedNftReport';
import { buildWhaleAlertPayload } from '../services/whaleAlert';
import { formatTelegramUserLabel, type TelegramUserRef } from './telegramFormat';
import {
    executionsMenuKeyboard,
    executionsMenuText,
    mainMenuKeyboard,
    mainMenuText,
    emergencyMenuKeyboard,
    emergencyMenuText,
    mintCommanderKeyboard,
    mintCommanderText,
    rpcMenuAdminFooter,
    settingsMenuKeyboard,
    settingsMenuText,
    statusMenuKeyboard,
    statusMenuText,
    trackerMenuKeyboard,
    trackerMenuText,
    trackingPrefsMenuKeyboard,
    trackingPrefsMenuText,
    walletsMenuKeyboard,
    walletsMenuText,
} from './ui/telegramUi';
import {
    formatAutomintExecuting,
    formatAutomintFailed,
    formatAutomintNoSubmit,
    formatAutomintSubmitted,
    formatAutomintSkipped,
    formatDistributionComplete,
    formatDistributionProgress,
    formatMintExecutionSummary,
    formatUserAutomintResult,
    formatWalletFleetList,
    uiRow,
    uiScreen,
} from './ui/premiumMessages';
import { extractScatterSlug } from '../services/scatterMint';
import { findSeaDropPublicDrop } from '../services/seaDropBuilder';
import { getMempoolPendingStatus } from '../utils/mempoolPendingStatus';
import { buildCapacityStatus } from '../utils/capacityStatus';
import {
    effectiveSkipRpcPreflight,
    effectiveStreamBroadcast,
    syncCapacityOverridesFromState,
    toggleCapacityOverride,
    capacityOverridesForState,
} from '../config/capacityOverrides';
import {
    capacityHelpContent,
    capacityHelpKeyboard,
    capacityItemHelpKeyboard,
    capacityMenuKeyboard,
    capacityMenuText,
    parseCapacityHelpCallback,
    type CapacityHelpItem,
} from './ui/capacityMenu';
import {
    getGuideContent,
    getGuideKeyboard,
    parseGuideSection,
    type GuideSection,
} from './ui/guide';
import { resolveBroadcastAudience } from './broadcast';
import { buildVersionAnnounceMessage, getVersionChangelogBody } from './versionChangelog';
import express from 'express';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { apiPathRequiresAuth, safeCompare } from '../utils/apiAuth';
import {
    resolveBotRole,
    runsCopyMintServices,
    runsMintCommandServices,
    getServiceName,
} from '../shared/app/role.js';
import { resolveTelegramToken, resolveServicePort } from '../shared/app/telegramConfig.js';
import { createCommandGateMiddleware } from '../shared/app/commandGate.js';
import {
    createMintDashAccessMiddleware,
    hasCachedMintDashAccess,
    mintDashAccessRequired,
    refreshMintDashEntitlements,
    startMintDashEntitlementRefresh,
} from '../shared/app/mintDashAccess.js';
import { buildHealthJson, healthPathForRole, type HealthSnapshot } from '../shared/app/health.js';
import { registerTelegramCommandsForRole } from './registerTelegramCommands.js';

// Validate environment at boot — exits if required vars are missing.
const env = loadEnv();
const BOT_ROLE = resolveBotRole();
const SERVICE_NAME = getServiceName(BOT_ROLE);
logBuilderStartupChecks(checkBuilderEnvironment());

type AutomintConfLevel = 'high' | 'medium' | 'low';

function readAutomintMinConfidence(envName: string, fallback: AutomintConfLevel): AutomintConfLevel {
    const v = (process.env[envName] || '').toLowerCase().trim();
    if (v === 'high' || v === 'medium' || v === 'low') return v;
    return fallback;
}

function findFirstUidWithMintWallets(uids: string[]): string | undefined {
    for (const uid of uids) {
        if (getUserMintWallets(uid).length > 0) return uid;
    }
    return undefined;
}

/** Per-wallet calldata from whale tx (SeaDrop hijack or ABI recipient swap). */
function resolveAutomintCalldataForWallet(
    mint: DetectedMint,
    intent: MintIntent,
    walletAddress: string,
    quantity?: number
): string {
    const whaleQty = decodeWhaleMintQuantity(mint.data);
    let data =
        rewriteMintCalldataForWallet(mint.data, mint.from, walletAddress) ||
        rewriteMintCalldataForWallet(intent.calldata, mint.from, walletAddress) ||
        intent.calldata;
    if (quantity && quantity > 1 && quantity !== whaleQty) {
        const scaled = rewriteMintCalldataQuantity(data, quantity, whaleQty);
        if (scaled) data = scaled;
    }
    return data;
}

function logAutomintSkip(
    code: string,
    detail: string,
    mint: { hash: string; to?: string; from?: string }
): void {
    log(
        'info',
        `[AutoMint] SKIP code=${code} hash=${mint.hash.slice(0, 14)}… contract=${(mint.to || '').slice(0, 10)} whale=${(mint.from || '').slice(0, 10)} | ${detail}`
    );
}

const BOT_TOKEN = resolveTelegramToken(BOT_ROLE);
const PERSONAL_ID = env.PERSONAL_ID;
const GROUP_ID = env.GROUP_ID;
const API_SECRET = env.API_SECRET || '';

// ⬆️ Bump on release; add matching notes in src/bot/versionChangelog.ts
const BOT_VERSION = '3.5.31';

const AUTO_ACCEPT_OFFERS = /^(1|true|yes|on)$/i.test((process.env.AUTO_ACCEPT_OFFERS ?? '').trim());
const AUTO_ACCEPT_OFFERS_INTERVAL_MS = parseInt(process.env.AUTO_ACCEPT_OFFERS_INTERVAL_MS || '600000', 10);
const MIN_ACCEPT_OFFER_ETH = parseFloat(process.env.MIN_ACCEPT_OFFER_ETH || '0');

const TELEGRAM_MSG_MAX = 3900;

/** Webhook config — avoids Telegram 409 when Railway runs overlapping deploys. */
interface TelegramWebhookConfig {
    baseUrl: string;
    path: string;
    secret?: string;
}

function resolveTelegramWebhookConfig(): TelegramWebhookConfig | null {
    if (process.env.TELEGRAM_POLLING === 'true') return null;
    if (process.env.TELEGRAM_WEBHOOK_MODE === 'false') return null;

    const webhookRequested =
        process.env.TELEGRAM_WEBHOOK_MODE === 'true' ||
        Boolean(process.env.RAILWAY_ENVIRONMENT) ||
        Boolean(process.env.RAILWAY_PUBLIC_DOMAIN) ||
        process.env.NODE_ENV === 'production';

    if (!webhookRequested) return null;

    let host = process.env.WEBHOOK_DOMAIN?.trim() || process.env.RAILWAY_PUBLIC_DOMAIN?.trim() || '';
    host = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!host) return null;

    const hookPath = process.env.TELEGRAM_WEBHOOK_PATH || '/telegraf/webhook';
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || API_SECRET || undefined;

    return { baseUrl: `https://${host}`, path: hookPath, secret };
}

// Per-user command cooldown tracker (prevents command spam/flood)
const userCooldowns = new Map<string, number>();
function shortMintError(msg: string, max = 72): string {
    if (isSimulationFailureMessage(msg)) {
        return shortLinkMintError(formatLinkMintFailureHint(msg), max);
    }
    if (msg.length <= max) return msg;
    return msg.slice(0, max - 3) + '...';
}

function truncateTelegramHtml(msg: string, max = TELEGRAM_MSG_MAX): string {
    if (msg.length <= max) return msg;
    return msg.slice(0, max - 40) + '\n\n<i>…message truncated (too many wallets)</i>';
}

async function persistUserTrackingPrefs(userId: string, prefs: UserTrackingPrefs) {
    await StateManager.saveUser(userId, {
        followGlobal: prefs.alertGlobal && prefs.autoMintGlobal,
        trackingPrefs: { ...prefs },
    });
    await StateManager.save(state);
}

/** Compact status when hundreds of wallet lines would exceed Telegram limits. */
function summarizeMempoolLinks(mempoolLinks: string, maxLines = 12): string {
    if (!mempoolLinks || mempoolLinks.length <= 2800) return mempoolLinks;
    const lines = mempoolLinks.split('\n').filter(Boolean);
    const ok = lines.filter(l => l.includes('Etherscan')).length;
    const fail = lines.length - ok;
    const head = lines.slice(0, maxLines).join('\n');
    const tail = lines.length > maxLines ? `\n<i>…and ${lines.length - maxLines} more wallets</i>` : '';
    return `📊 <b>Batch summary</b>: ${ok} submitted / ${fail} failed (${lines.length} total)\n\n${head}${tail}`;
}

function mintReportBody(chatId: string, mempoolLinks: string, opts?: { isGlobal?: boolean; userCount?: number }): string {
    if (isGroupChatId(chatId)) {
        if (opts?.isGlobal) return `<i>${opts.userCount || 0} user(s) — per-wallet details sent via DM.</i>`;
        return `<i>Per-wallet tx links were sent to your DM.</i>`;
    }
    return summarizeMempoolLinks(mempoolLinks);
}

/** Per-wallet pending / error lines for confirmation monitors. */
function buildMempoolLinksFromResults(results: any[]): string {
    let links = '';
    results.forEach((res, i) => {
        const uid = (res as { uid?: string }).uid;
        if (res.status === 'fulfilled' && res.value?.hash) {
            links +=
                walletLine(uid, i, `<a href="https://etherscan.io/tx/${res.value.hash}">Etherscan</a> ⏳`) +
                '\n';
        } else {
            const err =
                (res as { reason?: { message?: string } }).reason?.message ||
                CopyMintEngine.getLastSkipReason() ||
                'Error';
            links += walletLine(uid, i, `❌ ${shortMintError(err)}`) + '\n';
        }
    });
    return links;
}

function listUserIdsWithMintWallets(): string[] {
    return Object.keys(state.userWallets).filter(
        uid => getUserMintWallets(uid).length > 0 && hasCachedMintDashAccess(uid)
    );
}

interface GlobalLinkMintBroadcastParams {
    chatId: number;
    progressMessageId: number;
    adminUserId: string;
    targetUids: string[];
    resolved: ResolvedMintTarget;
    txTo: string;
    calldata: string;
    value: string;
    linkOpts: Record<string, unknown>;
    config: ReturnType<typeof loadLinkMintConfig>;
    userRef: TelegramUserRef;
}

/** Runs in background so the Telegram webhook is not blocked for hundreds of users. */
async function runGlobalLinkMintBroadcast(params: GlobalLinkMintBroadcastParams): Promise<void> {
    const {
        chatId,
        progressMessageId,
        adminUserId,
        targetUids,
        resolved,
        txTo,
        calldata,
        value,
        linkOpts,
        config,
        userRef,
    } = params;
    const total = targetUids.length;
    const concurrency = Math.max(1, getRuntimeConfig().globalMintUserConcurrency);
    const progressEvery = Math.max(1, parseInt(process.env.GLOBAL_MINT_PROGRESS_EVERY || '12', 10));

    const allResults: any[] = [];
    let mempoolLinks = '';
    let done = 0;
    let submittedCount = 0;
    let lastProgressMs = 0;

    const updateProgress = async (force = false, overrideText?: string) => {
        const now = Date.now();
        if (!force && !overrideText && now - lastProgressMs < 4000 && done % progressEvery !== 0 && done < total) {
            return;
        }
        lastProgressMs = now;
        const text =
            overrideText ??
            `👑 <b>Global mint</b>\n` +
                `Contract: <code>${resolved.contractAddress}</code>\n` +
                `Progress: <b>${done}/${total}</b> users · <b>${submittedCount}</b> tx(s) submitted…`;
        await bot.telegram
            .editMessageText(chatId, progressMessageId, undefined, text, { parse_mode: 'HTML' })
            .catch(() => {});
    };

    try {
        await updateProgress(true);

        await ExecutionQueue.runWithConcurrency(targetUids, concurrency, async uid => {
            const wallets = getUserMintWallets(uid);
            if (wallets.length === 0) {
                done++;
                return;
            }
            const mintCheck = assertMintWalletAvailable(state, uid);
            if (!mintCheck.ok) {
                done++;
                return;
            }

            try {
                const userProvider = getUserProvider(uid);
                const userKeys = wallets.map(w => w.privateKey);
                const candidate = DetectionEngine.candidateFromManual({
                    to: txTo,
                    data: calldata,
                    value,
                });
                const engineResult = await CopyMintEngine.executeLinkMint({
                    provider: userProvider as any,
                    privateKeys: userKeys,
                    candidate,
                    paymentPlanValue: value,
                    options: mintOptionsForUser(uid, {
                        ...linkOpts,
                        skipClassification: true,
                        skipSimulation: true,
                        throttleSimulations: false,
                        paymentPrevalidated: Boolean(linkOpts.paymentPrevalidated),
                        forceGasEstimate: true,
                    }),
                });
                const results = engineResult.legacyResults;
                results.forEach((res: any) => {
                    (res as { uid?: string }).uid = uid;
                    allResults.push(res);
                });
                submittedCount += results.filter(
                    (r: { status: string; value?: unknown }) => r.status === 'fulfilled' && r.value
                ).length;
                if (mempoolLinks.length < 120_000) {
                    mempoolLinks += buildMempoolLinksFromResults(results);
                }
                if (results.length === 0 && engineResult.submittedCount === 0) {
                    const skip = CopyMintEngine.getLastSkipReason() || 'engine_skip';
                    if (mempoolLinks.length < 120_000) {
                        mempoolLinks += walletLine(uid, 0, `⚠️ ${shortMintError(skip)}`) + '\n';
                    }
                }
            } catch (err: any) {
                if (mempoolLinks.length < 120_000) {
                    mempoolLinks += `User <code>${uid}</code>: ❌ ${shortMintError(err.message || 'Error')}\n`;
                }
            } finally {
                done++;
                await updateProgress();
            }
        });

        recordLinkMintExecution(resolved);

        if (allResults.length === 0) {
            await updateProgress(
                true,
                `👑 <b>Global mint</b>\n\n⊘ No transactions submitted across <b>${total}</b> user fleets.\n` +
                    `<i>Check balances, eligibility, or /compromised.</i>`
            );
            return;
        }

        await updateProgress(
            true,
            `👑 <b>Global mint</b>\n` +
                `Submitted <b>${submittedCount}</b> tx(s) across <b>${total}</b> users.\n` +
                `<i>Waiting for confirmations…</i>`
        );

        const provider = getUserProvider(adminUserId) as JsonRpcProvider;
        const valueEth =
            typeof value === 'bigint' ? formatEther(value) : formatEther(BigInt(value || '0'));
        const originChatId = String(chatId);

        await runOwnerMintMonitor({
            ownerUserId: adminUserId,
            originChatId,
            results: allResults,
            mempoolLinks,
            title: '✅ <b>Global mint confirmed</b>',
            initHeading: '👑 <b>Global mint submitted</b>',
            initBody: mintReportBody(originChatId, mempoolLinks, {
                isGlobal: true,
                userCount: total,
            }),
            userRef,
            monitorCtx: {
                contractAddress: resolved.contractAddress,
                provider,
                valueEth,
                isGlobal: true,
            },
        });
    } catch (e: any) {
        const errText = shortMintError(e.message || 'Error').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        await bot.telegram
            .editMessageText(
                chatId,
                progressMessageId,
                undefined,
                `❌ <b>Global mint failed</b>\n<i>${errText}</i>\n\nCompleted <b>${done}/${total}</b> users.`,
                { parse_mode: 'HTML' }
            )
            .catch(() => {});
        console.error('[GlobalMint] broadcast failed:', e.message?.slice(0, 200));
    }
}

function buildLinkMintExecuteOptions(
    resolved: ResolvedMintTarget,
    config: ReturnType<typeof loadLinkMintConfig>,
    extra?: Record<string, unknown>
) {
    const scatterSlug =
        resolved.scatterSlug ||
        (resolved.mintPath === 'scatter_api'
            ? extractScatterSlug(resolved.sourceUrl || resolved.input)
            : undefined);
    const scatter = Boolean(scatterSlug);
    return {
        executionTo: resolved.executionTo,
        scatterSlug,
        seaDropNftContract: resolved.seaDropNftContract,
        maxMintLimit: config.maxMintEth.toString(),
        quantity: resolved.suggestedQuantity,
        paymentPrevalidated: resolved.paymentPrevalidated,
        paymentConfidence: resolved.paymentConfidence,
        simulationMode: config.simulationMode,
        allowUnknownPayment: scatter || Boolean(resolved.allowSimulationBypass),
        skipSimulation: scatter || config.simulationMode === 'fast',
        gasTierId: resolved.suggestedGasTierId || process.env.LINK_MINT_GAS_TIER || 'fcfs_plus',
        forceGasEstimate: true,
        ...extra,
    };
}

function isOnCooldown(userId: string, ms = 4000): boolean {
    const last = userCooldowns.get(userId) || 0;
    if (Date.now() - last < ms) return true;
    userCooldowns.set(userId, Date.now());
    return false;
}

const handlerTimeoutMs = parseInt(process.env.TELEGRAM_HANDLER_TIMEOUT_MS || '180000', 10);
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: handlerTimeoutMs,
});
bot.use(createCommandGateMiddleware(BOT_ROLE));
bot.use(createMintDashAccessMiddleware());
let state: BotState;
let tracker: MintTracker | null = null;

// Dashboard Memory Caches
const recentMints: any[] = [];
const recentCopyTrades: any[] = [];
let lastSkipReason: { hash: string; contract: string; reason: string; paymentMode: string; confidence: string; timestamp: number } | null = null;

const botAnalytics = {
    totalEthSpent: 0,
    projectedRevenue: 0,
    successfulTrades: 0,
    failedTrades: 0,
    profitHits: 0
};

// Helper to safely send telegram messages and auto-migrate group IDs
async function safeSendTelegram(chatId: string, msg: string, options?: any) {
    try {
        return await bot.telegram.sendMessage(chatId, msg, options);
    } catch (err: any) {
        if (err.response?.parameters?.migrate_to_chat_id) {
            const newChatId = err.response.parameters.migrate_to_chat_id.toString();
            console.log(`[Telegram] Chat migrated from ${chatId} to ${newChatId}. Updating state...`);
            if (state.alertChatId === chatId || (!state.alertChatId && chatId === GROUP_ID)) {
                state.alertChatId = newChatId;
                StateManager.save(state).catch(() => { });
            }
            return await bot.telegram.sendMessage(newChatId, msg, options);
        }
        throw err;
    }
}

configureNotificationSenders({
    telegram: async (chatId, text, opts) => {
        await safeSendTelegram(chatId, text, {
            parse_mode: opts.parseMode ?? 'HTML',
            link_preview_options: { is_disabled: opts.disablePreview ?? true },
        });
    },
});

/** Telegram group/supergroup chat IDs are negative. */
function isGroupChatId(chatId: string): boolean {
    return chatId.startsWith('-');
}

function isAdminUserId(userId: string | undefined): boolean {
    return !!userId && userId === PERSONAL_ID;
}

function getAlertDest(): string {
    return state.alertChatId || GROUP_ID;
}

function userLabelFromStored(userId: string, username?: string, firstName?: string): string {
    return formatTelegramUserLabel({ userId, username, firstName });
}

/** Non-admin mints in shared groups go to admin channel + owner DM only. */
function resolveMintReportRouting(ownerUserId: string, originChatId: string): {
    summaryChatId: string;
    postInOriginChat: boolean;
    originAck?: string;
} {
    const alertDest = getAlertDest();
    const isGroup = isGroupChatId(originChatId);

    if (isAdminUserId(ownerUserId)) {
        if (isGroup && alertDest && alertDest !== originChatId) {
            return { summaryChatId: alertDest, postInOriginChat: true };
        }
        return { summaryChatId: originChatId, postInOriginChat: true };
    }

    if (isGroup) {
        return {
            summaryChatId: alertDest,
            postInOriginChat: false,
            originAck:
                '🔒 <b>Mint started</b>\n<i>Full report sent to your DM and the admin channel only.</i>',
        };
    }

    return { summaryChatId: originChatId, postInOriginChat: true };
}

async function notifyAdminUserAction(actor: TelegramUserRef, body: string): Promise<void> {
    if (isAdminUserId(actor.userId)) return;
    const alertDest = getAlertDest();
    if (!alertDest) return;
    const label = formatTelegramUserLabel(actor);
    await safeSendTelegram(alertDest, `👤 ${label}\n${body}`, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
    }).catch(() => {});
}

async function sendTelegramAlert(
    chatId: string,
    text: string,
    opts?: { imageUrl?: string; parseMode?: 'HTML' }
): Promise<void> {
    const parse_mode = opts?.parseMode || 'HTML';
    const link_preview_options = { is_disabled: true as const };
    if (opts?.imageUrl?.startsWith('http')) {
        try {
            await bot.telegram.sendPhoto(chatId, opts.imageUrl, {
                caption: text,
                parse_mode,
            });
            return;
        } catch {
            /* fall through */
        }
    }
    await safeSendTelegram(chatId, text, { parse_mode, link_preview_options });
}

/** Owner mint report + optional admin-channel mirror (non-admin only). */
async function runOwnerMintMonitor(params: {
    ownerUserId: string;
    originChatId: string;
    originAck?: (ack: string) => Promise<void>;
    results: any[];
    mempoolLinks: string;
    title: string;
    initHeading: string;
    initBody: string;
    userRef: TelegramUserRef;
    monitorCtx: Omit<MonitorTxContext, 'mintOwnerUserId'>;
}): Promise<void> {
    const routing = resolveMintReportRouting(params.ownerUserId, params.originChatId);
    if (!routing.postInOriginChat && routing.originAck) {
        await params.originAck?.(routing.originAck);
    }

    const mintedByLabel = `Mint by ${formatTelegramUserLabel(params.userRef)}`;
    const monitorCtx: MonitorTxContext = {
        ...params.monitorCtx,
        mintOwnerUserId: params.ownerUserId,
        mintedByLabel,
    };

    const reportChat = routing.postInOriginChat ? params.originChatId : params.ownerUserId;
    const initMsg = await safeSendTelegram(
        reportChat,
        truncateTelegramHtml(`${params.initHeading}\nWaiting for confirmations...\n\n${params.initBody}`),
        { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    ).catch(() => null);

    await monitorTransactions(
        reportChat,
        params.results,
        params.title,
        params.mempoolLinks,
        initMsg?.message_id,
        monitorCtx
    );

    if (!isAdminUserId(params.ownerUserId)) {
        const alertDest = getAlertDest();
        if (alertDest && alertDest !== reportChat) {
            await monitorTransactions(alertDest, params.results, params.title, '', undefined, {
                ...monitorCtx,
                sendUserDms: false,
            });
        }
    }
}

/** Never post per-wallet Etherscan lines to a group — those go in user DMs only. */
function chatMempoolLinks(chatId: string, mempoolLinks: string): string {
    if (!mempoolLinks) return '';
    if (isGroupChatId(chatId)) {
        return '<i>Per-wallet transaction links were sent in each user\'s DM only.</i>';
    }
    return mempoolLinks;
}

interface MonitorTxContext {
    contractAddress?: string;
    provider?: JsonRpcProvider;
    collectionName?: string;
    collectionSymbol?: string;
    valueEth?: string;
    isGlobal?: boolean;
    /** When false, only update chatId — no per-user DMs (second pass for group summary). */
    sendUserDms?: boolean;
    /** Owner Telegram user id — used for admin summary attribution. */
    mintOwnerUserId?: string;
    mintedByLabel?: string;
}

async function sendUserMintReport(
    uid: string,
    outcome: UserMintOutcome,
    collection?: { name: string; symbol: string }
): Promise<void> {
    const txKey =
        outcome.tokens[0]?.txHash ||
        outcome.txLinks[0]?.match(/0x[a-fA-F0-9]{64}/)?.[0] ||
        `s${outcome.success}f${outcome.failed}`;
    const dmKey = `mintdm:${uid}:${txKey}`;
    if (!(await claimNotification(dmKey, 'mint_dm'))) return;

    const { text, imageUrl } = formatUserMintSuccessDm(outcome, collection);
    try {
        if (imageUrl && imageUrl.startsWith('http')) {
            await bot.telegram.sendPhoto(uid, imageUrl, {
                caption: text,
                parse_mode: 'HTML',
            });
            return;
        }
    } catch {
        /* fall through to text */
    }
    await safeSendTelegram(uid, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(
        () => {}
    );
}

/**
 * Monitors a batch of transactions, reports minted NFTs to users, compact summary to admin channel.
 */
async function monitorTransactions(
    chatId: string,
    results: any[],
    title: string,
    mempoolLinks: string,
    messageId?: number,
    ctx?: MonitorTxContext
) {
    let successCount = 0;
    let failCount = 0;
    let pendingCount = 0;
    const userStats: Record<string, UserMintOutcome> = {};
    const rawMinted: MintedToken[] = [];
    const promises: Promise<void>[] = [];
    const displayTitle = title || '✓ <b>Mint confirmation</b>';

    results.forEach(res => {
        const uid = (res as any).uid || 'unknown';
        if (!userStats[uid]) {
            userStats[uid] = { uid, success: 0, failed: 0, tokens: [], txLinks: [], errors: [] };
        }

        if (res.status === 'fulfilled' && res.value) {
            const tx = res.value;
            const p = (async () => {
                try {
                    let receipt: import('ethers').TransactionReceipt | null = null;
                    const reportProvider = ctx?.provider;
                    if (tx.hash && reportProvider && typeof tx.wait !== 'function') {
                        try {
                            await waitForTxReceipt(reportProvider, tx.hash, 1);
                        } catch (waitErr: any) {
                            const late = await reportProvider.getTransactionReceipt(tx.hash).catch(() => null);
                            if (late?.blockNumber != null) {
                                receipt = late;
                            } else if (waitErr?.message?.includes('timed out')) {
                                pendingCount++;
                                userStats[uid].errors.push('Still confirming on-chain…');
                                userStats[uid].txLinks.push(`https://etherscan.io/tx/${tx.hash}`);
                                return;
                            } else {
                                throw waitErr;
                            }
                        }
                        if (!receipt) {
                            receipt = await reportProvider.getTransactionReceipt(tx.hash);
                        }
                    } else if (typeof tx.wait === 'function') {
                        try {
                            receipt = await waitWithTimeout(tx, 1);
                        } catch (waitErr: any) {
                            if (waitErr?.message?.includes('timed out') && reportProvider && tx.hash) {
                                const late = await reportProvider.getTransactionReceipt(tx.hash).catch(() => null);
                                if (late?.blockNumber != null) {
                                    receipt = late;
                                } else {
                                    pendingCount++;
                                    userStats[uid].errors.push('Still confirming on-chain…');
                                    userStats[uid].txLinks.push(`https://etherscan.io/tx/${tx.hash}`);
                                    return;
                                }
                            } else {
                                throw waitErr;
                            }
                        }
                    }
                    if (receipt && receipt.status === 1) {
                        successCount++;
                        userStats[uid].success++;
                        userStats[uid].txLinks.push(`https://etherscan.io/tx/${tx.hash}`);

                        const walletFrom =
                            (typeof tx.from === 'string' && tx.from) ||
                            (typeof receipt.from === 'string' && receipt.from) ||
                            '';
                        if (ctx?.contractAddress && walletFrom.startsWith('0x')) {
                            markSuccessfulWalletMint(walletFrom, ctx.contractAddress);
                        }

                        const minted = extractMintedTokensFromReceipt(receipt as any, {
                            contractHint: ctx?.contractAddress,
                            recipientHint: tx.from?.toLowerCase(),
                        });
                        for (const m of minted) {
                            rawMinted.push({ ...m, name: undefined, imageUrl: undefined });
                        }
                    } else {
                        let revertMsg = 'Transaction Reverted';
                        try {
                            const txProvider = tx.provider || tx.wait?.provider;
                            if (txProvider && tx.to && tx.data) {
                                await txProvider.call({
                                    to: tx.to,
                                    data: tx.data,
                                    value: tx.value,
                                    from: tx.from,
                                    blockTag: receipt?.blockNumber,
                                });
                            }
                        } catch (revertErr: any) {
                            if (revertErr.reason) revertMsg = revertErr.reason;
                            else if (revertErr.revert?.args?.[0]) revertMsg = revertErr.revert.args[0];
                            else if (revertErr.message?.includes(':'))
                                revertMsg = revertErr.message.split(':').pop()?.trim() || revertMsg;
                        }
                        throw new Error(revertMsg);
                    }
                } catch (e: any) {
                    const errMsg = e.message || 'Execution Reverted';
                    if (errMsg.includes('timed out') && tx.hash) {
                        pendingCount++;
                        userStats[uid].txLinks.push(`https://etherscan.io/tx/${tx.hash}`);
                        userStats[uid].errors.push('Still confirming on-chain…');
                        return;
                    }
                    failCount++;
                    userStats[uid].failed++;
                    const cleanErr = errMsg.length > 60 ? errMsg.slice(0, 57) + '...' : errMsg;
                    userStats[uid].errors.push(cleanErr);
                }
            })();
            promises.push(p);
        } else {
            failCount++;
            userStats[uid].failed++;
            const rawErr = (res as any).reason?.message || 'Broadcast Failed';
            const cleanErr = rawErr.length > 60 ? rawErr.slice(0, 57) + '...' : rawErr;
            userStats[uid].errors.push(cleanErr);
        }
    });

    if (promises.length > 0) {
        await Promise.all(promises);
    }

    let collection = {
        name: ctx?.collectionName || 'Unknown',
        symbol: ctx?.collectionSymbol || 'Unknown',
    };
    const reportProvider = ctx?.provider;
    if (reportProvider && ctx?.contractAddress && collection.name === 'Unknown') {
        try {
            collection = await loadCollectionMeta(ctx.contractAddress, reportProvider);
        } catch {
            /* keep Unknown */
        }
    }

    let enrichedTokens: MintedToken[] = [];
    if (rawMinted.length > 0 && reportProvider) {
        enrichedTokens = await enrichMintedTokens(rawMinted, reportProvider);
        for (const outcome of Object.values(userStats)) {
            outcome.tokens = enrichedTokens.filter(t =>
                outcome.txLinks.some(l => l.includes(t.txHash))
            );
        }
    }

    const sendUserDms = ctx?.sendUserDms !== false;
    for (const [uid, outcome] of Object.entries(userStats)) {
        if (uid === 'unknown' || uid === GROUP_ID) continue;
        if (!sendUserDms) continue;
        // Private chat: final report is edited in-place — skip a second DM to the same user.
        if (chatId === uid) continue;
        if (outcome.success > 0 || outcome.failed > 0) {
            await sendUserMintReport(uid, outcome, collection);
        }
    }

    const participantCount = Object.keys(userStats).filter(uid => uid !== 'unknown').length;
    const walletTotal = results.length;
    const isGroup = isGroupChatId(chatId);

    let finalMsg: string;
    if (isGroup && ctx?.contractAddress) {
        finalMsg = formatCompactGlobalMintReport({
            collectionName: collection.name,
            collectionSymbol: collection.symbol,
            contract: ctx.contractAddress,
            successCount,
            failCount,
            walletTotal,
            participantCount,
            tokens: enrichedTokens,
            valueEth: ctx.valueEth,
            mintedByLabel: ctx.mintedByLabel,
        });
    } else {
        const linksForChat = chatMempoolLinks(chatId, mempoolLinks);
        finalMsg = truncateTelegramHtml(
            formatMintExecutionSummary({
                title: displayTitle,
                successCount,
                failCount,
                pendingCount,
                walletTotal,
                mempoolLinks: linksForChat,
            })
        );
    }

    if (ctx?.contractAddress && successCount > 0) {
        const sample = enrichedTokens[0];
        recentCopyTrades.unshift({
            timestamp: Date.now(),
            status: 'Success',
            target: ctx.contractAddress,
            hash: sample?.txHash || userStats[Object.keys(userStats)[0]]?.txLinks[0] || 'N/A',
            nftName: sample?.name,
            tokenId: sample?.tokenId,
        });
        if (recentCopyTrades.length > 50) recentCopyTrades.pop();
    }

    const groupPreviewOff = isGroup ? { is_disabled: true as const } : { is_disabled: false as const };
    const hasOutcome = successCount > 0 || failCount > 0 || results.length > 0;
    if (!hasOutcome) {
        finalMsg = truncateTelegramHtml(
            `${displayTitle}\n\n<i>No wallet results returned — check /execution or Etherscan.</i>`
        );
    }

    if (messageId) {
        const edited = await bot.telegram
            .editMessageText(chatId, messageId, undefined, finalMsg, {
                parse_mode: 'HTML',
                link_preview_options: groupPreviewOff,
            })
            .then(() => true)
            .catch(() => false);
        if (!edited) {
            await safeSendTelegram(chatId, finalMsg, {
                parse_mode: 'HTML',
                link_preview_options: groupPreviewOff,
            }).catch(() => {});
        }
    } else {
        await safeSendTelegram(chatId, finalMsg, {
            parse_mode: 'HTML',
            link_preview_options: groupPreviewOff,
        }).catch(() => {});
    }

    if (ctx?.contractAddress && (successCount > 0 || failCount > 0 || pendingCount > 0)) {
        const sampleTx =
            enrichedTokens[0]?.txHash ||
            userStats[Object.keys(userStats)[0]]?.txLinks[0]?.match(/0x[a-fA-F0-9]{64}/)?.[0];
        void notifyMintConfirmed({
            collectionName: collection.name,
            contract: ctx.contractAddress,
            successCount,
            failCount,
            pendingCount,
            walletTotal: results.length,
            sampleTxHash: sampleTx,
            mintedByLabel: ctx.mintedByLabel,
        }).catch(() => {});
    }

    return { successCount, failCount };
}

/**
 * Specialized helper to ensure user-specific data (RPCs, wallets) is persisted 
 * to the dedicated User collection, preventing race conditions.
 */
async function saveUserState(userId: string) {
    if (!userId) return;
    const walletCount = getHdWalletCount(state, userId);
    const compromised = compromisedEntryForPersistence(state, userId);
    await StateManager.saveUser(userId, {
        walletCount,
        hdWalletExcluded: state.userHdWalletExcluded?.[userId] ?? [],
        compromisedHd: compromised.compromisedHd,
        compromisedImported: compromised.compromisedImported,
        walletLabels: getWalletLabelsForUser(state, userId, walletCount),
        importedWallets: state.importedWallets ? state.importedWallets[userId] : [],
        rpcUrl: state.userRPCs ? state.userRPCs[userId] : null,
        unlocked: userCanUseBot(state, userId, PERSONAL_ID),
        trackedAddresses: state.userTrackedAddresses?.[userId],
        followGlobal: state.userFollowGlobal?.[userId],
    });
}

function walletLine(userId: string | undefined, index: number, suffix: string): string {
    return `${getWalletDisplayName(state, userId, index)}: ${suffix}`;
}

const TELEGRAM_USER_ID = /^\d+$/;

export interface BroadcastResult {
    sent: number;
    failed: number;
    userTargets: number;
    groupIncluded: boolean;
    failedUserIds: string[];
}

/**
 * Broadcast a message to all known bot users + the alert group.
 * Recipients = union(unlockedUsers, userWallets, chatMembers, MongoDB users).
 */
async function broadcastToAll(msg: string, options?: any): Promise<BroadcastResult> {
    const broadcastKey = `mass:${hashBroadcastMessage(msg)}`;
    const claimed = await claimNotification(broadcastKey, 'mass_broadcast');
    if (!claimed) {
        console.log(`[Broadcast] Skipped duplicate message (ledger key ${broadcastKey})`);
        return {
            sent: 0,
            failed: 0,
            userTargets: 0,
            groupIncluded: false,
            failedUserIds: [],
        };
    }

    const audience = await resolveBroadcastAudience(state);
    const targets = new Set<string>(audience.userIds);

    targets.add(PERSONAL_ID);

    const alertChat = state.alertChatId || GROUP_ID;
    const groupIncluded = Boolean(alertChat);
    if (alertChat) targets.add(alertChat);

    let sent = 0;
    let failed = 0;
    const failedUserIds: string[] = [];

    for (const chatId of targets) {
        try {
            await safeSendTelegram(chatId, msg, options);
            sent++;
        } catch (e) {
            failed++;
            if (TELEGRAM_USER_ID.test(chatId)) failedUserIds.push(chatId);
            log('warn', `[Broadcast] Failed chatId=${chatId}:`, (e as Error).message?.slice(0, 80));
        }
        await new Promise(r => setTimeout(r, 300));
    }

    console.log(
        `[Broadcast] users=${audience.counts.totalUsers} sent=${sent} failed=${failed} ` +
            `(unlocked=${audience.counts.fromUnlocked} wallets=${audience.counts.fromWallets} ` +
            `members=${audience.counts.fromChatMembers} db=${audience.counts.fromDatabase})`
    );

    return {
        sent,
        failed,
        userTargets: audience.counts.totalUsers,
        groupIncluded,
        failedUserIds,
    };
}

function getUserProvider(userId: string): ethers.Provider {
    const raw = state.userRPCs?.[userId]?.trim();
    const customUrl = raw ? normalizeUserRpcUrl(raw) : undefined;
    const hasAny =
        customUrl ||
        (process.env.PROVIDER_URL || '').trim() ||
        (state.providerUrl || '').trim();
    if (!hasAny) {
        throw new Error('No RPC provider URL configured. Please use /setrpc <url> to set your provider.');
    }
    return getCachedUserProvider(customUrl || null);
}

function appendImportedWallets(
    userId: string,
    wallets: { address: string; privateKey: string; balance: string }[]
): { address: string; privateKey: string; balance: string }[] {
    const seen = new Set(wallets.map(w => w.address.toLowerCase()));

    if (state.importedWallets?.[userId]) {
        for (const pk of state.importedWallets[userId]) {
            try {
                const extWallet = new ethers.Wallet(pk);
                const lower = extWallet.address.toLowerCase();
                if (seen.has(lower)) continue;
                seen.add(lower);
                wallets.push({ address: extWallet.address, privateKey: pk, balance: '0' });
            } catch {
                /* invalid pk */
            }
        }
    }

    if (process.env.IMPORTED_KEYS && userId === PERSONAL_ID) {
        for (const pk of process.env.IMPORTED_KEYS.split(',')) {
            try {
                const trimmed = pk.trim();
                if (!trimmed) continue;
                const extWallet = new ethers.Wallet(trimmed);
                const lower = extWallet.address.toLowerCase();
                if (seen.has(lower)) continue;
                seen.add(lower);
                wallets.push({ address: extWallet.address, privateKey: trimmed, balance: '0' });
            } catch (e) {
                console.error('Invalid IMPORTED_KEYS entry skipped:', (e as Error).message);
            }
        }
    }

    return wallets;
}

function getImportedWalletCount(userId: string): number {
    return state.importedWallets?.[userId]?.length ?? 0;
}

function getHdWalletKeyCount(userId: string): number {
    return getActiveHdIndices(state, userId).length;
}

function mintOptionsForUser(
    userId: string,
    extra: Record<string, unknown> = {}
): Record<string, unknown> {
    const adminBypass = isAdminUserId(userId);
    return {
        uid: userId,
        hdWalletKeyCount: getHdWalletKeyCount(userId),
        importedWalletCount: getImportedWalletCount(userId),
        maxMintLimit: state.maxMintLimit,
        gasBribeGwei: state.gasBribeGwei,
        inclusionMode: inclusionModeFromState(state),
        mevProtection: state.mevProtection,
        skipSimulation: state.skipSimulation,
        overdrive: state.overdrive,
        bypassWalletCap: adminBypass,
        ignoreInsufficientBalance: false,
        mirrorWhaleGas: true,
        ...extra,
    };
}

async function enrichCandidateWithWhaleGas(
    candidate: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasLimit?: bigint },
    provider: JsonRpcProvider,
    mint: Pick<DetectedMint, 'hash' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasLimit'>
): Promise<void> {
    if (mint.maxFeePerGas || mint.gasLimit) {
        if (mint.maxFeePerGas) candidate.maxFeePerGas = mint.maxFeePerGas;
        if (mint.maxPriorityFeePerGas) {
            candidate.maxPriorityFeePerGas = mint.maxPriorityFeePerGas;
        } else if (mint.maxFeePerGas) {
            candidate.maxPriorityFeePerGas = mint.maxFeePerGas / 10n;
        }
        if (mint.gasLimit) candidate.gasLimit = mint.gasLimit;
        return;
    }
    if (!mint.hash?.startsWith('0x')) return;
    try {
        const src = await provider.getTransaction(mint.hash);
        if (!src) return;
        if (src.maxFeePerGas) candidate.maxFeePerGas = src.maxFeePerGas;
        if (src.maxPriorityFeePerGas) {
            candidate.maxPriorityFeePerGas = src.maxPriorityFeePerGas;
        } else if (src.maxFeePerGas) {
            candidate.maxPriorityFeePerGas = src.maxFeePerGas / 10n;
        }
        if (src.gasLimit) candidate.gasLimit = src.gasLimit;
    } catch {
        /* optional — network gas still applies */
    }
}

function getUserWallets(userId: string): { address: string; privateKey: string; balance: string }[] {
    const count = getHdWalletCount(state, userId);
    const activeIndices = getActiveHdIndices(state, userId);

    const wallets: { address: string; privateKey: string; balance: string }[] = [];

    if (count > 0 && activeIndices.length > 0) {
        const mnemonic = getBotMnemonic();
        if (!mnemonic) {
            console.error('[getUserWallets] MNEMONIC env not set. Cannot derive HD wallets.');
        } else {
            try {
                const accountIndex = Number(BigInt(userId) % 2147483647n);
                const userBaseNode = ethers.HDNodeWallet.fromPhrase(mnemonic, '', `m/44'/60'/${accountIndex}'/0`);
                for (const i of activeIndices) {
                    const wallet = userBaseNode.deriveChild(i);
                    wallets.push({
                        address: wallet.address,
                        privateKey: wallet.privateKey,
                        balance: '0',
                    });
                }
            } catch (e: unknown) {
                console.error(
                    `[getUserWallets] HD derivation failed for user ${userId}:`,
                    (e as Error).message
                );
            }
        }
    }

    return appendImportedWallets(userId, wallets);
}

/** Active fleet minus wallets marked compromised (safe for mint / copy / drop). */
function getUserMintWallets(userId: string): { address: string; privateKey: string; balance: string }[] {
    return filterWalletsForMint(state, userId, getUserWallets(userId));
}


// Background Cron Worker for Profit Tracking
let profitInterval: NodeJS.Timeout | null = null;
let offerAcceptInterval: NodeJS.Timeout | null = null;

function startOfferAcceptCron() {
    if (!AUTO_ACCEPT_OFFERS) {
        console.log('[OfferCron] AUTO_ACCEPT_OFFERS disabled — skipping.');
        return;
    }
    if (offerAcceptInterval) clearInterval(offerAcceptInterval);

    offerAcceptInterval = setInterval(async () => {
        const allKeys: string[] = [];
        for (const uid of Object.keys(state.userWallets)) {
            getUserWallets(uid).forEach(w => allKeys.push(w.privateKey));
        }
        if (allKeys.length === 0) return;

        console.log(`[OfferCron] Scanning ${allKeys.length} wallets for qualifying offers (min ${MIN_ACCEPT_OFFER_ETH} ETH)...`);
        try {
            const results = await autoAcceptOffers(allKeys, {
                minOfferEth: MIN_ACCEPT_OFFER_ETH,
                providerUrl: state.providerUrl,
            });
            const accepted = results.filter(r => r.status === 'offer_accepted');
            if (accepted.length > 0) {
                const alertDest = state.alertChatId || GROUP_ID;
                const summary = accepted
                    .map(r => `✅ ${r.wallet.slice(0, 8)}… #${r.tokenId} @ ${r.priceEth} ETH`)
                    .join('\n');
                await safeSendTelegram(
                    alertDest,
                    `💰 <b>Auto-Accept Offers</b>\n${summary}`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
        } catch (err) {
            console.error('[OfferCron] run failed:', (err as Error).message);
        }
    }, AUTO_ACCEPT_OFFERS_INTERVAL_MS);

    console.log(`✅ Offer-Accept Cron started (every ${AUTO_ACCEPT_OFFERS_INTERVAL_MS / 1000}s)`);
}

function startProfitCron() {
    if (profitInterval) clearInterval(profitInterval);

    // Check every 5 minutes
    profitInterval = setInterval(async () => {
        if (!state.trackedCollections || state.trackedCollections.length === 0) return;

        console.log(`[ProfitCron] Checking ${state.trackedCollections.length} collections for profit targets...`);
        const hits = await checkProfitTarget(state.trackedCollections);

        for (const hit of hits) {
            const msg = `
📈 <b>PROFIT TARGET HIT!</b> 📈

🏦 <b>Contract:</b> <code>${hit.c.address}</code>
🎯 <b>Your Target:</b> ${hit.c.targetFloor} ETH
🔥 <b>Current Floor:</b> ${hit.currentFloor} ETH

<i>Executing Auto-List API on OpenSea via Reservoir...</i>
            `.trim();

            const alertDest = state.alertChatId || GROUP_ID;
            await safeSendTelegram(alertDest, msg, { parse_mode: 'HTML' }).catch(() => { });

            // Trigger the auto-sell module for everyone
            try {
                // Collect ALL private keys actively registered by Users
                const allKeys: string[] = [];
                for (const uid of Object.keys(state.userWallets)) {
                    const wallets = getUserWallets(uid);
                    wallets.forEach(w => allKeys.push(w.privateKey));
                }

                if (allKeys.length > 0) {
                    await safeSendTelegram(alertDest, `🔄 <b>Auto-Seller Started</b>\nScanning ${allKeys.length} sub-wallets to list any missing matching tokens to the floor price.`, { parse_mode: 'HTML' });
                    const results = await autoListTokens(allKeys, hit.c.address, hit.currentFloor, state.providerUrl);

                    if (results.length > 0) {
                        botAnalytics.profitHits += 1;
                        const totalValue = results.reduce((sum, r) => sum + parseFloat(r.price.toString()), 0);
                        botAnalytics.projectedRevenue += totalValue;

                        const summary = results.map(r => `🛒 Wallet ${r.wallet.slice(0, 6)}... listed Token #${r.tokenId} for ${r.price} ETH`).join('\n');
                        await safeSendTelegram(alertDest, `✅ <b>Auto-List Complete</b>\n\n${summary}`, { parse_mode: 'HTML' });
                    } else {
                        await safeSendTelegram(alertDest, `ℹ️ <b>Auto-List Skipped</b>\nI scanned ${allKeys.length} active wallets but none of them owned any NFTs for this collection.`, { parse_mode: 'HTML' });
                    }
                }
            } catch (sellErr: any) {
                console.error('Auto-sell triggered but failed execution:', sellErr.message);
            }

            // Remove it from the list avoiding constant spam every 5 minutes
            state.trackedCollections = state.trackedCollections.filter(c => c.address.toLowerCase() !== hit.c.address.toLowerCase());
            await StateManager.save(state).catch(() => { });
        }
    }, 5 * 60 * 1000); // 5 minutes

    console.log('✅ Profit Cron Worker started');
}

// HTTP Server for Render to bind to a port and Serve Dashboard
const app = express();
const PORT = resolveServicePort(BOT_ROLE, env.PORT);
const HEALTH_ONLY_MODE = process.env.BOT_RUNTIME_MODE?.trim().toLowerCase() === 'health-only';

// IMPORTANT: Parse JSON bodies BEFORE any POST route handlers
app.use(express.json());

app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

const apiRateBuckets = new Map<string, { count: number; resetAt: number }>();
const API_RATE_WINDOW_MS = 60_000;
const API_RATE_MAX = 60;
setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of apiRateBuckets) {
        if (bucket.resetAt <= now) apiRateBuckets.delete(ip);
    }
}, API_RATE_WINDOW_MS).unref?.();

function getApiClientIp(req: express.Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

app.use('/api', (req, res, next) => {
    const ip = getApiClientIp(req);
    const now = Date.now();
    let bucket = apiRateBuckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + API_RATE_WINDOW_MS };
        apiRateBuckets.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > API_RATE_MAX) {
        res.status(429).json({ error: 'Too Many Requests' });
        return;
    }
    next();
});

app.use((req, res, next) => {
    if (!HEALTH_ONLY_MODE || req.path === '/health' || req.path.startsWith('/health/')) {
        next();
        return;
    }
    res.status(503).json({
        ok: false,
        error: 'Service is staged in health-only mode.',
    });
});

const telegramWebhookConfig = HEALTH_ONLY_MODE ? null : resolveTelegramWebhookConfig();
if (telegramWebhookConfig) {
    app.use(
        bot.webhookCallback(telegramWebhookConfig.path, {
            secretToken: telegramWebhookConfig.secret,
        })
    );
    console.log(`[Telegram] Webhook listener on POST ${telegramWebhookConfig.path}`);
}

/** Telegram readiness for split-bot health JSON (`discord` field = legacy Railway alias). */
let telegramReady: 'ready' | 'not_ready' = 'not_ready';

function rpcHealthStatus(): HealthSnapshot['rpc'] {
    if (!state?.providerUrl) return 'missing';
    return 'connected';
}

function buildRoleHealthSnapshot(): HealthSnapshot {
    const trackerRunning = Boolean(tracker?.running);
    return {
        ok: true,
        service: SERVICE_NAME,
        version: BOT_VERSION,
        uptime: Math.floor(process.uptime()),
        discord: telegramReady,
        walletTracker:
            runsCopyMintServices(BOT_ROLE) && trackerRunning ? 'running' : 'stopped',
        rpc: rpcHealthStatus(),
        commands: 'loaded',
        role: BOT_ROLE,
        tracker: trackerRunning,
        mongo: StateManager.isConnected() ? 'connected' : 'disconnected',
        telegramMode: HEALTH_ONLY_MODE
            ? 'health-only'
            : telegramWebhookConfig
              ? 'webhook'
              : 'polling',
    };
}

function sendRoleHealth(res: express.Response, expectedRole: 'copy' | 'mint'): void {
    if (BOT_ROLE !== expectedRole && BOT_ROLE !== 'all') {
        res.status(404).json({
            ok: false,
            error: `This instance is ${SERVICE_NAME}, not ${expectedRole === 'copy' ? 'copy-mint-bot' : 'mint-command-bot'}`,
        });
        return;
    }
    const snapshot = buildRoleHealthSnapshot();
    snapshot.service = expectedRole === 'copy' ? 'copy-mint-bot' : 'mint-command-bot';
    res.json(buildHealthJson(snapshot));
}

app.get('/health/copy-mint', (_req, res) => sendRoleHealth(res, 'copy'));
app.get('/health/mint-command', (_req, res) => sendRoleHealth(res, 'mint'));

// Health endpoint — safe to expose publicly. No external dependencies so Railway healthcheck always passes when the bot is alive.
app.get('/health', (_req, res) => {
    if (BOT_ROLE === 'copy' || BOT_ROLE === 'mint') {
        res.json(buildHealthJson(buildRoleHealthSnapshot()));
        return;
    }

    const inclusion = InclusionRouter.getMetrics();
    res.json({
        status: 'ok',
        version: BOT_VERSION,
        uptime: Math.floor(process.uptime()),
        processStartId: PROCESS_START_ID,
        railwayReplicaId: process.env.RAILWAY_REPLICA_ID || null,
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT || null,
        service: SERVICE_NAME,
        role: BOT_ROLE,
        tracker: tracker?.running || false,
        rpc: state?.providerUrl ? 'configured' : 'missing',
        mongo: StateManager.isConnected() ? 'connected' : 'disconnected',
        telegramMode: telegramWebhookConfig ? 'webhook' : 'polling',
        webhookPath: telegramWebhookConfig?.path,
        inclusion: {
            mode: state ? inclusionModeFromState(state) : 'public',
            builderEnabled: process.env.BUILDER_MINT_ENABLED === 'true',
            bundlesSubmitted: inclusion.bundlesSubmitted,
            bundlesIncluded: inclusion.bundlesIncluded,
            publicBroadcasts: inclusion.publicBroadcasts,
            protectedBroadcasts: inclusion.protectedBroadcasts,
            pendingBundles: BundleInclusionMonitor.getPendingSummary(),
        },
    });
});

// Detailed health with RPC latency check (slower, may take ~1s)
app.get('/health/detailed', async (_req, res) => {
    const latency = await measureLatency().catch(() => -1);
    res.json({
        status: 'ok',
        version: BOT_VERSION,
        uptime: Math.floor(process.uptime()),
        tracker: tracker?.running || false,
        rpc: state?.providerUrl ? 'configured' : 'missing',
        rpcLatencyMs: latency,
        mongo: StateManager.isConnected() ? 'connected' : 'disconnected',
    });
});

// API Auth — dashboard GETs are public; /debug and /engine (GET+write) require X-API-Key when API_SECRET is set
app.use('/api', (req: any, res: any, next: any) => {
    if (!apiPathRequiresAuth(req.method, req.path)) return next();
    if (!API_SECRET) return next();
    const key = req.headers['x-api-key'];
    if (typeof key !== 'string' || !safeCompare(key, API_SECRET)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
});

// API Routes for React Dashboard
app.get('/api/status', (_req, res) => {
    if (!state) {
        return res.json({ isTracking: false, autoMint: false, totalUsers: 0, totalWallets: 0, trackedAddressesCount: 0, activeRPC: 'starting...' });
    }
    const totalUsers = Object.keys(state.userWallets).length;
    const totalWallets = Object.values(state.userWallets).reduce((acc, v) => acc + (typeof v === 'number' ? v : (Array.isArray(v) ? (v as any[]).length : 0)), 0);

    res.json({
        isTracking: tracker?.running || false,
        autoMint: state.autoMint,
        mevProtection: state.mevProtection,
        inclusionMode: inclusionModeFromState(state),
        skipSimulation: state.skipSimulation || false,
        gasBribeGwei: state.gasBribeGwei || '0',
        maxMintLimit: state.maxMintLimit || '0',
        activeRPC: state.providerUrl ? (() => { try { return new URL(state.providerUrl.split(',')[0]).hostname; } catch { return state.providerUrl.slice(0, 20); } })() : 'None',
        totalUsers,
        totalWallets,
        trackedAddressesCount: StateManager.getUnionOfTrackedAddresses(state).length,
        trackerWatchingCount: tracker?.getTrackedAddresses()?.length ?? 0,
    });
});

app.get('/api/mints', (_req, res) => {
    res.json(recentMints);
});

app.get('/api/trades', (_req, res) => {
    res.json(recentCopyTrades);
});

app.get('/api/analytics', (_req, res) => {
    res.json({
        ...botAnalytics,
        totalEthSpent: botAnalytics.totalEthSpent.toFixed(4),
        projectedRevenue: botAnalytics.projectedRevenue.toFixed(4),
        netProfit: (botAnalytics.projectedRevenue - botAnalytics.totalEthSpent).toFixed(4)
    });
});

app.get('/api/user/wallet-labels', (req, res) => {
    const userId = String(req.query.userId || '');
    if (!userId) return res.status(400).json({ error: 'userId query required' });
    const walletCount = typeof state.userWallets[userId] === 'number' ? state.userWallets[userId] : 0;
    res.json({
        userId,
        walletCount,
        labels: getWalletLabelsForUser(state, userId, walletCount),
    });
});

app.patch('/api/user/wallet-labels', async (req, res) => {
    const { userId, labels } = req.body || {};
    if (!userId || !Array.isArray(labels)) {
        return res.status(400).json({ error: 'userId and labels[] required' });
    }
    const walletCount = typeof state.userWallets[userId] === 'number' ? state.userWallets[userId] : 0;
    if (walletCount === 0) return res.status(404).json({ error: 'User has no wallets' });
    applyWalletLabels(state, userId, labels.slice(0, walletCount));
    await StateManager.save(state);
    await saveUserState(userId);
    res.json({
        success: true,
        userId,
        labels: getWalletLabelsForUser(state, userId, walletCount),
    });
});

app.get('/api/listing/status', (_req, res) => {
    res.json({
        profitCronActive: Boolean(profitInterval),
        offerAcceptCronActive: Boolean(offerAcceptInterval),
        autoAcceptOffers: AUTO_ACCEPT_OFFERS,
        minAcceptOfferEth: MIN_ACCEPT_OFFER_ETH,
        trackedCollections: (state.trackedCollections || []).map(c => ({
            address: c.address,
            targetFloor: c.targetFloor,
        })),
        profitHits: botAnalytics.profitHits,
        autoListEnabled: true,
        autoDelistEnabled: false,
    });
});

// Write API - Allows Dashboard interactivity
app.post('/api/config', async (req, res) => {
    const { key, value } = req.body;
    
    // Safety: Only allow mutating specific engine fields
    const allowed = ['autoMint', 'mevProtection', 'inclusionMode', 'skipSimulation', 'gasBribeGwei', 'maxMintLimit'];
    if (!allowed.includes(key)) return res.status(400).json({ error: 'Invalid config key' });

    (state as any)[key] = value;
    await StateManager.save(state);
    
    console.log(`[API] Config Updated: ${key} = ${value}`);
    res.json({ success: true, newState: (state as any)[key] });
});

app.post('/api/action/sweep', async (req, res) => {
    // Triggers a sweep for the admin user
    broadcastToAll(`📡 <b>Remote Command</b>: Dashboard triggered Global Sweep.`).catch(() => {});
    // Logic is handled via Telegram event simulation for simplicity or we could call sweepCore directly
    res.json({ success: true, message: 'Sweep initiated' });
});

app.post('/api/admin/clear-tracks', async (_req, res) => {
    if (!state) return res.status(503).json({ error: 'State not loaded' });
    const beforeUnion = StateManager.getUnionOfTrackedAddresses(state).length;
    if (beforeUnion === 0) {
        return res.json({ ok: true, beforeUnion: 0, message: 'No tracked wallets to clear' });
    }
    const result = await StateManager.clearAllTrackedAddresses(state);
    syncTracker();
    res.json({ ok: true, beforeUnion, ...result, trackerWatching: tracker?.getTrackedAddresses()?.length ?? 0 });
});

// Debug API endpoints
app.get('/api/debug/status', (_req, res) => {
    const stats = tracker?.getStats?.() || {};
    res.json({
        uptime: Math.floor(process.uptime()),
        autoMint: state?.autoMint || false,
        overdrive: state?.overdrive || false,
        trackerRunning: tracker?.running || false,
        trackerStats: stats,
        trackedCountGlobal: state?.trackedAddresses?.length || 0,
        trackedCountUnion: state ? StateManager.getUnionOfTrackedAddresses(state).length : 0,
        trackerWatching: tracker?.getTrackedAddresses()?.length ?? 0,
        mongoConnected: StateManager.isConnected(),
        pendingDetection: getRuntimeConfig().enablePendingDetection,
        mempoolPendingEffective: getMempoolPendingStatus(tracker).effective,
        blockFallback: process.env.ENABLE_BLOCK_FALLBACK !== 'false',
        trackerPermissive: process.env.TRACKER_PERMISSIVE_CLASSIFIER !== 'false',
        skipReceiptVerify: process.env.SKIP_CONFIRMED_RECEIPT_VERIFY !== 'false',
    });
});

app.get('/api/debug/tracker', (_req, res) => {
    if (!state) return res.status(503).json({ error: 'State not loaded' });
    const orch = getOrchestratorDebug();
    res.json({
        ...buildTrackingAudit(state, tracker),
        ...(tracker?.getStats?.() || {}),
        trackerDebug: trackerDebugState.get(),
        lastIntent: orch.lastIntent,
        enablePending: getRuntimeConfig().enablePendingDetection,
        mempoolPendingEffective: getMempoolPendingStatus(tracker).effective,
    });
});

app.get('/api/debug/tracking-audit', (_req, res) => {
    if (!state) return res.status(503).json({ error: 'State not loaded' });
    res.json(buildTrackingAudit(state, tracker));
});

app.post('/api/admin/resync-tracks', (_req, res) => {
    if (!state) return res.status(503).json({ error: 'State not loaded' });
    const sync = syncTracker();
    const audit = buildTrackingAudit(state, tracker);
    res.json({ ok: audit.ok, sync, audit });
});

app.get('/api/debug/config', (_req, res) => {
    res.json({
        BOT_TOKEN: process.env.BOT_TOKEN ? 'SET' : 'MISSING',
        PERSONAL_ID: process.env.PERSONAL_ID ? 'SET' : 'MISSING',
        PROVIDER_URL: process.env.PROVIDER_URL ? 'SET' : 'MISSING',
        TRACKER_RPC_URL: process.env.TRACKER_RPC_URL ? 'SET' : 'MISSING',
        EXECUTION_RPC_URL: process.env.EXECUTION_RPC_URL ? 'SET' : 'MISSING',
        WS_RPC_URL: process.env.WS_RPC_URL ? 'SET' : 'MISSING',
        MNEMONIC: process.env.MNEMONIC ? 'SET' : 'MISSING',
        MONGODB_URI: process.env.MONGODB_URI ? 'SET' : 'MISSING',
        ENABLE_PENDING_DETECTION: process.env.ENABLE_PENDING_DETECTION || 'false',
        GAS_MODE: process.env.GAS_MODE || 'normal',
        AUTO_MINT_FROM_LINKS: process.env.AUTO_MINT_FROM_LINKS || 'false',
        USE_COPY_MINT_ENGINE: process.env.USE_COPY_MINT_ENGINE !== 'false',
        BLIND_BROADCAST_ENABLED: process.env.BLIND_BROADCAST_ENABLED === 'true',
        SIMULATION_ENABLED: process.env.SIMULATION_ENABLED !== 'false',
    });
});

app.get('/api/debug/rpc', (_req, res) => {
    const rpc = getRpcBudgetDebug();
    const engine = CopyMintEngine.getStatus().rpcHealth;
    res.json({ ...rpc, engineRpcHealth: engine });
});

app.get('/api/debug/messages', (_req, res) => {
    res.json({
        ...getMessageDedupeStats(),
        processStartId: PROCESS_START_ID,
        singletons: getSingletonStatus(),
    });
});

app.get('/api/debug/execution', (_req, res) => {
    const orch = getOrchestratorDebug();
    const engine = CopyMintEngine.getStatus();
    res.json({
        lastIntent: orch.lastIntent,
        lastCandidate: orch.lastCandidate,
        lastSkipReason: orch.lastSkipReason,
        enginePaused: engine.paused,
        enginePanic: engine.panic,
        blindBroadcast: process.env.BLIND_BROADCAST_ENABLED === 'true',
        overdrive: state?.overdrive ?? false,
        simulation: state?.skipSimulation ? 'blind' : 'enabled',
    });
});

// Copy-mint engine API
app.get('/api/engine/status', (_req, res) => {
    res.json(serializeEngineStatus(CopyMintEngine.getStatus()));
});

app.get('/api/engine/lastmint', (_req, res) => {
    const s = CopyMintEngine.getStatus();
    res.json(s.lastCandidate || null);
});

app.get('/api/engine/lastexec', (_req, res) => {
    const s = CopyMintEngine.getStatus();
    res.json(s.lastExecution ? ExecutionReporter.toApiPayload(s.lastExecution) : null);
});

app.get('/api/engine/rpc', (_req, res) => {
    res.json({ health: CopyMintEngine.getStatus().rpcHealth, config: getRuntimeConfig().providerUrls.map(u => u.replace(/\/[^/]{8,}$/, '/***')) });
});

app.get('/api/engine/gas', (_req, res) => {
    const cfg = getRuntimeConfig();
    res.json({
        gasMode: cfg.gasMode,
        overdriveGas: cfg.overdriveGas,
        normalGasMultiplier: cfg.normalGasMultiplier,
        maxFeeGwei: cfg.maxFeeGwei,
        maxPriorityFeeGwei: cfg.maxPriorityFeeGwei,
        minWalletBufferEth: cfg.minWalletBufferEth,
    });
});

app.get('/api/engine/dedupe', (_req, res) => {
    res.json({ size: CopyMintEngine.getStatus().dedupeSize });
});

app.get('/api/engine/queue', (_req, res) => {
    const s = CopyMintEngine.getStatus();
    const blocked = s.paused || s.panic;
    res.json({
        depth: s.queueDepth,
        /** True when auto-mint cannot acquire the queue (soft pause or panic). */
        paused: blocked,
        softPaused: s.paused,
        panic: s.panic,
    });
});

app.get('/api/engine/config', (_req, res) => {
    const cfg = getRuntimeConfig();
    res.json({
        enablePendingDetection: cfg.enablePendingDetection,
        enableBlockFallback: cfg.enableBlockFallback,
        executionConcurrency: cfg.executionConcurrency,
        maxWalletsPerExecution: cfg.maxWalletsPerExecution,
        maxMintEth: cfg.maxMintEth,
        blindBroadcastEnabled: cfg.blindBroadcastEnabled,
        useCopyMintEngine: cfg.useCopyMintEngine,
    });
});

app.post('/api/engine/pause', (_req, res) => {
    CopyMintEngine.pause();
    res.json({ ok: true, paused: true });
});

app.post('/api/engine/resume', (_req, res) => {
    CopyMintEngine.resume();
    const s = CopyMintEngine.getStatus();
    res.json({ ok: true, paused: false, panic: s.panic, softPaused: s.paused });
});

app.post('/api/engine/panic', (_req, res) => {
    CopyMintEngine.panic();
    state.autoMint = false;
    if (tracker) { tracker.stop(); tracker = null; }
    res.json({ ok: true, panic: true });
});

// Serve frontend dashboard dynamically
const distPath = path.join(process.cwd(), 'public');
const isDistAvailable = fs.existsSync(distPath);

app.use(express.static(distPath));

// Catch-all to serve index.html for the Live Dashboard
app.get(/(.*)/, (_req, res) => {
    if (isDistAvailable) {
        res.sendFile(path.join(distPath, 'index.html'));
    } else {
        res.send('📡 Bot is running! Dashboard files missing in /public. Please ensure index.html, style.css, and script.js are in the public folder.');
    }
});

app.listen(PORT, () => {
    const healthPath = healthPathForRole(BOT_ROLE);
    console.log(
        `📡 ${SERVICE_NAME} HTTP listening on port ${PORT} (health: ${healthPath}, role=${BOT_ROLE})`
    );
});

/** Keep in-memory MintTracker aligned with global + per-user whale lists. */
let _syncTrackerRunning = false;

function syncTracker(): { added: number; removed: number; union: number; watching: number } {
    if (_syncTrackerRunning) {
        return { added: 0, removed: 0, union: 0, watching: tracker?.getTrackedAddresses().length ?? 0 };
    }
    _syncTrackerRunning = true;
    try {
    const hasRpc = Boolean((process.env.PROVIDER_URL || state.providerUrl || '').trim());
    const desired = StateManager.getUnionOfTrackedAddresses(state).map(a => a.toLowerCase());
    const desiredSet = new Set(desired);

    if (!tracker) {
        if (hasRpc) startTracker();
        return { added: desired.length, removed: 0, union: desired.length, watching: 0 };
    }

    if (!tracker.running && hasRpc && desired.length > 0) {
        log('warn', '[Tracker] Was stopped but whales are configured — restarting tracker');
        startTracker();
        return { added: 0, removed: 0, union: desired.length, watching: tracker?.getTrackedAddresses().length ?? 0 };
    }

    const current = new Set(tracker.getTrackedAddresses().map(a => a.toLowerCase()));
    let added = 0;
    let removed = 0;

    desiredSet.forEach(addr => {
        if (!current.has(addr)) {
            tracker!.addWallet(addr);
            added++;
        }
    });

    current.forEach(addr => {
        if (!desiredSet.has(addr)) {
            tracker!.removeWallet(addr);
            removed++;
        }
    });

    const watching = tracker.getTrackedAddresses().length;
    if (added > 0 || removed > 0) {
        log('info', `[Tracker] Sync +${added} -${removed} | union=${desired.length} watching=${watching}`);
    }

    const audit = buildTrackingAudit(state, tracker);
    if (audit.onlyInState.length > 0 || audit.onlyInTracker.length > 0) {
        logRateLimited(
            'tracker-drift',
            60_000,
            'warn',
            `[Tracker] Drift after sync: ${audit.onlyInState.length} only in state, ${audit.onlyInTracker.length} only in tracker`
        );
    }

    return { added, removed, union: desired.length, watching };
    } finally {
        _syncTrackerRunning = false;
    }
}

function startTracker() {
    if (tracker) tracker.stop();

    // Tracker HTTP polling uses TRACKER_RPC_URL (split budget) when set, else PROVIDER_URL.
    const httpUrl =
        getTrackerHttpUrl() ||
        (process.env.PROVIDER_URL || state.providerUrl || '')
            .split(',')[0]
            .trim()
            .replace(/^wss:\/\//, 'https://')
            .replace(/^ws:\/\//, 'http://');
    
    if (!httpUrl) {
        console.warn('[Tracker] No provider URL available. Tracker not started.');
        return;
    }

    tracker = new MintTracker(httpUrl, async (mint: DetectedMint) => {
        const txKey = mint.hash.toLowerCase();
        const alertClaimed = await claimNotification(`whale:alert:${txKey}`, 'whale');

        log(
            'info',
            `[Detection] 🐋 ${mint.hash.slice(0, 14)}… | ${mint.from.slice(0, 10)} → ${mint.to.slice(0, 10)} | ${mint.classificationConfidence} | ${mint.detectionPath} | autoMint=${state.autoMint}`
        );

        const alertDest = state.alertChatId || GROUP_ID;
        const whaleLower = mint.from.toLowerCase();
        const alertUids = getUsersForWhaleAlerts(state, whaleLower);
        const automintUids = getUsersForWhaleAutomint(state, whaleLower).filter(
            hasCachedMintDashAccess
        );

        try {
            const provider = getCachedUserProvider(null);

            const cachedMeta = getCachedMetadata(mint.to);
            const meta =
                cachedMeta ||
                ({ name: 'Unknown', symbol: '—', totalSupply: undefined } as {
                    name: string;
                    symbol: string;
                    totalSupply?: string;
                });
            if (!cachedMeta && mint.to) {
                void fetchNFTMetadata(mint.to, provider as any)
                    .then(fetched => {
                        if (fetched?.name && fetched.name !== 'Unknown') {
                            setCachedMetadata(mint.to, fetched);
                        }
                    })
                    .catch(() => {});
            }

            const willAutomint = Boolean(state.autoMint && mint.to && automintUids.length > 0);
            const automintClaimed =
                willAutomint && (await claimNotification(`whale:automint:${txKey}`, 'whale'));

            const runWhaleAutomint = async () => {
                let automintNote: string | undefined;
                let groupProgressMsgId: number | undefined;
                const perUserDmStats = new Map<
                    string,
                    { submitted: number; total: number; lines: string }
                >();

                const postAutomintStatus = async () => {
                    if (!automintNote) return;
                    await safeSendTelegram(alertDest, automintNote, {
                        parse_mode: 'HTML',
                        link_preview_options: { is_disabled: true },
                    }).catch(() => {});
                };

                const postPerUserDmResults = async () => {
                    for (const [uid, stat] of perUserDmStats) {
                        if (uid === alertDest) continue;
                        const dm = formatUserAutomintResult({
                            submitted: stat.submitted,
                            totalWallets: stat.total,
                            lines: summarizeMempoolLinks(stat.lines, 10),
                        });
                        await safeSendTelegram(uid, dm, {
                            parse_mode: 'HTML',
                            link_preview_options: { is_disabled: true },
                        }).catch(() => {});
                    }
                };

                const finishAutomint = async () => {
                    if (!automintNote) {
                        automintNote = formatAutomintFailed({
                            detail: 'Copy-mint ended without a status (check Railway logs or /debug_lastskip).',
                        });
                    }
                    await postAutomintStatus();
                    await postPerUserDmResults();
                };

                if (mint.to && !tryAcquireExecutionLock(mint.to, mint.hash)) {
                    logAutomintSkip('execution_lock', 'another run in progress for this contract', mint);
                    automintNote = formatAutomintSkipped({
                        reason: 'Execution lock',
                        detail: 'Another run is in progress for this contract.',
                    });
                    await finishAutomint();
                    return;
                }

                try {
                let mempoolLinks = '';
                let wallIndex = 1;
                const allResults: any[] = [];

                const whaleAddr = mint.from.toLowerCase();
                const targetUids = automintUids;

                if (targetUids.length === 0) {
                    logAutomintSkip('no_automint_users', `no users with automint for whale ${whaleAddr}`, mint);
                    automintNote = formatAutomintSkipped({
                        reason: 'No automint users',
                        detail: 'No users have automint enabled for this whale. Check /trackingprefs.',
                    });
                    return;
                }

                const classifyUid = findFirstUidWithMintWallets(targetUids);
                if (!classifyUid) {
                    logAutomintSkip(
                        'no_wallets',
                        'no safe mint wallets (check /wallets, /compromised, MNEMONIC env)',
                        mint
                    );
                    automintNote = formatAutomintSkipped({
                        reason: 'No wallets',
                        detail: 'Automint is on but no execution wallets are configured. Use /wallets.',
                    });
                    return;
                }

                const pendingMin = readAutomintMinConfidence('AUTOMINT_PENDING_MIN_CONFIDENCE', 'medium');
                const confirmedMin = readAutomintMinConfidence('AUTOMINT_CONFIRMED_MIN_CONFIDENCE', 'medium');
                const requiredConf =
                    mint.detectionPath === 'pending' ? pendingMin : confirmedMin;
                if (!confidenceMeetsMinimum(mint.classificationConfidence, requiredConf)) {
                    logAutomintSkip(
                        'low_confidence',
                        `classifier ${mint.classificationConfidence} < required ${requiredConf} (${mint.detectionPath})`,
                        mint
                    );
                    automintNote = formatAutomintSkipped({
                        reason: 'Low confidence',
                        detail: `Signal ${mint.classificationConfidence} below ${requiredConf} (${mint.detectionPath}).`,
                    });
                    return;
                }

                const chainId = parseInt(process.env.CHAIN_ID || '1', 10);
                const mintCandidate = mintCandidateFromDetectedMint(mint, chainId);
                const classifyWallets = getUserWallets(classifyUid);
                const classifyProvider = getUserProvider(classifyUid) as JsonRpcProvider;
                const classifyQty = decodeWhaleMintQuantity(mint.data);

                let mintIntent: MintIntent;
                let cmResult: Awaited<ReturnType<typeof resolveCopyMintIntent>>['pipeline'];

                try {
                    const resolved = await resolveCopyMintIntent(mint, {
                        chainId,
                        walletAddress: classifyWallets[0].address,
                        desiredQuantity: classifyQty,
                        provider: classifyProvider,
                    });
                    mintIntent = resolved.intent;
                    cmResult = resolved.pipeline;
                } catch (intentErr: any) {
                    logAutomintSkip(
                        'intent_classify_error',
                        intentErr.message?.slice(0, 120) || 'classification threw',
                        mint
                    );
                    automintNote = formatAutomintSkipped({
                        reason: 'Classification error',
                        detail: 'Could not classify mint route.',
                    });
                    return;
                }

                if (!mintIntent.canAutoExecute) {
                    if (getContractMintConfig().contractMintEnabled && cmResult?.plan) {
                        automintNote = formatAutomintSkipped({
                            reason: 'Contract mint blocked',
                            detail: cmResult.plan.skipReason || cmResult.plan.reason,
                        });
                        logAutomintSkip(
                            'contract_mint_blocked',
                            cmResult.plan.skipReason || cmResult.plan.reason,
                            mint
                        );
                        return;
                    }
                    const forcedReplay = classifyCopiedReplayCandidate(
                        mintCandidate,
                        {
                            chainId,
                            walletAddress: classifyWallets[0].address,
                            desiredQuantity: classifyQty,
                            provider: classifyProvider,
                        },
                        { forceAutomint: true }
                    );
                    if (forcedReplay?.canAutoExecute) {
                        mintIntent = forcedReplay;
                        log(
                            'info',
                            `[AutoMint] forced copied_replay route=${mintIntent.routeType} hash=${mint.hash.slice(0, 14)}…`
                        );
                    }
                }

                if (!mintIntent.canAutoExecute) {
                    logAutomintSkip(
                        'route_blocked',
                        `route=${mintIntent.routeType} reason=${mintIntent.reason}`,
                        mint
                    );
                    automintNote = formatAutomintSkipped({
                        reason: 'Route blocked',
                        route: mintIntent.routeType,
                        detail: mintIntent.reason,
                    });
                    lastSkipReason = {
                        hash: mint.hash,
                        contract: mintIntent.targetContract || mint.to || '',
                        reason: `${mintIntent.routeType}: ${mintIntent.reason}`,
                        paymentMode: mintIntent.mintType,
                        confidence: mintIntent.confidence,
                        timestamp: Date.now(),
                    };
                    return;
                }

                // Trust intent value for automint — avoid double simulation blocking execution.
                let selectedValue = mintIntent.totalValueWei || mint.value;
                log(
                    'info',
                    `[AutoMint] EXEC route=${mintIntent.routeType} value=${formatEther(selectedValue)} ETH wallets=${targetUids.length}`
                );

                const groupInit = formatAutomintExecuting({
                    contract: mint.to || mintIntent.targetContract || '',
                    participants: targetUids.length,
                    route: mintIntent.routeType,
                    qty: mintIntent.quantity,
                });
                const initMsgPromise = safeSendTelegram(alertDest, groupInit, {
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: true },
                }).catch(() => null);

                const seaDropNftForExec =
                    mintIntent.routeType === 'seadrop_allowlist' ||
                    mintIntent.routeType === 'seadrop_signed'
                        ? mintIntent.targetContract
                        : undefined;
                const seaDropPublicFastPath = mintIntent.routeType === 'seadrop_public';

                const whaleGasSnapshot: {
                    maxFeePerGas?: bigint;
                    maxPriorityFeePerGas?: bigint;
                    gasLimit?: bigint;
                } = {};
                await enrichCandidateWithWhaleGas(whaleGasSnapshot, classifyProvider, mint);

                let whaleSeaDropPublicDrop: Awaited<ReturnType<typeof findSeaDropPublicDrop>> | undefined;
                if (seaDropPublicFastPath && mintIntent.targetContract) {
                    whaleSeaDropPublicDrop = await findSeaDropPublicDrop(
                        mintIntent.targetContract,
                        classifyProvider
                    );
                }

                let usersWithZeroMintWallets = 0;
                const automintDedupeContract = (
                    mintIntent.targetContract ||
                    mint.to ||
                    ''
                ).toLowerCase();

                const runUserMint = async (uid: string) => {
                    const mintWalletsAll = getUserMintWallets(uid);
                    const wallets = automintDedupeContract.startsWith('0x')
                        ? filterWalletsForAutomint(mintWalletsAll, automintDedupeContract)
                        : mintWalletsAll;
                    if (wallets.length === 0) {
                        if (mintWalletsAll.length > 0) {
                            logAutomintSkip(
                                'success_dedupe',
                                `uid=${uid.slice(0, 6)} all wallets already minted this contract`,
                                mint
                            );
                        } else {
                            usersWithZeroMintWallets++;
                            logAutomintSkip(
                                'no_mint_wallets',
                                `uid=${uid.slice(0, 6)} all wallets excluded or none configured`,
                                mint
                            );
                        }
                        return;
                    }
                    if (wallets.length < mintWalletsAll.length) {
                        log(
                            'info',
                            `[AutoMint] uid=${uid.slice(0, 6)} skipping ${mintWalletsAll.length - wallets.length} wallet(s) — already minted ${automintDedupeContract.slice(0, 10)}…`
                        );
                    }

                    const uidPrefs = getUserTrackingPrefs(state, uid);
                    if (!userAllowsAutomintPayment(mintIntent.mintType, uidPrefs.copyMintPaymentFilter)) {
                        logAutomintSkip(
                            'payment_filter',
                            `uid=${uid.slice(0, 6)} filter=${uidPrefs.copyMintPaymentFilter} mintType=${mintIntent.mintType}`,
                            mint
                        );
                        return;
                    }

                    try {
                        const userProvider = getUserProvider(uid);
                        const userKeys = wallets.map(w => w.privateKey);

                        const walletAddresses = wallets.map(w => w.address);
                        const { maxQty: mintQty, leadWalletAddress } =
                            await resolveAutomintQuantityAcrossWallets({
                                provider: userProvider as JsonRpcProvider,
                                walletAddresses,
                                mintIntent,
                                whaleTxData: mint.data,
                                seaDropPublicDrop: whaleSeaDropPublicDrop,
                            });
                        if (mintQty < 1 || !leadWalletAddress) {
                            logAutomintSkip(
                                'wallet_mint_cap',
                                `uid=${uid.slice(0, 6)} no remaining mints on any wallet`,
                                mint
                            );
                            return;
                        }

                        const unitWei = mintIntentUnitPriceWei(mintIntent);
                        const paymentValue = scaleMintValueWei(unitWei, mintQty);

                        const candidate = DetectionEngine.candidateFromTracker(mint);
                        if (whaleGasSnapshot.maxFeePerGas) {
                            candidate.maxFeePerGas = whaleGasSnapshot.maxFeePerGas;
                        }
                        if (whaleGasSnapshot.maxPriorityFeePerGas) {
                            candidate.maxPriorityFeePerGas = whaleGasSnapshot.maxPriorityFeePerGas;
                        }
                        if (whaleGasSnapshot.gasLimit) {
                            candidate.gasLimit = whaleGasSnapshot.gasLimit;
                        }
                        candidate.to = mintIntent.executionTo;
                        candidate.data =
                            cmResult?.plan && cmResult.detected
                                ? await finalizeCopyMintCalldataForWallet({
                                      plan: cmResult.plan,
                                      detected: cmResult.detected,
                                      whaleAddress: mint.from,
                                      walletAddress: leadWalletAddress,
                                      provider: userProvider as JsonRpcProvider,
                                      whaleTxData: mint.data,
                                  })
                                : resolveAutomintCalldataForWallet(
                                      mint,
                                      mintIntent,
                                      leadWalletAddress,
                                      mintQty
                                  );
                        candidate.value = paymentValue;
                        const whaleQty = decodeWhaleMintQuantity(mint.data);
                        const engineResult = await CopyMintEngine.execute({
                            triggerType: 'automint',
                            provider: userProvider as any,
                            privateKeys: userKeys,
                            candidate,
                            paymentPlanValue: paymentValue,
                            options: mintOptionsForUser(uid, {
                                whaleAddress: mint.from,
                                allowUnknownPayment: true,
                                skipClassification: true,
                                skipSimulation: true,
                                paymentPrevalidated: true,
                                seaDropNftContract: seaDropPublicFastPath
                                    ? mintIntent.targetContract
                                    : seaDropNftForExec,
                                skipSeaDropRebuild: seaDropPublicFastPath,
                                whaleTxData: mint.data,
                                forceGasEstimate: automintRequiresForceGasEstimate({
                                    seaDropNftContract: seaDropPublicFastPath
                                        ? undefined
                                        : seaDropNftForExec,
                                    skipSeaDropRebuild: seaDropPublicFastPath,
                                    routeType: mintIntent.routeType,
                                    mintQty,
                                    whaleQty,
                                }),
                                quantity: mintQty,
                            }),
                        });
                        const results = engineResult.legacyResults;

                        if (results.length === 0 && engineResult.submittedCount === 0) {
                            const skipReason = CopyMintEngine.getLastSkipReason() || 'engine_skip';
                            logAutomintSkip(
                                'engine_skip',
                                `uid=${uid.slice(0, 6)} reason=${skipReason} submitted=${engineResult.submittedCount}`,
                                mint
                            );
                        }

                        let uidSubmitted = 0;
                        let uidLines = '';
                        results.forEach((res, i) => {
                            wallIndex++;
                            (res as any).uid = uid;
                            allResults.push(res);
                            if (res.status === 'fulfilled' && res.value) {
                                const txHash = (res.value as any).hash;
                                const line =
                                    walletLine(uid, i, `<a href="https://etherscan.io/tx/${txHash}">Etherscan</a> ⏳`) +
                                    '\n';
                                mempoolLinks += line;
                                uidLines += line;
                                uidSubmitted++;
                            } else {
                                const reason = (res as any).reason?.message || 'Error';
                                const line =
                                    walletLine(uid, i, `❌ ${reason.slice(0, 20)}...`) + '\n';
                                mempoolLinks += line;
                                uidLines += line;
                            }
                        });
                        perUserDmStats.set(uid, {
                            submitted: uidSubmitted,
                            total: wallets.length,
                            lines: uidLines,
                        });
                    } catch (err: any) {
                        console.error(`[AutoMint] uid=${uid.slice(0, 6)} failed:`, err.message?.slice(0, 120));
                        perUserDmStats.set(uid, {
                            submitted: 0,
                            total: wallets.length,
                            lines: walletLine(uid, 0, `❌ ${(err.message || 'Error').slice(0, 40)}`) + '\n',
                        });
                    }
                };

                const automintUserConcurrency = getRuntimeConfig().automintUserConcurrency;
                await ExecutionQueue.runWithConcurrency(
                    targetUids,
                    automintUserConcurrency,
                    runUserMint
                );

                const initMsg = await initMsgPromise;
                groupProgressMsgId = initMsg?.message_id;

                const submitted = allResults.filter(
                    r => r.status === 'fulfilled' && r.value
                ).length;
                const planCtx = cmResult ? formatAutomintPlanContext(cmResult) : '';
                if (submitted > 0) {
                    automintNote = formatAutomintSubmitted({
                        submitted,
                        route: mintIntent.routeType,
                        planContext: planCtx || undefined,
                        walletLines: summarizeMempoolLinks(mempoolLinks, 8),
                    });
                } else {
                    const engineSkip = CopyMintEngine.getLastSkipReason() || 'all_wallets_skipped';
                    const compromisedHint =
                        usersWithZeroMintWallets > 0
                            ? ` · ${usersWithZeroMintWallets} user(s) had no safe wallets (see /compromised)`
                            : '';
                    automintNote = formatAutomintNoSubmit({
                        route: mintIntent.routeType,
                        engineReason: engineSkip + compromisedHint,
                        planContext: planCtx || undefined,
                    });
                    logAutomintSkip('no_submissions', engineSkip + compromisedHint, mint);
                }

                const confirmContract =
                    mintIntent.targetContract || seaDropNftForExec || mint.to;
                void monitorTransactions(
                    alertDest,
                    allResults,
                    '✓ <b>Copy-mint confirmed</b>',
                    summarizeMempoolLinks(mempoolLinks, 12),
                    groupProgressMsgId,
                    {
                        contractAddress: confirmContract,
                        provider: provider as JsonRpcProvider,
                        valueEth: formatEther(selectedValue || mint.value),
                        isGlobal: true,
                    }
                )
                    .then(finalStats => {
                        botAnalytics.successfulTrades += finalStats.successCount;
                        botAnalytics.failedTrades += finalStats.failCount;
                        botAnalytics.totalEthSpent +=
                            finalStats.successCount *
                            parseFloat(formatEther(selectedValue || mint.value));
                    })
                    .catch(err =>
                        console.error(
                            '[AutoMint] confirmation monitor failed:',
                            (err as Error).message?.slice(0, 120)
                        )
                    );
                } catch (automintErr: any) {
                    console.error(
                        '[AutoMint] run failed:',
                        automintErr?.message?.slice(0, 200) || automintErr
                    );
                    automintNote = formatAutomintFailed({
                        detail: automintErr?.message?.slice(0, 200) || 'Unexpected automint error',
                    });
                } finally {
                    if (mint.to) releaseExecutionLock(mint.to, mint.hash);
                    await finishAutomint();
                }
            };

            const reportAutomintCrash = async (err: unknown) => {
                console.error('[AutoMint] background run failed:', (err as Error).message?.slice(0, 160));
                await safeSendTelegram(
                    alertDest,
                    formatAutomintFailed({
                        detail: (err as Error).message?.slice(0, 200) || 'Background automint crashed',
                    }),
                    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
                ).catch(() => {});
            };

            if (automintClaimed && env.AUTO_EXECUTE_BEFORE_METADATA) {
                void runWhaleAutomint().catch(reportAutomintCrash);
            } else if (willAutomint && !automintClaimed) {
                log(
                    'info',
                    `[AutoMint] SKIP duplicate automint claim for ${mint.hash.slice(0, 14)}… (alerts may still send)`
                );
            }

            const whalePayload = await buildWhaleAlertPayload(mint, provider as JsonRpcProvider, {
                meta,
                skipImage: automintClaimed && env.AUTO_EXECUTE_BEFORE_METADATA,
            });
            if (automintClaimed) {
                whalePayload.text +=
                    `\n\n<i>⚡ Copy-mint started for <b>${automintUids.length}</b> user(s) — status update follows.</i>`;
            } else if (willAutomint && !automintClaimed) {
                whalePayload.text +=
                    `\n\n<i>ℹ️ Copy-mint skipped — this whale tx was already processed (ledger).</i>`;
            }

            const safeName = meta.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            recentMints.unshift({
                timestamp: Date.now(),
                project: safeName,
                supply: meta.totalSupply || 'Unknown',
                value: formatEther(mint.value),
                from: mint.from,
                to: mint.to,
            });
            if (recentMints.length > 50) recentMints.pop();

            if (alertClaimed) {
                await sendTelegramAlert(alertDest, whalePayload.text, { imageUrl: whalePayload.imageUrl }).catch(
                    () => {}
                );
                void notifyWhaleAlertMirror({
                    txHash: mint.hash,
                    html: whalePayload.text,
                }).catch(() => {});
            } else {
                log('info', `[Whale] Suppressed duplicate group alert for ${mint.hash.slice(0, 14)}…`);
            }

            const dmMessage = `📥 <b>Whale Alert</b>\n${whalePayload.text}`;
            for (const uid of alertUids) {
                if (uid === alertDest) continue;
                void (async () => {
                    if (!(await claimNotification(`whale-dm:${uid}:${mint.hash.toLowerCase()}`, 'whale'))) {
                        return;
                    }
                    await sendTelegramAlert(uid, dmMessage, { imageUrl: whalePayload.imageUrl }).catch(
                        () => {}
                    );
                })();
            }
            if (
                isAdminUserId(PERSONAL_ID) &&
                !alertUids.includes(PERSONAL_ID) &&
                alertDest !== PERSONAL_ID
            ) {
                void (async () => {
                    if (
                        !(await claimNotification(
                            `whale-dm:${PERSONAL_ID}:${mint.hash.toLowerCase()}`,
                            'whale'
                        ))
                    ) {
                        return;
                    }
                    await sendTelegramAlert(PERSONAL_ID, dmMessage, { imageUrl: whalePayload.imageUrl }).catch(
                        () => {}
                    );
                })();
            }

            if (automintClaimed && !env.AUTO_EXECUTE_BEFORE_METADATA) {
                void runWhaleAutomint().catch(reportAutomintCrash);
            }

        } catch (err) {
            console.error('Error processing mint event:', err);
        }
    });

    syncTracker();
    tracker.start();
    console.log('✅ Tracker started');
}

// Drop duplicate update_id (webhook retries / twin replicas)
bot.use(async (ctx, next) => {
    if (isDuplicateTelegramUpdate(ctx.update.update_id)) {
        return;
    }
    return next();
});

// Background listener to passively log active group members
bot.use(async (ctx, next) => {
    try {
        if (ctx.chat?.id.toString() === state.alertChatId && ctx.from?.id && !ctx.from.is_bot) {
            const uid = ctx.from.id.toString();
            if (uid !== PERSONAL_ID) {
                if (!state.chatMembers) state.chatMembers = [];
                if (!state.chatMembers.includes(uid)) {
                    state.chatMembers.push(uid);
                    // Save asynchronously in the background so it doesn't block the middleware flow
                    StateManager.save(state).catch(() => { });
                }
            }
        }
    } catch (e) { }

    return next();
});

// Optional Telegram debug (off by default — prevents Railway log floods)
bot.use(async (ctx, next) => {
    if (process.env.LOG_TELEGRAM_UPDATES === 'true') {
        log('debug', `[Telegram Update] ${ctx.updateType} from uid=${ctx.from?.id ?? '?'}`);
        if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
            log('debug', `[Telegram Callback] ${ctx.callbackQuery.data}`);
        }
    }
    return next();
});

// ==========================================
// ACCESS GATE MIDDLEWARE
// Runs on EVERY update. Blocks non-admin users who haven't entered the access code.
// /start and /unlock are always whitelisted so new users can authenticate.
// ==========================================
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return next(); // Unknown sender, pass through

    // Admin is always allowed
    if (userId === PERSONAL_ID) return next();

    if (userCanUseBot(state, userId, PERSONAL_ID)) return next();

    // Whitelist: common commands that always pass so users can authenticate or check health
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (
        text.startsWith('/start') ||
        text.startsWith('/unlock') ||
        text.startsWith('/ping') ||
        text.startsWith('/status') ||
        text.startsWith('/version')
    ) {
        return next();
    }

    // Block everything else and prompt for the code
    await ctx.reply(
        `🔒 <b>This bot is locked.</b>\n\nEnter the access code to continue:\n<code>/unlock YOUR_CODE</code>`,
        { parse_mode: 'HTML' }
    ).catch(() => { });
    // DO NOT call next() — swallow the event
});

bot.command('bind', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) {
        return ctx.reply(`🔒 <b>Unauthorized.</b>\nOnly the Admin can bind the bot's alert channel.\n\nIf you want the bot to post here, forward this Group ID to the Admin: <code>${ctx.chat?.id}</code>\n\nThe Admin can then DM me:\n<code>/bind ${ctx.chat?.id}</code>`, { parse_mode: 'HTML' });
    }

    const args = ctx.message.text.split(' ');
    if (args[1]) {
        state.alertChatId = args[1];
        await StateManager.save(state);
        return ctx.reply(`🔗 <b>Alerts Remotely Bound!</b>\nI have successfully bound all mint alerts to chat ID: <code>${args[1]}</code>`, { parse_mode: 'HTML' });
    }

    state.alertChatId = ctx.chat?.id.toString();
    await StateManager.save(state);
    ctx.reply(`🔗 <b>Alerts Bound!</b>\nI will now send all blockchain mint alerts to this specific chat.`, { parse_mode: 'HTML' });
});

// ==========================================
// BATCH MINT WIZARD — interactive /mint + gas advisor (register before link mint text handler)
// ==========================================
const schedulerHandles: Map<string, NodeJS.Timeout> = new Map();

function dropMintSchedulerDeps(): DropMintSchedulerDeps {
    return {
        getState: () => state,
        saveState: s => StateManager.save(s),
        schedulerHandles,
        getUserProvider: uid => getUserProvider(uid) as JsonRpcProvider,
        getUserWallets: uid => getUserMintWallets(uid),
        mintOptionsForUser,
        getAlertDest: () => state.alertChatId || GROUP_ID,
        personalId: PERSONAL_ID,
        isOnCooldown,
        safeSendTelegram,
        userLabelFromStored,
        walletLine,
        mintReportBody,
        buildMempoolLinksFromResults,
        runOwnerMintMonitor,
        monitorTransactions,
        notifyAdminUserAction,
        isAdminUserId,
        hasActiveMintDashAccess: hasCachedMintDashAccess,
    } as DropMintSchedulerDeps;
}

if (runsMintCommandServices(BOT_ROLE)) {
registerContractMintHandler(bot, {
    requireUnlocked: async ctx => {
        const uid = ctx.from?.id?.toString() || '';
        if (!userCanUseBot(state, uid, PERSONAL_ID)) {
            await ctx.reply(
                state.accessCode
                    ? '🔒 Enter the access code: <code>/unlock YOUR_CODE</code>'
                    : 'Unlock wallets first with /unlock',
                { parse_mode: 'HTML' }
            );
            return false;
        }
        return true;
    },
    getProvider: uid => getUserProvider(uid) as JsonRpcProvider,
    getUserWallets: uid => getUserMintWallets(uid),
    isAdmin: uid => isAdminUserId(uid),
});

registerBatchMintWizard(bot, {
    getHdWalletKeyCount,
    getUserWallets: (uid: string) => getUserMintWallets(uid),
    getUserProvider: (uid: string) => getUserProvider(uid),
    walletLine,
    getImportedWalletCount,
    isAdminUser: (uid: string) => isAdminUserId(uid),
});

registerDropMintWizard(bot, dropMintSchedulerDeps());

// ==========================================
// LINK MINT HANDLER — detects pasted contracts/links and offers to mint
// Must be registered BEFORE the PK auto-import handler below.
// ==========================================
registerLinkMintHandler(
    bot,
    () => PERSONAL_ID,
    (uid: string) => getUserMintWallets(uid),
    async (userId: string, contract: string, data: string, value: string, options: any) => {
        const mintCheck = assertMintWalletAvailable(state, userId);
        if (!mintCheck.ok) throw new Error(mintCheck.message.replace(/<[^>]+>/g, ''));
        const userProvider = getUserProvider(userId);
        const userKeys = getUserMintWallets(userId).map(w => w.privateKey);
        if (userKeys.length === 0) throw new Error('No wallets configured');

        const linkCfg = loadLinkMintConfig();
        const txTo = (options?.executionTo as string) || contract;
        const candidate = DetectionEngine.candidateFromManual({ to: txTo, data, value });
        if (options?.scatterSlug) {
            candidate.to = txTo;
        }
        const engineResult = await CopyMintEngine.executeLinkMint({
            provider: userProvider as any,
            privateKeys: userKeys,
            candidate,
            paymentPlanValue: value,
            options: {
                ...options,
                maxMintLimit: options?.maxMintLimit || String(linkCfg.maxMintEth),
                throttleSimulations: process.env.LINK_MINT_THROTTLE_SIM !== 'false',
                skipClassification: true,
                allowUnknownPayment:
                    options?.allowUnknownPayment === true ||
                    process.env.LINK_MINT_ALLOW_UNKNOWN === 'true',
                paymentPrevalidated: options?.paymentPrevalidated === true,
                forceGasEstimate: true,
                gasTierId:
                    options?.gasTierId ||
                    process.env.LINK_MINT_GAS_TIER ||
                    'fcfs_plus',
                quantity: options?.quantity ?? linkCfg.defaultQuantity,
                skipSimulation:
                    options?.simulationMode === 'fast' || linkCfg.simulationMode === 'fast',
            },
        });
        const results = engineResult.legacyResults;
        results.forEach((res: any) => {
            (res as { uid?: string }).uid = userId;
        });

        let mempoolLinks = buildMempoolLinksFromResults(results);
        if (results.length === 0 && engineResult.submittedCount === 0) {
            const skip = CopyMintEngine.getLastSkipReason() || 'engine_skip';
            mempoolLinks += `⚠️ ${shortMintError(skip)}\n`;
        }

        const originChatId = (options?.originChatId as string) || userId;
        const valueEth =
            typeof value === 'bigint'
                ? formatEther(value)
                : formatEther(BigInt(value || '0'));

        await runOwnerMintMonitor({
            ownerUserId: userId,
            originChatId,
            results,
            mempoolLinks,
            title: '✅ <b>Link mint confirmed</b>',
            initHeading: '🎯 <b>Link mint submitted</b>',
            initBody:
                `Contract: <code>${contract}</code>\n\n` + mintReportBody(originChatId, mempoolLinks),
            userRef: { userId },
            monitorCtx: {
                contractAddress: contract,
                provider: userProvider as JsonRpcProvider,
                valueEth,
            },
        });

        return results;
    },
    () => {
        try { return getUserProvider(PERSONAL_ID); } catch { return null; }
    }
);
} // runsMintCommandServices

bot.on('text', async (ctx, next) => {
    // If it's a command, let 'next()' handle it so we don't block other commands.
    if (ctx.message.text.startsWith('/')) {
        return next();
    }

    const userId = ctx.from?.id.toString();
    if (!userId) return next();

    // Regex to find 64-character hex strings (Ethereum Private Keys)
    // Supports with or without '0x' prefix
    const pkRegex = /(?:0x)?[0-9a-fA-F]{64}\b/g;
    const matches = ctx.message.text.match(pkRegex);

    if (matches && matches.length > 0) {
        if (!state.importedWallets) state.importedWallets = {};
        if (!state.importedWallets[userId]) state.importedWallets[userId] = [];

        let imported = 0;
        let alreadyExisted = 0;

        for (const rawPk of matches) {
            // Normalize to always have 0x prefix for ethers.js
            const pk = rawPk.startsWith('0x') ? rawPk : '0x' + rawPk;

            try {
                // Validate it's a real wallet
                new ethers.Wallet(pk);

                if (state.importedWallets[userId].includes(pk)) {
                    alreadyExisted++;
                } else {
                    state.importedWallets[userId].push(pk);
                    imported++;
                }
            } catch (e) {
                // Invalid PK structure somehow, skip
            }
        }

        if (imported > 0 || alreadyExisted > 0) {
            await StateManager.save(state);
            await saveUserState(userId);

            // Delete the message for security if in a group
            if (ctx.chat.type !== 'private') {
                try { await ctx.deleteMessage(); } catch (e) { }
            }

            let replyMsg = ``;
            if (imported > 0) replyMsg += `✅ Auto-imported <b>${imported}</b> new wallet(s) from your text.\n`;
            if (alreadyExisted > 0) replyMsg += `ℹ️ Skipped ${alreadyExisted} wallet(s) that were already linked.`;

            await ctx.reply(replyMsg, { parse_mode: 'HTML' });
            return; // We consumed this event
        }
    }

    // Continue to other middleware if we didn't consume it
    return next();
});

bot.on('document', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return;

    try {
        const fileId = ctx.message.document.file_id;
        const fileUrl = await ctx.telegram.getFileLink(fileId);

        const response = await fetch(fileUrl.href);
        const content = await response.text();

        const regex = /0x[a-fA-F0-9]{40}/g;
        const matches = content.match(regex);

        if (!matches || matches.length === 0) {
            return ctx.reply('📭 No valid Ethereum addresses found in the uploaded file.');
        }

        let newCount = 0;
        for (const addr of matches) {
            const lower = addr.toLowerCase();
            if (!state.trackedAddresses.includes(lower)) {
                state.trackedAddresses.push(lower);
                newCount++;
            }
        }

        if (newCount > 0) {
            await StateManager.save(state);
            syncTracker();
            ctx.reply(`🐋 <b>Whale Import Successful!</b>\nParsed file and added ${newCount} new addresses to the tracker.\nTotal Tracked: ${state.trackedAddresses.length}`, { parse_mode: 'HTML' });
        } else {
            ctx.reply('ℹ️ No *new* addresses found. All valid addresses in the file were already being tracked.');
        }
    } catch (e: any) {
        ctx.reply(`❌ File processing failed: ${e.message}`);
    }
});

bot.command('maxmint', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only command.');
    const args = ctx.message.text.split(' ');

    if (!args[1] || isNaN(parseFloat(args[1]))) {
        return ctx.reply('Usage: /maxmint <ETH>\nExample: /maxmint 0.05');
    }

    state.maxMintLimit = args[1];
    await StateManager.save(state);
    ctx.reply(`🛡️ <b>Slippage Limit Updated!</b>\nThe bot will now completely reject any auto-mint payload that costs more than <b>${state.maxMintLimit} ETH</b>.`, { parse_mode: 'HTML' });
});

bot.command('bribe', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only command.');
    const args = ctx.message.text.split(' ');

    if (!args[1] || isNaN(parseFloat(args[1]))) {
        return ctx.reply('Usage: /bribe <GWEI>\nExample: /bribe 5 (Set to 0 to disable)');
    }

    state.gasBribeGwei = args[1];
    await StateManager.save(state);

    if (parseFloat(state.gasBribeGwei) > 0) {
        ctx.reply(`⚡ <b>Gas Bribe Active!</b>\nAll outgoing transactions will now aggressively add a <b>+${state.gasBribeGwei} GWEI</b> bribe tip to Miners to securely frontrun other bots in the mempool.`, { parse_mode: 'HTML' });
    } else {
        ctx.reply(`🛑 Gas Bribing Disabled. Transactions will revert back to standard network averages.`);
    }
});

bot.command('inclusion', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only command.');
    const args = ctx.message.text.split(/\s+/);
    const arg = (args[1] || '').toLowerCase();

    if (!arg) {
        const mode = inclusionModeFromState(state);
        const builderOn = process.env.BUILDER_MINT_ENABLED === 'true';
        return ctx.reply(
            `📡 <b>Inclusion mode</b>: <code>${mode}</code>\n` +
                `${inclusionModeLabel(mode)}\n\n` +
                `Builder mints: <b>${builderOn ? 'enabled' : 'disabled'}</b> (BUILDER_MINT_ENABLED)\n\n` +
                `<b>Modes</b>\n` +
                `• <code>public</code> — user RPC mempool (default FCFS)\n` +
                `• <code>protected</code> — MEV Blocker (anti-sandwich, not for sniping)\n` +
                `• <code>builder</code> — Flashbots bundle (EIP-1559 priority boost)\n\n` +
                `Usage: <code>/inclusion public|protected|builder</code>`,
            { parse_mode: 'HTML' }
        );
    }

    const map: Record<string, InclusionMode> = {
        public: 'public',
        protected: 'protected',
        mev: 'protected',
        blocker: 'protected',
        builder: 'builder_flashbots',
        flashbots: 'builder_flashbots',
        builder_flashbots: 'builder_flashbots',
        titan: 'builder_titan',
        builder_titan: 'builder_titan',
    };
    const next = map[arg];
    if (!next || !INCLUSION_MODES.includes(next)) {
        return ctx.reply('Unknown mode. Use: public, protected, or builder');
    }
    if (isBuilderMode(next) && process.env.BUILDER_MINT_ENABLED !== 'true') {
        return ctx.reply(
            '⚠️ Builder mode requires <code>BUILDER_MINT_ENABLED=true</code> and <code>FLASHBOTS_AUTH_PRIVATE_KEY</code> in env.',
            { parse_mode: 'HTML' }
        );
    }

    state.inclusionMode = next;
    state.mevProtection = next === 'protected';
    await StateManager.save(state);
    ctx.reply(
        `📡 Inclusion set to <b>${next}</b>\n<i>${inclusionModeLabel(next)}</i>`,
        { parse_mode: 'HTML' }
    );
});

bot.command('mev', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only command.');
    const args = ctx.message.text.split(' ');

    if (args[1] === 'on') {
        state.inclusionMode = 'protected';
        state.mevProtection = true;
        await StateManager.save(state);
        ctx.reply(
            `🛡️ <b>Protected routing: ON</b>\nTransactions route through MEV Blocker (anti-sandwich).\n\n` +
                `<i>Not for competitive FCFS sniping — use <code>/inclusion builder</code> for builder bundles.</i>`,
            { parse_mode: 'HTML' }
        );
    } else if (args[1] === 'off') {
        state.inclusionMode = 'public';
        state.mevProtection = false;
        await StateManager.save(state);
        ctx.reply(`🛑 <b>Protected routing: OFF</b>\nUsing public mempool (faster for FCFS, no sandwich protection).`, {
            parse_mode: 'HTML',
        });
    } else {
        ctx.reply('Usage: /mev on or /mev off\nPrefer: /inclusion public|protected|builder');
    }
});

bot.command('chain', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only.');
    const args = ctx.message.text.split(' ');
    const url = args[1];
    if (!url || !url.startsWith('http')) return ctx.reply('Usage: /chain <new_rpc_url>');
    state.providerUrl = url;
    await StateManager.save(state);
    startTracker();
    ctx.reply(`🌐 <b>Global Node Updated</b>\nSystem default node is now: <code>${new URL(url).hostname}</code>\nTracker restarted.\n\nUsers: You can still use /setrpc to use your own private node!`, { parse_mode: 'HTML' });
});

bot.command('setrpc', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const parts = ctx.message.text.trim().split(/\s+/);
    const urlArg = parts[1];

    if (!urlArg) {
        return ctx.reply(
            '🚀 <b>Bring Your Own Provider</b>\n\n' +
                'Use this to avoid hitting rate limits and speed up your transactions.\n' +
                'Usage: <code>/setrpc &lt;url&gt;</code>\n' +
                'Example: <code>/setrpc https://eth-mainnet.g.alchemy.com/v2/…</code>\n' +
                '<code>wss://</code> URLs are converted to <code>https://</code> automatically.\n\n' +
                'Check status: <code>/myrpc</code> or <code>/rpc</code>\n' +
                'Reset: <code>/setrpc reset</code>',
            { parse_mode: 'HTML' }
        );
    }

    if (urlArg.toLowerCase() === 'reset') {
        if (!state.userRPCs) state.userRPCs = {};
        delete state.userRPCs[userId];
        await StateManager.save(state);
        await saveUserState(userId);
        return ctx.reply('✅ Custom RPC removed. You are now using the system default node.');
    }

    const pending = await ctx
        .reply('⏳ Testing RPC connection…', { parse_mode: 'HTML' })
        .catch(() => null);

    const validation = await validateUserRpcUrl(urlArg);
    if (!validation.ok) {
        const failText =
            `❌ <b>RPC test failed</b>\n\n` +
            `<i>${validation.error}</i>\n\n` +
            'Use a mainnet Ethereum HTTP endpoint (Alchemy, Infura, QuickNode, etc.).\n' +
            'Nothing was saved — your previous RPC (or system default) is unchanged.';
        if (pending) {
            await ctx.telegram
                .editMessageText(ctx.chat!.id, pending.message_id, undefined, failText, {
                    parse_mode: 'HTML',
                })
                .catch(() => ctx.reply(failText, { parse_mode: 'HTML' }));
        } else {
            await ctx.reply(failText, { parse_mode: 'HTML' });
        }
        return;
    }

    if (!state.userRPCs) state.userRPCs = {};
    state.userRPCs[userId] = validation.url;
    await StateManager.save(state);
    await saveUserState(userId);

    const fallbacks = resolveUserRpcUrlList(validation.url).length - 1;
    const okText =
        `✅ <b>Custom RPC saved</b>\n\n` +
        `<b>Primary:</b> <code>${maskRpcHostname(validation.url)}</code>\n` +
        `<b>Probe:</b> ${validation.latencyMs}ms\n` +
        (fallbacks > 0
            ? `<b>Fallbacks:</b> ${fallbacks} system endpoint(s) if your node rate-limits\n`
            : '') +
        `\nMints use your node first. Check anytime: <code>/myrpc</code>`;

    if (pending) {
        await ctx.telegram
            .editMessageText(ctx.chat!.id, pending.message_id, undefined, okText, { parse_mode: 'HTML' })
            .catch(() => ctx.reply(okText, { parse_mode: 'HTML' }));
    } else {
        await ctx.reply(okText, { parse_mode: 'HTML' });
    }
});

// ==========================================
// TELEGRAM CLICKABLE UI HUB
// ==========================================



bot.command('menu', async (ctx) => {
    sendMainMenu(ctx);
});

bot.command('start', async (ctx) => {
    const userId = ctx.from?.id.toString();
    const isLocked = !!state.accessCode?.trim();
    const isUnlocked = userCanUseBot(state, userId, PERSONAL_ID);

    if (isLocked && !isUnlocked) {
        return ctx.reply(
            `👋 <b>Welcome to Ultra Dads Minter!</b>\n\n🔒 This bot is invite-only.\nEnter your access code to get started:\n<code>/unlock YOUR_CODE</code>`,
            { parse_mode: 'HTML' }
        );
    }

    if (!isLocked && userId && !state.unlockedUsers?.includes(userId)) {
        if (!state.unlockedUsers) state.unlockedUsers = [];
        state.unlockedUsers.push(userId);
        StateManager.save(state).catch(() => {});
        saveUserState(userId).catch(() => {});
    }

    await sendMainMenu(ctx);
});

// /unlock <code> — new users enter this to authenticate
bot.command('unlock', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    if (userCanUseBot(state, userId, PERSONAL_ID)) {
        return ctx.reply('✅ You already have access to this bot!', { parse_mode: 'HTML' });
    }

    if (!state.accessCode?.trim()) {
        return ctx.reply('ℹ️ This bot has no access code set. You have full access.');
    }

    const entered = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!entered) {
        return ctx.reply('Usage: <code>/unlock YOUR_CODE</code>', { parse_mode: 'HTML' });
    }

    if (accessCodesMatch(entered, state.accessCode)) {
        grantUserUnlock(state, userId);
        await StateManager.save(state);
        await StateManager.saveUser(userId, { unlocked: true });
        await saveUserState(userId);

        // Delete the message in groups for security
        if (ctx.chat.type !== 'private') {
            try { await ctx.deleteMessage(); } catch (e) { }
        }

        await ctx.reply(
            `✅ <b>Access Granted!</b>\n\nWelcome to Ultra Dads. Your Command Center is now active.`,
            { parse_mode: 'HTML' }
        );
        return sendMainMenu(ctx);
    } else {
        // Wrong code — notify admin silently
        const username = ctx.from?.username ? `@${ctx.from.username}` : `User ${userId}`;
        await bot.telegram.sendMessage(PERSONAL_ID,
            `⚠️ <b>Failed unlock attempt</b>\n${username} (ID: <code>${userId}</code>) entered incorrect access code.`,
            { parse_mode: 'HTML' }
        ).catch(() => { });

        return ctx.reply('❌ Incorrect access code. Please try again or contact the admin.');
    }
});

// /setcode <new_code> — admin sets or rotates the access code
// /setcode off — removes the lock entirely
bot.command('setcode', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only.');

    const newCode = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!newCode) return ctx.reply('Usage: /setcode <new_code>\nUse /setcode off to remove the lock.');

    if (newCode.toLowerCase() === 'off') {
        state.accessCode = undefined;
        await StateManager.save(state);
        return ctx.reply('🔓 <b>Bot Lock Removed.</b>\nAnyone can now use the bot without a code.', { parse_mode: 'HTML' });
    }

    const hadCode = !!state.accessCode?.trim();
    const { clearedUnlocks, affectedUserIds } = invalidateAllUnlocks(state, PERSONAL_ID);
    state.accessCode = normalizeAccessCode(newCode);
    await StateManager.save(state);

    const persistIds = new Set(affectedUserIds);
    if (StateManager.isConnected()) {
        const dbUsers = await StateManager.loadAllUsers();
        for (const uid of Object.keys(dbUsers)) {
            if (TELEGRAM_USER_ID.test(uid) && uid !== PERSONAL_ID) {
                persistIds.add(uid);
            }
        }
    }
    for (const uid of persistIds) {
        await StateManager.saveUser(uid, { unlocked: false }).catch(() => {});
    }

    ctx.reply(
        `🔑 <b>Access Code ${hadCode ? 'Rotated' : 'Set'}!</b>\n\n` +
            `New code: <code>${state.accessCode}</code>\n\n` +
            `<b>All users must re-unlock</b> with:\n<code>/unlock ${state.accessCode}</code>\n\n` +
            `• ${clearedUnlocks} previous unlock(s) cleared\n` +
            `• ${persistIds.size} known user(s) marked locked (wallets unchanged)\n\n` +
            `<i>Share the new code only with active subscribers.</i>`,
        { parse_mode: 'HTML' }
    );
});

// /lockuser <user_id> — admin revokes a specific user's access
bot.command('lockuser', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only.');

    const targetId = ctx.message.text.split(' ')[1]?.trim();
    if (!targetId) return ctx.reply('Usage: /lockuser <telegram_user_id>');

    if (isUserRevoked(state, targetId) || !userCanUseBot(state, targetId, PERSONAL_ID)) {
        return ctx.reply(`ℹ️ User <code>${targetId}</code> does not have active access.`, { parse_mode: 'HTML' });
    }

    revokeUserAccess(state, targetId);
    await StateManager.save(state);
    await StateManager.saveUser(targetId, { unlocked: false });
    await saveUserState(targetId);

    ctx.reply(
        `🔒 <b>User Locked Out.</b>\nUser <code>${targetId}</code> was revoked. They need the current code: <code>/unlock …</code>`,
        { parse_mode: 'HTML' }
    );

    // Notify the user
    await bot.telegram.sendMessage(targetId,
        `🔒 Your access to this bot has been revoked by the admin. Contact them to regain access.`
    ).catch(() => { });
});

// /listusers — admin sees broadcast audience + unlocked subset
bot.command('listusers', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only.');

    const locked = state.accessCode ? `Active: <code>${state.accessCode}</code>` : 'None (bot is open)';
    const audience = await resolveBroadcastAudience(state);
    const unlocked = new Set(state.unlockedUsers || []);

    if (audience.userIds.length === 0) {
        return ctx.reply(`🔑 <b>Access Code:</b> ${locked}\n\n👥 No known users yet.`, { parse_mode: 'HTML' });
    }

    const list = audience.userIds
        .slice(0, 40)
        .map((id, i) => {
            const tags: string[] = [];
            if (unlocked.has(id)) tags.push('unlocked');
            if (state.userWallets?.[id]) tags.push(`${state.userWallets[id]}w`);
            return `${i + 1}. <code>${id}</code>${tags.length ? ` <i>(${tags.join(', ')})</i>` : ''}`;
        })
        .join('\n');
    const more =
        audience.userIds.length > 40 ? `\n<i>…and ${audience.userIds.length - 40} more</i>` : '';

    ctx.reply(
        `🔑 <b>Access Code:</b> ${locked}\n\n` +
            `👥 <b>Broadcast audience (${audience.counts.totalUsers})</b>\n` +
            `${list}${more}\n\n` +
            `<i>/broadcast reaches this full list + alert group.</i>\n` +
            `Use /lockuser &lt;id&gt; to revoke unlock only.`,
        { parse_mode: 'HTML' }
    );
});

bot.command('status', async (ctx) => {
    await sendStatusMenu(ctx, false);
});

// ==========================================
// PHASE 4 — NEW COMMANDS: /pause, /resume, /kill, /rpc, /execution, /version
// ==========================================

bot.command('pause', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    CopyMintEngine.pause();
    state.autoMint = false;
    await StateManager.save(state);
    const alertDest = state.alertChatId || GROUP_ID;
    await safeSendTelegram(alertDest, '⏸️ <b>EMERGENCY PAUSE</b>\n\nAuto-mint has been disabled immediately by admin.', { parse_mode: 'HTML' }).catch(() => {});
    ctx.reply('⏸️ <b>Auto-mint paused.</b> Use /resume to re-enable.', { parse_mode: 'HTML' });
});

bot.command('resume', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    CopyMintEngine.resume();
    state.autoMint = true;
    await StateManager.save(state);
    if (!tracker) startTracker();
    else syncTracker();
    if (tracker?.running) {
        tracker.resumePendingDetection();
    }
    const audit = buildTrackingAudit(state, tracker);
    ctx.reply(
        `▶️ <b>Auto-mint resumed.</b>\n` +
            `Engine: <b>READY</b> (panic cleared)\n` +
            `Tracker: ${audit.trackerRunning ? '🟢' : '🔴'} | Watching <b>${audit.trackerWatching}</b> / ${audit.unionCount} whales\n` +
            `Mempool pending: <b>${getMempoolPendingStatus(tracker).debugLine}</b>`,
        { parse_mode: 'HTML' }
    );
});

bot.command('freerpc', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const arg = (ctx.message.text.split(/\s+/)[1] || '').toLowerCase();

    if (arg === 'status') {
        return ctx.reply(
            `📊 <b>RPC load</b>\n\n${formatRpcLoadStatus(state, tracker)}\n\n` +
                `<code>/freerpc</code> — cancel all scheduled + block snipes, pause mempool\n` +
                `<code>/freerpc resume</code> — turn mempool pending back on`,
            { parse_mode: 'HTML' }
        );
    }

    if (arg === 'resume') {
        const resumed = tracker?.running ? tracker.resumePendingDetection() : false;
        return ctx.reply(
            resumed
                ? `▶️ <b>Mempool pending resumed.</b>\n\n${formatRpcLoadStatus(state, tracker)}`
                : `ℹ️ Mempool pending was already on, or tracker is stopped.\n\n${formatRpcLoadStatus(state, tracker)}`,
            { parse_mode: 'HTML' }
        );
    }

    const before = formatRpcLoadStatus(state, tracker);
    const result = clearRpcLoad({ schedulerHandles, state, tracker });
    await StateManager.save(state);

    const alertDest = state.alertChatId || GROUP_ID;
    await safeSendTelegram(
        alertDest,
        `🧹 <b>RPC relief</b> (admin)\n\n` +
            `• Scheduled drops cleared: <b>${result.scheduledCancelled}</b>\n` +
            `• Block snipes cleared: <b>${result.blockMintsCancelled}</b>\n` +
            `• Mempool pending: <b>${result.pendingPaused ? 'paused' : 'unchanged'}</b>\n\n` +
            `<i>Whale block detection still runs. Automint unchanged.</i>`,
        { parse_mode: 'HTML' }
    ).catch(() => {});

    ctx.reply(
        `🧹 <b>RPC freed</b>\n\n` +
            `<b>Before</b>\n${before}\n\n` +
            `<b>Cleared</b>\n` +
            `• <b>${result.scheduledCancelled}</b> scheduled drop(s)\n` +
            `• <b>${result.blockMintsCancelled}</b> block snipe(s)\n` +
            `• Mempool pending: <b>${result.pendingPaused ? 'paused' : 'was already off'}</b>\n\n` +
            `<i>Automint and whale tracking are still active. Confirmed-block detection still works.</i>\n\n` +
            `<code>/freerpc resume</code> — restore mempool speed\n` +
            `<code>/freerpc status</code> — check queue`,
        { parse_mode: 'HTML' }
    );
});

bot.command('kill', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    CopyMintEngine.panic();
    state.autoMint = false;
    if (tracker) {
        tracker.stop();
        tracker = null;
    }
    await StateManager.save(state);
    const alertDest = state.alertChatId || GROUP_ID;
    await safeSendTelegram(alertDest, '🛑 <b>KILL SWITCH ACTIVATED</b>\n\nAuto-mint disabled AND tracker stopped. Bot is in safe mode.\nUse /resume + restart tracker to re-enable.', { parse_mode: 'HTML' }).catch(() => {});
    ctx.reply('🛑 <b>Kill switch activated.</b>\n• Auto-mint: OFF\n• Tracker: STOPPED\n\nUse /resume to re-enable auto-mint.\nUse /automint on + restart to bring tracker back.', { parse_mode: 'HTML' });
});

async function buildRpcStatusHtml(userId: string): Promise<string> {
    const customUrl = state.userRPCs?.[userId]?.trim();
    const urls = resolveUserRpcUrlList(customUrl);
    const wsUrl = process.env.WS_RPC_URL?.trim();

    if (urls.length === 0) {
        return (
            `🌐 <b>RPC Status</b>\n\n` +
            `❌ No RPC configured.\n\n` +
            `Set <code>PROVIDER_URL</code> on Railway or use <code>/setrpc &lt;url&gt;</code>.`
        );
    }

    const primaryHost = maskRpcHostname(urls[0]);
    const [pooledMs, probes] = await Promise.all([
        measurePooledLatency(urls.length ? urls.join(',') : undefined),
        probeRpcEndpoints(urls, 2),
    ]);

    let text = `🌐 <b>RPC Status</b>\n\n`;
    text += `<b>Primary:</b> <code>${primaryHost}</code>\n`;
    text += `<b>Endpoints:</b> ${urls.length}\n`;
    const fallbackCount = customUrl ? Math.max(0, urls.length - 1) : 0;
    text += `<b>Source:</b> ${customUrl ? 'Personal (/setrpc)' : 'System default'}\n`;
    if (fallbackCount > 0) {
        text += `<b>Fallbacks:</b> ${fallbackCount} system endpoint(s) if primary fails\n`;
    }
    text += '\n';

    if (pooledMs > 0) {
        text += `<b>Mint pool</b> <i>(fallback provider — what the bot uses)</i>\n`;
        text += `• combined — <b>${pooledMs}ms</b> ✅\n\n`;
    } else {
        text += `<b>Mint pool:</b> ❌ <i>all HTTP endpoints failed in fallback</i>\n\n`;
    }

    text += `<b>Per endpoint</b> <i>(2× eth_blockNumber, raw HTTP)</i>\n`;

    for (const p of probes) {
        const role = p.primary ? 'primary' : 'fallback';
        if (p.ok && p.latencyMs > 0) {
            text += `• <code>${p.hostname}</code> — <b>${p.latencyMs}ms</b> (${role}) ✅\n`;
        } else {
            text += `• <code>${p.hostname}</code> — <b>failed</b> (${role}) ❌`;
            if (p.error) text += `\n  <i>${p.error}</i>`;
            text += '\n';
        }
    }

    if (wsUrl) {
        const wsMs = await probeWebSocketLatency(wsUrl);
        const wsHost = maskRpcHostname(wsUrl);
        text += `\n<b>WebSocket</b> <code>${wsHost}</code>\n`;
        text +=
            wsMs > 0
                ? `• connect + block — <b>${wsMs}ms</b> ✅\n`
                : `• connect + block — <b>failed / timeout</b> ❌\n`;
    } else {
        text += `\n<b>WebSocket:</b> not set <i>(pending detection uses HTTP only)</i>\n`;
    }

    const cached = getHealthStats();
    const withErrors = cached.filter(s => s.errorCount > 0);
    if (withErrors.length > 0) {
        text += `\n<i>Session errors: ${withErrors.map(s => `${maskRpcHostname(s.urls[0])}×${s.errorCount}`).join(', ')}</i>\n`;
    }

    text += `\n💡 <code>/setrpc &lt;url&gt;</code> — personal RPC (live-tested)\n<code>/setrpc reset</code> — system default`;
    return text;
}

async function replyRpcStatus(ctx: Context, userId: string): Promise<void> {
    const pending = await ctx.reply('⏳ Measuring RPC latency…', { parse_mode: 'HTML' }).catch(() => null);
    try {
        const text = await buildRpcStatusHtml(userId);
        if (pending) {
            await ctx.telegram.editMessageText(ctx.chat!.id, pending.message_id, undefined, text, {
                parse_mode: 'HTML',
            });
        } else {
            await ctx.reply(text, { parse_mode: 'HTML' });
        }
    } catch (e) {
        const msg = `❌ RPC probe failed: ${((e as Error).message || 'unknown').slice(0, 120)}`;
        if (pending) {
            await ctx.telegram
                .editMessageText(ctx.chat!.id, pending.message_id, undefined, msg, { parse_mode: 'HTML' })
                .catch(() => ctx.reply(msg, { parse_mode: 'HTML' }));
        } else {
            await ctx.reply(msg, { parse_mode: 'HTML' });
        }
    }
}

bot.command('rpc', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    await replyRpcStatus(ctx, userId);
});

bot.command('myrpc', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    await replyRpcStatus(ctx, userId);
});

bot.command('execution', async (ctx) => {
    if (recentCopyTrades.length === 0) {
        return ctx.reply('📋 <b>No recent executions.</b>\n\nWhen the bot copy-trades a whale mint, results will appear here.', { parse_mode: 'HTML' });
    }

    const last10 = recentCopyTrades.slice(0, 10);
    let text = `📋 <b>Recent Executions</b> (last ${last10.length})\n\n`;

    for (const trade of last10) {
        const time = new Date(trade.timestamp).toLocaleTimeString();
        const status = trade.status === 'Success' ? '✅' : '❌';
        const target = (trade.target || '').slice(0, 10) + '...';
        const link = trade.hash && trade.hash !== 'N/A' ? `<a href="https://etherscan.io/tx/${trade.hash}">tx</a>` : '—';
        text += `${status} ${time} → <code>${target}</code> ${link}\n`;
        if (trade.error) text += `   └ <i>${(trade.error as string).slice(0, 40)}</i>\n`;
    }

    text += `\n<b>Totals:</b> ✅ ${botAnalytics.successfulTrades} | ❌ ${botAnalytics.failedTrades} | 💰 ${botAnalytics.totalEthSpent.toFixed(4)} ETH spent`;

    ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
});

bot.command('version', async (ctx) => {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const mongoStatus = StateManager.isConnected() ? '🟢 Connected' : '🔴 Disconnected';
    const trackerStatus = tracker?.running ? '🟢 Running' : '🔴 Stopped';

    ctx.reply(
        `🤖 <b>Ultra Dads Minter Bot</b>\n\n` +
        `<b>Version:</b> v${BOT_VERSION}\n` +
        `<b>Uptime:</b> ${hours}h ${mins}m\n` +
        `<b>Runtime:</b> Node ${process.version}\n` +
        `<b>Tracker:</b> ${trackerStatus}\n` +
        `<b>Database:</b> ${mongoStatus}\n` +
        `<b>Platform:</b> Railway`,
        { parse_mode: 'HTML' }
    );
});

bot.command('debug_status', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const uptime = Math.floor(process.uptime());
    const stats = tracker?.getStats?.() || {} as any;
    const envRpc = (process.env.PROVIDER_URL || '').split(',')[0].slice(0, 35);
    const stateRpc = (state.providerUrl || '').split(',')[0].slice(0, 35);
    const inclusion = InclusionRouter.getMetrics();
    const pendingBundles = BundleInclusionMonitor.getPendingSummary();
    const inclusionMode = state ? inclusionModeFromState(state) : 'public';

    ctx.reply(
        `🔍 <b>DEBUG STATUS</b>\n\n` +
        `Uptime: ${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m\n` +
        `AutoMint: ${state.autoMint ? '✅' : '❌'} | Overdrive: ${state.overdrive ? '🚀' : '❌'} | Sim: ${state.skipSimulation ? 'BLIND' : 'SIM'}\n` +
        `Inclusion: ${inclusionModeShort(inclusionMode)} (${inclusionModeLabel(inclusionMode)})\n` +
        `MaxMint: ${state.maxMintLimit || '1.0'} ETH | Bribe: ${state.gasBribeGwei || '0'} GWEI\n\n` +
        `Detection: Pending=${getMempoolPendingStatus(tracker).debugLine} Block=${getRuntimeConfig().enableBlockFallback ? 'ON' : 'OFF'}\n` +
        `WS: ${stats.wsConnected ? '✅' : '❌'} | Blocks: ${stats.blocksProcessed || 0} | Mints: ${stats.mintsDetected || 0}\n\n` +
        `Tracker HTTP: ${getTrackerHttpUrl() ? maskRpcHostname(getTrackerHttpUrl()!) : 'default'}\n` +
        `Tracker WS: ${resolveTrackerWsUrl() ? maskRpcHostname(resolveTrackerWsUrl()!) : 'none'}\n` +
        `Discord mirror: ${isDiscordMirrorEnabled() ? 'ON' : 'OFF'}\n` +
        formatBuilderDebugHtml(inclusion, pendingBundles) +
        `\nENV RPC: ${envRpc}\n` +
        `State RPC: ${stateRpc}\n` +
        `${envRpc.slice(8, 25) !== stateRpc.slice(8, 25) ? '⚠️ MISMATCH' : '✅ Match'}\n\n` +
        `Tracked: ${state.trackedAddresses?.length || 0} | Users: ${Object.keys(state.userWallets).length} | Mongo: ${StateManager.isConnected() ? '✅' : '❌'}`,
        { parse_mode: 'HTML' }
    );
});

bot.command('debug_automint', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const userId = ctx.from?.id.toString() || '';
    const wallets = getUserWallets(userId);
    const mintWallets = getUserMintWallets(userId);
    const tracked = state.trackedAddresses || [];
    const personalTracked = state.userTrackedAddresses?.[userId] || [];
    const compromised = listCompromisedDisplayIndices(state, userId);

    let reasons: string[] = [];
    if (!state.autoMint) reasons.push('autoMint is OFF');
    if (!tracker?.running) reasons.push('Tracker not running');
    const mempoolPending = getMempoolPendingStatus(tracker);
    if (mempoolPending.effective === 'paused') reasons.push('Mempool pending PAUSED (/freerpc)');
    if (!getBotMnemonic()) reasons.push('MNEMONIC env missing');
    if (tracked.length === 0 && personalTracked.length === 0) reasons.push('No whales tracked');
    if (wallets.length === 0) reasons.push('No user wallets');
    if (mintWallets.length === 0 && wallets.length > 0) {
        reasons.push('All wallets marked compromised (no safe mint fleet)');
    }
    if (CopyMintEngine.getStatus().paused) reasons.push('Engine PAUSED (/pause)');
    if (CopyMintEngine.getStatus().panic) reasons.push('Engine PANIC (/kill)');

    ctx.reply(
        `🔍 <b>DEBUG AUTOMINT</b>\n\n` +
        `Would fire: ${reasons.length === 0 ? '✅ YES' : '❌ NO'}\n` +
        (reasons.length > 0 ? `Blocking: ${reasons.join(', ')}\n` : '') +
        `\nautoMint=${state.autoMint} | maxMint=${state.maxMintLimit || '1.0'}\n` +
        `skipSim=${state.skipSimulation} | overdrive=${state.overdrive}\n` +
        `Global tracked: ${tracked.length} | Personal: ${personalTracked.length}\n` +
        `Fleet: ${wallets.length} total · ${mintWallets.length} safe for mint` +
        (compromised.length ? ` · ☠️ #${compromised.join(', #')}` : '') +
        `\nPending: ${mempoolPending.debugLine} | Block: ${getRuntimeConfig().enableBlockFallback ? 'ON' : 'OFF'}`,
        { parse_mode: 'HTML' }
    );
});

async function sendCapacityMenu(ctx: any, isEdit = false): Promise<void> {
    const status = buildCapacityStatus(tracker, BOT_VERSION);
    const text = capacityMenuText(status, state.autoMint);
    const keyboard = capacityMenuKeyboard(status, state.autoMint);
    const opts = {
        parse_mode: 'HTML' as const,
        link_preview_options: { is_disabled: true as const },
        ...keyboard,
    };
    if (isEdit) {
        await ctx.editMessageText(text, opts).catch(() => {});
    } else {
        await ctx.reply(text, opts).catch(() => {});
    }
}

bot.command('debug_capacity', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await sendCapacityMenu(ctx, false);
});

bot.command('capacity', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    await sendCapacityMenu(ctx, false);
});

bot.command('debug_tracker', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const stats = tracker?.getStats?.() || {} as any;
    const dbg = trackerDebugState.get();
    const orch = getOrchestratorDebug();
    const lastBlock = stats.lastBlockTime ? `${Math.round((Date.now() - stats.lastBlockTime) / 1000)}s ago` : 'never';
    const lastCand = dbg.lastCandidate?.sourceTxHash?.slice(0, 14) || orch.lastCandidate?.sourceTxHash?.slice(0, 14) || 'none';

    ctx.reply(
        `🔍 <b>DEBUG TRACKER</b>\n\n` +
        `Status: ${tracker?.running ? '🟢' : '🔴'} | Mode: ${dbg.mode} | WS: ${stats.wsConnected ? '✅' : '❌'}\n` +
        `Pending: ${getMempoolPendingStatus(tracker).debugLine} | Block fallback: ${getRuntimeConfig().enableBlockFallback ? 'ON' : 'OFF'}\n` +
        `Blocks: ${stats.blocksProcessed || 0} | Last block: ${lastBlock}\n` +
        `Mints: ${stats.mintsDetected || 0} | Dupes: ${stats.duplicatesSkipped || 0} | Debug dupes: ${dbg.duplicateCount}\n` +
        `Rejected: ${stats.nonMintsRejected || 0} | RPC errors: ${dbg.rpcErrors}\n` +
        `Last candidate: <code>${lastCand}</code>\n` +
        `Last skip: ${dbg.lastSkipReason || orch.lastSkipReason || 'none'}\n` +
        `Tracked: ${tracker?.getTrackedAddresses()?.length || 0} addresses`,
        { parse_mode: 'HTML' }
    );
});

bot.command('debug_rpc', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const rpc = getRpcBudgetDebug();
    ctx.reply(
        `🔍 <b>DEBUG RPC</b>\n\n` +
        `Tracker: <code>${rpc.trackerFingerprint}</code>\n` +
        `Execution: <code>${rpc.executionFingerprint}</code>\n` +
        `Reads: ${rpc.readCount} | 429s: ${rpc.rpc429Count} | Errors: ${rpc.readErrors}`,
        { parse_mode: 'HTML' }
    );
});

bot.command('debug_messages', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const msg = getMessageDedupeStats();
    ctx.reply(
        `🔍 <b>DEBUG MESSAGES</b>\n\n` +
        `Sent (session): ${msg.sentCount}\n` +
        `Duplicates suppressed: ${msg.duplicatesSuppressed}\n` +
        `Active dedupe keys: ${msg.activeKeys}\n` +
        `Discord mirror: ${isDiscordMirrorEnabled() ? 'ON' : 'OFF'}\n` +
        `Process: <code>${PROCESS_START_ID}</code>`,
        { parse_mode: 'HTML' }
    );
});

bot.command('debug_execution', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const orch = getOrchestratorDebug();
    const eng = CopyMintEngine.getStatus();
    const intent = orch.lastIntent;
    ctx.reply(
        `🔍 <b>DEBUG EXECUTION</b>\n\n` +
        `Engine: ${eng.panic ? 'PANIC' : eng.paused ? 'PAUSED' : 'READY'}\n` +
        `Blind broadcast: ${process.env.BLIND_BROADCAST_ENABLED === 'true' ? 'ON ⚠️' : 'OFF ✅'}\n` +
        `Overdrive: ${state.overdrive ? 'ON' : 'OFF'} | Sim: ${state.skipSimulation ? 'BLIND' : 'ON'}\n` +
        `Last route: ${intent?.routeType || 'none'}\n` +
        `Can auto-exec: ${intent?.canAutoExecute ? 'yes' : 'no'}\n` +
        `Last skip: ${orch.lastSkipReason || eng.lastSkipReason || CopyMintEngine.getLastSkipReason() || 'none'}`,
        { parse_mode: 'HTML' }
    );
});

bot.command('debug_lastskip', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    if (!lastSkipReason) {
        return ctx.reply('ℹ️ No automint has been skipped yet since last restart.');
    }

    const age = Math.round((Date.now() - lastSkipReason.timestamp) / 1000);
    let text = `🔍 <b>LAST AUTOMINT SKIP</b>\n\n`;
    text += `<b>When:</b> ${age}s ago\n`;
    text += `<b>Contract:</b> <code>${lastSkipReason.contract}</code>\n`;
    text += `<b>Tx:</b> <code>${lastSkipReason.hash.slice(0, 14)}...</code>\n`;
    text += `<b>Payment:</b> ${lastSkipReason.paymentMode} (${lastSkipReason.confidence})\n`;
    text += `<b>Reason:</b> ${lastSkipReason.reason}\n`;

    const engineSkip = CopyMintEngine.getLastSkipReason();
    if (engineSkip) text += `\n<b>Engine:</b> ${engineSkip}`;

    ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('lastmint', async (ctx) => {
    const s = CopyMintEngine.getStatus();
    if (!s.lastCandidate) return ctx.reply('No mint candidate recorded yet.');
    const c = s.lastCandidate;
    ctx.reply(
        `🐋 <b>Last detected mint</b>\n` +
            `Source: ${c.detectionSource}\n` +
            `Whale: <code>${c.sourceWallet || 'n/a'}</code>\n` +
            `Contract: <code>${c.to}</code>\n` +
            `Value: ${c.value}`,
        { parse_mode: 'HTML' }
    );
});

bot.command('lastexec', async (ctx) => {
    const s = CopyMintEngine.getStatus();
    if (!s.lastExecution) return ctx.reply('No engine execution yet.');
    ctx.reply(ExecutionReporter.toTelegramSummary(s.lastExecution), { parse_mode: 'HTML' });
});

bot.command('gas', async (ctx) => {
    const cfg = getRuntimeConfig();
    ctx.reply(
        `⛽ <b>Gas config</b>\n` +
            `Mode: ${cfg.gasMode}\n` +
            `Overdrive: ${cfg.overdriveGas ? 'ON' : 'OFF'}\n` +
            `Normal multiplier: ${cfg.normalGasMultiplier}\n` +
            `Max fee: ${cfg.maxFeeGwei} gwei\n` +
            `Priority cap: ${cfg.maxPriorityFeeGwei} gwei\n` +
            `Min wallet buffer: ${cfg.minWalletBufferEth} ETH`,
        { parse_mode: 'HTML' }
    );
});

bot.command('speed', async (ctx) => {
    const stats = (tracker?.getStats?.() || {}) as { wsConnected?: boolean };
    const det = DetectionEngine.getStats();
    ctx.reply(
        `⚡ <b>Speed</b>\n` +
            `Pending detection: ${getMempoolPendingStatus(tracker).debugLine}\n` +
            `WS: ${stats.wsConnected ? 'connected' : 'off'}\n` +
            `Last block seen: ${det.lastSeenBlock || '—'}\n` +
            `Engine queue: ${CopyMintEngine.getStatus().queueDepth}`,
        { parse_mode: 'HTML' }
    );
});

bot.command('panic', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    CopyMintEngine.panic();
    state.autoMint = false;
    if (tracker) { tracker.stop(); tracker = null; }
    await StateManager.save(state);
    ctx.reply('🛑 <b>PANIC</b> — engine halted, auto-mint off, tracker stopped.', { parse_mode: 'HTML' });
});

bot.command('funding', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const wallets = getUserWallets(userId);
    if (!wallets.length) return ctx.reply('No wallets.');
    const provider = getUserProvider(userId);
    const lines: string[] = [];
    for (let i = 0; i < wallets.length; i++) {
        const bal = await provider.getBalance(wallets[i].address);
        lines.push(`#${i + 1} <code>${wallets[i].address.slice(0, 8)}...</code> ${(Number(bal) / 1e18).toFixed(4)} ETH`);
    }
    ctx.reply(`💰 <b>Funding</b>\n${lines.join('\n')}`, { parse_mode: 'HTML' });
});

// /broadcast <message> — admin pushes a message to all users + group
bot.command('broadcast', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only.');

    const msg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!msg) return ctx.reply('Usage: /broadcast <your message>\n\nThe message will be sent to all unlocked users and the alert group.');

    const audience = await resolveBroadcastAudience(state);
    const statusMsg = await ctx.reply(
        `📡 Broadcasting to <b>${audience.counts.totalUsers}</b> user(s)` +
            `${state.alertChatId || GROUP_ID ? ' + alert group' : ''}…`,
        { parse_mode: 'HTML' }
    );

    const result = await broadcastToAll(`📢 <b>Admin Announcement</b>\n\n${msg}`, { parse_mode: 'HTML' });

    let summary =
        `✅ <b>Broadcast complete</b>\n\n` +
        `DMs: <b>${result.sent - (result.groupIncluded ? 1 : 0)}</b> delivered · <b>${result.failed}</b> failed\n` +
        `Audience: ${audience.counts.totalUsers} users ` +
        `(${audience.counts.fromWallets} wallets · ${audience.counts.fromUnlocked} unlocked`;
    if (audience.counts.fromDatabase > 0) summary += ` · ${audience.counts.fromDatabase} db`;
    summary += `)`;
    if (result.groupIncluded) summary += `\nAlert group: included`;
    if (result.failedUserIds.length > 0 && result.failedUserIds.length <= 8) {
        summary += `\n\n<i>Failed (never /start bot?):</i>\n${result.failedUserIds.map(id => `<code>${id}</code>`).join(' ')}`;
    } else if (result.failedUserIds.length > 8) {
        summary += `\n\n<i>${result.failedUserIds.length} users could not be reached (usually never started the bot).</i>`;
    }

    ctx.telegram
        .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, summary, { parse_mode: 'HTML' })
        .catch(() => {});
});

// /discordbroadcast <message> — admin posts to all configured Discord channels in parallel
bot.command('discordbroadcast', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const msg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!msg) {
        return ctx.reply(
            'Usage: /discordbroadcast <message>\n\n' +
                'Posts to every channel in DISCORD_BROADCAST_TARGETS (parallel). ' +
                'Use /discordbroadcast_status to see targets.'
        );
    }

    let config;
    try {
        const loaded = await tryLoadDiscordBroadcastConfig();
        if (!loaded) {
            return ctx.reply(
                '❌ Discord broadcast not configured.\n\n' +
                    'Set DISCORD_BOT_TOKEN + DISCORD_BROADCAST_TARGETS or ' +
                    '<code>data/discord-broadcast-targets.json</code>.',
                { parse_mode: 'HTML' }
            );
        }
        config = loaded;
    } catch (e) {
        return ctx.reply(`❌ ${(e as Error).message}`);
    }

    const desc = describeDiscordBroadcastTargets(config.targets);
    const statusMsg = await ctx.reply(
        `📡 Discord broadcast to <b>${desc.total}</b> target(s)…`,
        { parse_mode: 'HTML' }
    );

    try {
        const result = await broadcastToDiscordChannels(`📢 **Admin Announcement**\n\n${msg}`, {
            config,
        });

        if (result.skippedDuplicate) {
            return ctx.telegram
                .editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    undefined,
                    '⏭️ Skipped duplicate Discord broadcast (already sent).',
                    { parse_mode: 'HTML' }
                )
                .catch(() => {});
        }

        let summary =
            `✅ <b>Discord broadcast</b>\n\n` +
            `<b>${result.sent}</b>/${result.totalTargets} sent in <b>${result.elapsedMs}ms</b>`;
        if (result.failed > 0) {
            const fails = result.results
                .filter(r => !r.ok)
                .slice(0, 8)
                .map(r => `${r.label ?? '?'}: ${r.error ?? 'failed'}`)
                .join('\n');
            summary += `\n\n❌ Failed (${result.failed}):\n<code>${fails.replace(/</g, '')}</code>`;
        }

        await ctx.telegram
            .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, summary, {
                parse_mode: 'HTML',
            })
            .catch(() => {});
    } catch (e) {
        await ctx.telegram
            .editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                undefined,
                `❌ ${(e as Error).message}`,
                { parse_mode: 'HTML' }
            )
            .catch(() => {});
    }
});

// /discordbroadcast_status — admin sees configured target labels (no secrets)
bot.command('discordbroadcast_status', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const config = await tryLoadDiscordBroadcastConfig();
    if (!config) {
        return ctx.reply(
            'Discord broadcast: <b>not configured</b>\n\n' +
                'Set DISCORD_BOT_TOKEN, DISCORD_BROADCAST_TARGETS, or ' +
                '<code>data/discord-broadcast-targets.json</code>.',
            { parse_mode: 'HTML' }
        );
    }

    const desc = describeDiscordBroadcastTargets(config.targets);
    const lines = desc.labels.map((l, i) => `${i + 1}. ${l}`).join('\n');
    await ctx.reply(
        `📡 <b>Discord broadcast targets</b>\n\n` +
            `Total: <b>${desc.total}</b> (${desc.channelCount} bot channels · ${desc.webhookCount} webhooks)\n` +
            `Parallel: ${config.concurrency > 0 ? config.concurrency : 'all at once'}\n\n` +
            `${lines}`,
        { parse_mode: 'HTML' }
    );
});

// /announceversion — admin sends the current version's release notes once (uses ledger; no stale text)
bot.command('announceversion', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const preview = buildVersionAnnounceMessage(BOT_VERSION);
    if (!preview) {
        return ctx.reply(
            `❌ No release notes for <b>v${BOT_VERSION}</b>.\n\n` +
                `Add an entry in <code>src/bot/versionChangelog.ts</code> or set ` +
                `<code>VERSION_CHANGELOG</code> on Railway, then redeploy.`,
            { parse_mode: 'HTML' }
        );
    }

    if (await StateManager.hasVersionBeenAnnounced(BOT_VERSION)) {
        return ctx.reply(
            `ℹ️ <b>v${BOT_VERSION}</b> was already announced (ledger).\n\n` +
                `Use <code>/broadcast &lt;message&gt;</code> for a custom message, or bump <code>BOT_VERSION</code> for a new auto-release.`,
            { parse_mode: 'HTML' }
        );
    }

    const claimed = await StateManager.claimVersionAnnounce(BOT_VERSION);
    if (!claimed) {
        return ctx.reply(`ℹ️ <b>v${BOT_VERSION}</b> is already being announced or was claimed.`, { parse_mode: 'HTML' });
    }

    const statusMsg = await ctx.reply(`📡 Sending <b>v${BOT_VERSION}</b> release notes…`, { parse_mode: 'HTML' });
    const result = await broadcastToAll(preview, { parse_mode: 'HTML' });
    state.lastAnnouncedVersion = BOT_VERSION;
    await StateManager.save(state).catch(() => {});

    const summary =
        `✅ <b>v${BOT_VERSION}</b> announced\n\n` +
        `DMs: <b>${result.sent - (result.groupIncluded ? 1 : 0)}</b> · failed: <b>${result.failed}</b>`;
    ctx.telegram
        .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, summary, { parse_mode: 'HTML' })
        .catch(() => {});
});


async function sendMainMenu(ctx: any, isEdit = false) {
    const userId = ctx.from?.id.toString();
    const isAdminUser = userId === PERSONAL_ID;
    const walletCount = getUserWallets(userId || '').length;
    const personalWhales = (state.userTrackedAddresses?.[userId || ''] || []).length;
    const tp = getUserTrackingPrefs(state, userId || '');
    const followsGlobal = tp.alertGlobal || tp.autoMintGlobal;
    const whaleCount = isAdminUser
        ? (state.trackedAddresses?.length || 0)
        : personalWhales + (followsGlobal ? (state.trackedAddresses?.length || 0) : 0);
    const scheduledCount = (state.scheduledMints || []).filter(s => !s.fired && !s.missed).length;
    const blockMintCount = (state.blockMintJobs || []).filter(j => !j.fired && !j.cancelled).length;
    const stats = tracker?.getStats?.() || { wsConnected: false };

    const mempoolStatus = isAdminUser ? getMempoolPendingStatus(tracker) : null;
    const text = mainMenuText({
        trackerOn: !!tracker?.running,
        wsConnected: stats.wsConnected,
        autoMint: state.autoMint,
        mevProtection: state.mevProtection || inclusionModeFromState(state) === 'protected',
        overdrive: state.overdrive ?? false,
        walletCount,
        whaleCount,
        scheduledCount,
        blockMintCount: isAdminUser ? blockMintCount : undefined,
        mempoolHint:
            mempoolStatus && mempoolStatus.effective !== 'on' ? mempoolStatus.debugLine : undefined,
        version: BOT_VERSION,
    });
    const keyboard = mainMenuKeyboard(isAdminUser);

    if (isEdit) {
        ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } else {
        ctx.reply(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    }
}

// ------------------------------------------
// STATUS & ANALYTICS MENU
// ------------------------------------------
bot.action('menu_status', async (ctx) => {
    await sendStatusMenu(ctx, true);
});

async function sendStatusMenu(ctx: any, isEdit = false) {
    const userId = ctx.from?.id.toString() || '';
    const adminView = isAdminUserId(userId);
    const trackerRunning = tracker?.running;
    const stats = tracker?.getStats?.() || { wsConnected: false, wsReconnects: 0, blocksProcessed: 0, pendingTxsSeen: 0, mintsDetected: 0, duplicatesSkipped: 0, nonMintsRejected: 0 };
    const auto = state.autoMint ? '🟢 ARMED' : '🔴 OFF';
    const mev = inclusionModeShort(inclusionModeFromState(state));
    const overdrive = state.overdrive ? '🚀 4x GAS' : '🐢 Normal';
    const sim = state.skipSimulation ? '⚡ BLIND' : '🔍 Simulated';
    const bribe = parseFloat(state.gasBribeGwei || '0') > 0 ? `+${state.gasBribeGwei} GWEI` : 'Off';
    const totalWallets = Object.values(state.userWallets).reduce((acc, v) => acc + (typeof v === 'number' ? v : 0), 0);
    const myWalletCount = getUserWallets(userId).length;
    const personalWhales = (state.userTrackedAddresses?.[userId] || []).length;
    const tp = getUserTrackingPrefs(state, userId);
    const followsGlobal = tp.alertGlobal || tp.autoMintGlobal;
    const myWhaleCount = personalWhales + (followsGlobal ? (state.trackedAddresses?.length || 0) : 0);
    const detectionMode = stats.wsConnected ? '⚡ WebSocket (Pending)' : '📡 HTTP Block Polling';
    const engineStatus = CopyMintEngine.getStatus();
    const engine = engineStatus.panic
        ? '🛑 PANIC'
        : engineStatus.paused
          ? '⏸️ PAUSED'
          : '🟢 READY';

    const walletLine = adminView
        ? `Wallets: ${totalWallets} across ${Object.keys(state.userWallets).length} users\n`
        : `Your wallets: ${myWalletCount}\n`;
    const whaleLine = adminView
        ? `Tracked whales (global): ${state.trackedAddresses?.length || 0}\n`
        : `Whales you follow: ${myWhaleCount}\n`;

    const text = statusMenuText({
        detectionMode,
        trackerRunning: !!trackerRunning,
        blocksProcessed: stats.blocksProcessed,
        mintsDetected: stats.mintsDetected,
        engine,
        auto,
        mev,
        overdrive,
        sim,
        bribe,
        maxMint: `${state.maxMintLimit || '1.0'} ETH`,
        walletLine,
        whaleLine,
        ethSpent: botAnalytics.totalEthSpent.toFixed(4),
        tradesOk: botAnalytics.successfulTrades,
        tradesFail: botAnalytics.failedTrades,
    });

    const keyboard = statusMenuKeyboard();

    if (isEdit) {
        try {
            await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
            ctx.answerCbQuery('Refreshed!').catch(() => {});
        } catch { ctx.answerCbQuery().catch(() => {}); }
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
}

// ------------------------------------------
// SETTINGS MENU
// ------------------------------------------
// ------------------------------------------
// WHALE TRACKER MENU
// ------------------------------------------
bot.action('menu_tracker', async (ctx) => {
    const userId = ctx.from?.id.toString() || '';
    const adminView = isAdmin(ctx);
    const tracked = state.trackedAddresses || [];
    const personal = state.userTrackedAddresses?.[userId] || [];
    const prefs = getUserTrackingPrefs(state, userId);

    const audit = buildTrackingAudit(state, tracker);
    const unionCount = audit.unionCount;
    const watching = audit.trackerWatching;

    let addressPreview = '';
    if (adminView && tracked.length > 0) {
        addressPreview = tracked
            .slice(0, 6)
            .map((addr, i) => `${i + 1}. <code>${addr.slice(0, 8)}…${addr.slice(-4)}</code>`)
            .join('\n');
        if (tracked.length > 6) addressPreview += `\n<i>+${tracked.length - 6} more</i>`;
    } else if (!adminView && personal.length > 0) {
        addressPreview = personal
            .slice(0, 6)
            .map((addr, i) => `${i + 1}. <code>${addr.slice(0, 8)}…${addr.slice(-4)}</code>`)
            .join('\n');
        if (personal.length > 6) addressPreview += `\n<i>+${personal.length - 6} more</i>`;
    } else if (!adminView) {
        addressPreview = '<i>Global whales are admin-only — use /mytracks</i>';
    }

    const text = trackerMenuText({
        globalCount: tracked.length,
        personalCount: personal.length,
        prefsSummary: formatPrefsSummary(prefs),
        trackerRunning: audit.trackerRunning,
        watching,
        unionCount,
        syncWarning: audit.issues.includes('addresses_not_synced_to_tracker'),
        adminView,
        addressPreview,
    });
    const keyboard = trackerMenuKeyboard();
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

async function sendTrackingPrefsMenu(ctx: any, edit = true) {
    const userId = ctx.from?.id.toString() || '';
    const prefs = getUserTrackingPrefs(state, userId);
    const text = trackingPrefsMenuText(formatPrefsSummary(prefs));
    const keyboard = trackingPrefsMenuKeyboard(prefs);
    if (edit) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    }
}

bot.action('menu_tracking_prefs', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await sendTrackingPrefsMenu(ctx, true);
});

const TP_TOGGLE_MAP: Record<string, keyof UserTrackingPrefs> = {
    tp_ap: 'alertPersonal',
    tp_ag: 'alertGlobal',
    tp_ac: 'alertCommunity',
    tp_mp: 'autoMintPersonal',
    tp_mg: 'autoMintGlobal',
    tp_mc: 'autoMintCommunity',
};

for (const [action, key] of Object.entries(TP_TOGGLE_MAP)) {
    bot.action(action, async (ctx) => {
        const userId = ctx.from?.id.toString();
        if (!userId) return;
        const cur = getUserTrackingPrefs(state, userId);
        applyUserTrackingPrefs(state, userId, { [key]: !cur[key] });
        await persistUserTrackingPrefs(userId, getUserTrackingPrefs(state, userId));
        await ctx.answerCbQuery().catch(() => {});
        await sendTrackingPrefsMenu(ctx, true);
    });
}

bot.action('tp_preset_personal', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    applyUserTrackingPrefs(state, userId, TRACKING_PRESET_PERSONAL_ONLY);
    await persistUserTrackingPrefs(userId, getUserTrackingPrefs(state, userId));
    await ctx.answerCbQuery('Personal list only').catch(() => {});
    await sendTrackingPrefsMenu(ctx, true);
});

bot.action('tp_preset_global', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    applyUserTrackingPrefs(state, userId, TRACKING_PRESET_GLOBAL_AND_PERSONAL);
    await persistUserTrackingPrefs(userId, getUserTrackingPrefs(state, userId));
    await ctx.answerCbQuery('Global + personal').catch(() => {});
    await sendTrackingPrefsMenu(ctx, true);
});

bot.action('tp_preset_all', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    applyUserTrackingPrefs(state, userId, TRACKING_PRESET_ALL_SOURCES);
    await persistUserTrackingPrefs(userId, getUserTrackingPrefs(state, userId));
    await ctx.answerCbQuery('All sources').catch(() => {});
    await sendTrackingPrefsMenu(ctx, true);
});

bot.action('tp_preset_alerts', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    applyUserTrackingPrefs(state, userId, TRACKING_PRESET_ALERTS_ONLY_PERSONAL);
    await persistUserTrackingPrefs(userId, getUserTrackingPrefs(state, userId));
    await ctx.answerCbQuery('Track only — no auto-mint').catch(() => {});
    await sendTrackingPrefsMenu(ctx, true);
});

bot.action('tp_pay', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const cur = getUserTrackingPrefs(state, userId);
    const next = cur.copyMintPaymentFilter === 'free_only' ? 'all' : 'free_only';
    applyUserTrackingPrefs(state, userId, { copyMintPaymentFilter: next });
    await persistUserTrackingPrefs(userId, getUserTrackingPrefs(state, userId));
    await ctx
        .answerCbQuery(next === 'free_only' ? 'Free mints only' : 'Free + paid mints')
        .catch(() => {});
    await sendTrackingPrefsMenu(ctx, true);
});

// ------------------------------------------
// EXECUTIONS MENU
// ------------------------------------------
bot.action('menu_executions', async (ctx) => {
    const text = executionsMenuText(recentCopyTrades, {
        ok: botAnalytics.successfulTrades,
        fail: botAnalytics.failedTrades,
        eth: botAnalytics.totalEthSpent.toFixed(4),
    });
    const keyboard = executionsMenuKeyboard();
    ctx.editMessageText(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...keyboard }).catch(
        () => {}
    );
});

// ------------------------------------------
// RPC HEALTH MENU
// ------------------------------------------
bot.action('menu_rpc', async (ctx) => {
    const userId = ctx.from?.id.toString() || '';
    await ctx.answerCbQuery('Measuring latency…').catch(() => {});

    const fallbackKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'menu_rpc'), Markup.button.callback('⬅️ Main Menu', 'menu_main')],
    ]);

    try {
        const body = await buildRpcStatusHtml(userId);
        const isAdminUser = ctx.from?.id.toString() === PERSONAL_ID;
        const text = body + (isAdminUser ? rpcMenuAdminFooter() : `\n\n<b>Admin:</b> <code>/chain &lt;url&gt;</code> — global RPC`);
        const adminRpcRow = isAdminUser
            ? [
                  Markup.button.callback('🧹 Free RPC', 'action_freerpc'),
                  Markup.button.callback('📊 RPC queue', 'action_freerpc_status'),
              ]
            : null;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'menu_rpc'), Markup.button.callback('🔄 Reset My RPC', 'action_reset_rpc')],
            ...(adminRpcRow ? [adminRpcRow] : []),
            [Markup.button.callback('⬅️ Main Menu', 'menu_main')],
        ]);
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } catch {
        await ctx
            .editMessageText('❌ RPC probe failed. Try <code>/rpc</code> again.', { parse_mode: 'HTML', ...fallbackKeyboard })
            .catch(() => {});
    }
});

async function sendEmergencyMenu(ctx: any, isEdit = true): Promise<void> {
    const scheduledCount = (state.scheduledMints || []).filter(s => !s.fired && !s.missed).length;
    const blockMintCount = (state.blockMintJobs || []).filter(j => !j.fired && !j.cancelled).length;
    const text = emergencyMenuText({
        autoMint: state.autoMint,
        trackerRunning: !!tracker?.running,
        scheduledCount,
        blockMintCount,
        mempoolLabel: getMempoolPendingStatus(tracker).menuLabel,
    });
    const keyboard = emergencyMenuKeyboard();
    if (isEdit) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    }
}

// ------------------------------------------
// EMERGENCY MENU (Admin only)
// ------------------------------------------
bot.action('menu_emergency', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    await sendEmergencyMenu(ctx, true);
});

// ------------------------------------------
// CAPACITY MENU (Admin only)
// ------------------------------------------
bot.action('menu_capacity', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
    await sendCapacityMenu(ctx, true);
});

bot.action('cap_toggle_stream', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    toggleCapacityOverride('streamBroadcast');
    state.capacityOverrides = capacityOverridesForState();
    await StateManager.save(state);
    await ctx.answerCbQuery(`Stream #1: ${effectiveStreamBroadcast() ? 'ON' : 'OFF'}`).catch(() => {});
    await sendCapacityMenu(ctx, true);
});

bot.action('cap_toggle_fastpreflight', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    toggleCapacityOverride('skipRpcPreflight');
    state.capacityOverrides = capacityOverridesForState();
    await StateManager.save(state);
    await ctx.answerCbQuery(`Fast preflight: ${effectiveSkipRpcPreflight() ? 'ON' : 'OFF'}`).catch(() => {});
    await sendCapacityMenu(ctx, true);
});

bot.action('cap_toggle_automint', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    state.autoMint = !state.autoMint;
    await StateManager.save(state);
    await ctx.answerCbQuery(`Auto-mint: ${state.autoMint ? 'ON' : 'OFF'}`).catch(() => {});
    await sendCapacityMenu(ctx, true);
});

bot.action('cap_toggle_mempool', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    const mp = getMempoolPendingStatus(tracker);
    if (mp.effective === 'paused') {
        tracker?.resumePendingDetection();
        await ctx.answerCbQuery('Mempool pending resumed').catch(() => {});
    } else if (mp.effective === 'on') {
        tracker?.pausePendingDetection();
        await ctx.answerCbQuery('Mempool pending paused').catch(() => {});
    } else {
        await ctx
            .answerCbQuery('Mempool unavailable — set WS_RPC_URL in Railway', { show_alert: true })
            .catch(() => {});
    }
    await sendCapacityMenu(ctx, true);
});

bot.action(/^cap_help_/, async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    const data = (ctx.callbackQuery as { data?: string })?.data || '';
    const section = parseCapacityHelpCallback(data);
    if (!section) return;
    const text = capacityHelpContent(section);
    const keyboard =
        section === 'exec' || section === 'detect' || section === 'retry'
            ? capacityHelpKeyboard(section)
            : capacityItemHelpKeyboard(section as CapacityHelpItem);
    await ctx.answerCbQuery().catch(() => {});
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

// ------------------------------------------
// HELP MENU
// ------------------------------------------
bot.action('menu_help', async (ctx) => {
    const adminHelp = isAdmin(ctx)
        ? `<code>/exportseed</code> — View env MNEMONIC (admin DM)\n` +
          `<code>/clearseed</code> — Purge stored seed + reset admin fleet (admin)\n`
        : '';
    const text =
        `❓ <b>QUICK REFERENCE</b>\n\n` +
        `<b>━━ Minting ━━</b>\n` +
        `<code>/dropmint</code> — Schedule a drop mint\n` +
        `<code>/blockmint</code> — Mint at target block (OEGP / per-block caps)\n` +
        `<code>/mint</code> — Manual batch mint\n` +
        `<code>/custommint</code> — Advanced mint builder\n` +
        `<code>/scheduled</code> — View pending drops\n\n` +
        `<b>━━ Tracking ━━</b>\n` +
        `<code>/track 0x...</code> — Add whale to your list\n` +
        `<code>/untrack 0x...</code> — Remove whale\n` +
        `<code>/globaltrack 0x...</code> — Add to global (admin)\n` +
        `<code>/mytracks</code> — View your tracked whales\n` +
        `<code>/trackingprefs</code> — Alert/auto-mint sources + free vs paid copy-mint\n` +
        `<code>/followglobal</code> — Quick global on/off\n` +
        `<code>/clearpersonaltracks</code> — Clear user personal tracks (admin)\n` +
        `<code>/cleartrack</code> — Clear global + personal tracks (admin)\n\n` +
        `<b>━━ Wallets ━━</b>\n` +
        `<code>/wallets</code> — View & manage wallets\n` +
        `<code>/compromised N</code> — Mark drained wallet (no mint)\n` +
        `<code>/wallet N</code> — Export wallet #N key\n` +
        `<code>/distribute</code> — Split ETH to sub-wallets\n` +
        `<code>/sweep</code> — Collect ETH to wallet #1 (not into ☠️ wallets)\n` +
        `<code>/importwallet</code> — Import external key\n` +
        adminHelp +
        `<b>━━ Engine ━━</b>\n` +
        `<code>/automint on|off</code> — Toggle auto-mint\n` +
        `<code>/forcesim</code> — Toggle simulation\n` +
        `<code>/overdrive</code> — Toggle 4x gas\n` +
        `<code>/bribe</code> — Set gas priority tip\n` +
        `<code>/maxmint</code> — Set ETH cap\n` +
        `<code>/inclusion</code> — Route: public | protected | builder\n` +
        `<code>/mev</code> — Legacy protected toggle\n\n` +
        `<b>━━ System ━━</b>\n` +
        `<code>/status</code> — Full engine status\n` +
        `<code>/rpc</code> — RPC health\n` +
        `<code>/execution</code> — Recent trades\n` +
        `<code>/pause</code> / <code>/resume</code> / <code>/kill</code> — Emergency\n` +
        (isAdmin(ctx)
            ? `<code>/freerpc</code> — Clear all scheduled + block snipes; pause mempool\n` +
              `<code>/freerpc resume</code> · <code>/freerpc status</code>\n`
            : '') +
        `<code>/version</code> — Bot info`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📖 Guide', 'guide_overview'), Markup.button.callback('📊 Status', 'menu_status')],
        [Markup.button.callback('🎯 Mint', 'menu_drops'), Markup.button.callback('🐋 Tracker', 'menu_tracker')],
        [Markup.button.callback('« Home', 'menu_main')]
    ]);

    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

// ------------------------------------------
// VERSION MENU
// ------------------------------------------
bot.action('menu_version', async (ctx) => {
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const mongoStatus = StateManager.isConnected() ? '🟢 Connected' : '🔴 Disconnected';
    const trackerState = tracker?.running ? '🟢 Running' : '🔴 Stopped';
    const stats = tracker?.getStats?.() || { wsConnected: false, wsReconnects: 0, mintsDetected: 0 };

    const releaseNotes = getVersionChangelogBody(BOT_VERSION);
    const whatsNew = releaseNotes
        ? `\n<b>What&apos;s new</b>\n${releaseNotes.slice(0, 420)}${releaseNotes.length > 420 ? '…' : ''}\n`
        : '';

    const text =
        `ℹ️ <b>SYSTEM INFO</b>\n\n` +
        `<b>Version:</b> v${BOT_VERSION}\n` +
        whatsNew +
        `<b>Uptime:</b> ${hours}h ${mins}m\n` +
        `<b>Runtime:</b> Node ${process.version}\n` +
        `<b>Platform:</b> Railway\n\n` +
        `<b>Services:</b>\n` +
        `• Tracker: ${trackerState}\n` +
        `• Database: ${mongoStatus}\n` +
        `• WebSocket: ${stats.wsConnected ? '⚡ Connected' : '📡 HTTP fallback'}\n` +
        `• Mints detected: ${stats.mintsDetected}\n` +
        `• WS reconnects: ${stats.wsReconnects}`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'menu_version')],
        [Markup.button.callback('⬅️ Main Menu', 'menu_main')]
    ]);

    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

// ------------------------------------------
// DROP & MINT COMMANDER MENU
// ------------------------------------------
bot.action('menu_drops', async (ctx) => {
    const isAdminUser = ctx.from?.id.toString() === PERSONAL_ID;
    const scheduledCount = (state.scheduledMints || []).filter(s => !s.fired && !s.missed).length;
    const blockMintCount = (state.blockMintJobs || []).filter(j => !j.fired && !j.cancelled).length;
    const text = mintCommanderText({
        scheduledCount,
        blockMintCount: isAdminUser ? blockMintCount : undefined,
        isAdmin: isAdminUser,
    });
    const keyboard = mintCommanderKeyboard(isAdminUser);
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

bot.action('explain_drops', async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Back to Commander', 'menu_drops')]
    ]);
    ctx.editMessageText(formatDropMintExplainText(), { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

bot.action('action_list_scheduled', async (ctx) => {
    const userId = ctx.from?.id.toString();
    const msg = formatActiveScheduledDropsList(state, {
        userId,
        adminUserId: PERSONAL_ID,
    });
    if (!msg) return ctx.answerCbQuery('No active drops scheduled.', { show_alert: true });

    let fullMsg = msg;
    if (userId === PERSONAL_ID) {
        fullMsg += `\n\nAdmin: <code>/freerpc</code> cancels <i>all</i> scheduled + block snipes.`;
    }

    const backRow = [Markup.button.callback('⬅️ Back to Commander', 'menu_drops')];
    const keyboard = Markup.inlineKeyboard(
        ctx.from?.id.toString() === PERSONAL_ID
            ? [[Markup.button.callback('🧹 Free RPC', 'action_freerpc')], backRow]
            : [backRow]
    );

    ctx.editMessageText(fullMsg, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

bot.action('action_clear_fired', async (ctx) => {
    const count = (state.scheduledMints || []).filter(s => s.fired).length;
    if (count === 0) return ctx.answerCbQuery('No fired drops to clear.', { show_alert: true });

    state.scheduledMints = (state.scheduledMints || []).filter(s => !s.fired);
    await StateManager.save(state);
    ctx.answerCbQuery(`Cleared ${count} past drops.`);
    bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'menu_drops' } } as any);
});

// ------------------------------------------
// CUSTOM MINT HUB
// ------------------------------------------
bot.action('menu_custommint', async (ctx) => {
    const text =
        `🔧 <b>Custom Mint Builder</b>\n\n` +
        `For contracts with complex or non-standard minting flows that the whale copy-trade engine can't auto-detect.\n\n` +
        `<b>Available Modes:</b>\n\n` +
        `🎫 <b>Token ID Mint</b> — specify exact NFT ID\n` +
        `<code>/custommint 0xContractAddr 0.08 tokenid 4231</code>\n\n` +
        `🔑 <b>Allowlist Proof Mint</b> — Merkle proof gated\n` +
        `<code>/custommint 0xAddr 0.08 allowlist 0xProof1,0xProof2</code>\n\n` +
        `📅 <b>Phased Mint</b> — phase ID selector\n` +
        `<code>/custommint 0xAddr 0.08 phase 2</code>\n\n` +
        `👤 <b>Recipient Mint</b> — specify destination\n` +
        `<code>/custommint 0xAddr 0 recipient 0xYourAddr</code>\n\n` +
        `📝 <b>Custom ABI Signature</b> (Advanced)\n` +
        `<code>/custommint 0xAddr 0.08 sig "claim(uint256,address)" 5,0xAddr</code>\n\n` +
        `🔩 <b>Raw Hex Payload</b> — bypass all encoding\n` +
        `<code>/custommint 0xAddr 0.08 raw 0xa0712d68...</code>`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🎫 Token ID Mode', 'help_custommint_tokenid'), Markup.button.callback('🔑 Allowlist Mode', 'help_custommint_allowlist')],
        [Markup.button.callback('📅 Phase Mode', 'help_custommint_phase'), Markup.button.callback('👤 Recipient Mode', 'help_custommint_recipient')],
        [Markup.button.callback('📝 Custom Sig Mode', 'help_custommint_sig'), Markup.button.callback('🔩 Raw Hex Mode', 'help_custommint_raw')],
        [Markup.button.callback('🎯 Drop Mint', 'menu_drops'), Markup.button.callback('⬅️ Main Menu', 'menu_main')]
    ]);

    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => { });
});

// Quick-copy hint alerts for each custom mint mode
const CUSTOMMINT_HINTS: Record<string, string> = {
    'help_custommint_tokenid':    'Usage: /custommint 0xContract 0.08 tokenid <NFT_ID>\nExample: /custommint 0xABC 0.05 tokenid 4231',
    'help_custommint_allowlist':  'Usage: /custommint 0xContract 0.08 allowlist <proof1,proof2,...>\nExample: /custommint 0xABC 0.08 allowlist 0xabc...,0xdef...',
    'help_custommint_phase':      'Usage: /custommint 0xContract 0.08 phase <phase_id>\nExample: /custommint 0xABC 0.08 phase 2',
    'help_custommint_recipient':  'Usage: /custommint 0xContract 0 recipient <wallet_address>\nExample: /custommint 0xABC 0 recipient 0xYourWallet',
    'help_custommint_sig':        'Usage: /custommint 0xContract 0.08 sig "funcName(types)" arg1,arg2\nExample: /custommint 0xABC 0.08 sig "claim(uint256,address)" 5,0xWallet',
    'help_custommint_raw':        'Usage: /custommint 0xContract 0.08 raw 0xYourHexData\nExample: /custommint 0xABC 0.08 raw 0xa0712d68000...'
};

Object.entries(CUSTOMMINT_HINTS).forEach(([action, hint]) => {
    bot.action(action, async (ctx) => {
        ctx.answerCbQuery(hint, { show_alert: true });
    });
});

// ------------------------------------------
// WALLET & FUNDS HUB
// ------------------------------------------
bot.action('menu_wallets', async (ctx) => {
    const userId = ctx.from?.id.toString();
    const wallets = getUserWallets(userId || '');
    const importedCount = (state.importedWallets?.[userId || ''] || []).length;
    
    const currentRpc = state.userRPCs?.[userId || ''] ? 'Custom' : 'System Default';
    
    const text = walletsMenuText({
        walletCount: wallets.length,
        importedCount,
        rpcLabel: currentRpc,
    });
    const keyboard = walletsMenuKeyboard();
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

bot.action(/^adj_wallets_([+-]\d+)$/, async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    
    const delta = parseInt(ctx.match[1]);
    const current = typeof state.userWallets[userId] === 'number' ? state.userWallets[userId] : 0;
    
    let next = current + delta;
    const importedCount = state.importedWallets?.[userId]?.length ?? 0;
    const minHd = importedCount > 0 ? 0 : 1;
    if (next < minHd) next = minHd;
    if (next > 50) {
        ctx.answerCbQuery('Max 50 wallets per user to prevent RPC rate limits.', { show_alert: true });
        next = 50;
    }

    state.userWallets[userId] = next;
    if (next < current) {
        trimWalletLabels(state, userId, next);
        if (state.userHdWalletExcluded?.[userId]) {
            const pruned = state.userHdWalletExcluded[userId].filter(i => i < next);
            if (pruned.length === 0) delete state.userHdWalletExcluded[userId];
            else state.userHdWalletExcluded[userId] = pruned;
        }
    }
    await flushSave(state);
    await saveUserState(userId);

    const active = getUserWallets(userId).length;
    ctx.answerCbQuery(`Fleet: ${active} active wallet(s).`);
    // Force refresh the menu
    bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'menu_wallets' } } as any);
});

bot.action('action_confirm_sweep', async (ctx) => {
    const text = `⚠️ <b>Confirm Global Sweep</b>\n\nThis will transfer ALL ETH from your sub-wallets back to your primary Wallet #1.\n\nAre you sure you want to proceed?`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yes, Proceed', 'run_sweep'), Markup.button.callback('❌ Cancel', 'menu_wallets')]
    ]);
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => { });
});

bot.action('action_prompt_rpc', async (ctx) => {
    ctx.answerCbQuery('Use the command: /setrpc <your_rpc_url>', { show_alert: true });
});

bot.action('action_reset_rpc', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    if (state.userRPCs) delete state.userRPCs[userId];
    await StateManager.save(state);
    await saveUserState(userId);
    ctx.answerCbQuery('RPC reset to system default.');
    // Refresh menu
    bot.handleUpdate({ ...(ctx.update as any), callback_query: { ...(ctx.callbackQuery as any), data: 'menu_wallets' } } as any);
});

bot.action('run_sweep', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    await ctx.answerCbQuery('Starting sweep…').catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    void triggerTurboSweepForUser(ctx, userId);
});

bot.action('action_confirm_distribute', async (ctx) => {
    const text = `⚖️ <b>ETH Distribution</b>\n\nSelect a preset to split from Wallet #1 to all sub-wallets:`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('0.05 ETH Each', 'dist_0.05'), Markup.button.callback('0.1 ETH Each', 'dist_0.1')],
        [Markup.button.callback('All Balance (Evenly)', 'dist_all')],
        [Markup.button.callback('⬅️ Back', 'menu_wallets')]
    ]);
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => { });
});

['0.05', '0.1', 'all'].forEach(val => {
    bot.action(`dist_${val}`, async (ctx) => {
        ctx.deleteMessage().catch(() => {});
        bot.handleUpdate({ ...(ctx.update as any), message: { ...(ctx.message as any), text: `/distribute ${val}` } } as any);
    });
});

// ------------------------------------------
// CONFIGURATION SETTINGS MENU
// ------------------------------------------
bot.action('menu_settings', async (ctx) => {
    const auto = state.autoMint ? '🟢 ON' : '🔴 OFF';
    const mev = inclusionModeShort(inclusionModeFromState(state));
    const skip = state.skipSimulation ? '⚡ BLIND' : '🔍 SIM';
    const overdrive = state.overdrive ? '🚀 400%' : '🐢 NORMAL';
    const bribe = parseFloat(state.gasBribeGwei || '0') > 0 ? `⚡ +${state.gasBribeGwei} GWEI` : '🔴 OFF';
    const maxMint = `${state.maxMintLimit || '1.0'} ETH`;
    const rpcMode = state.providerUrl ? new URL(state.providerUrl.split(',')[0]).hostname.split('.')[0] : 'None';

    const text = settingsMenuText({
        auto,
        mev,
        bribe,
        overdrive,
        skip,
        maxMint,
        rpcHost: rpcMode,
    });
    const isAdminUser = ctx.from?.id.toString() === PERSONAL_ID;
    const keyboard = settingsMenuKeyboard({ auto, mev, bribe, overdrive, skip, maxMint }, isAdminUser);
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
});

// ------------------------------------------
// SECURITY & ADMIN HUB
// ------------------------------------------
bot.action('menu_security', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!');

    const isLocked = state.accessCode ? '🟢 Locked' : '🔴 Public';
    const code = state.accessCode || 'None';
    const userCount = state.unlockedUsers?.length || 0;

    const text = `🔐 <b>Security & Admin Hub</b>\n\n` +
                 `<b>Bot Status</b>: ${isLocked}\n` +
                 `<b>Access Code</b>: <code>${code}</code>\n` +
                 `<b>Verified Users</b>: ${userCount}\n\n` +
                 `Manage entry gates and global announcements.`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👥 List Users', 'action_list_users'), Markup.button.callback('📢 Broadcast', 'action_prompt_broadcast')],
        [Markup.button.callback(state.accessCode ? '🔓 Remove Lock' : '🔐 Set Lock', 'action_toggle_lock')],
        [Markup.button.callback('🚨 Emergency', 'menu_emergency'), Markup.button.callback('⚙️ Config', 'menu_settings')],
        [Markup.button.callback('⬅️ Main Menu', 'menu_main')]
    ]);

    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => { });
});

bot.action('action_list_users', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return;
    const users = state.unlockedUsers || [];
    if (users.length === 0) return ctx.answerCbQuery('No verified users.', { show_alert: true });
    
    const list = users.map((id, i) => `${i + 1}. <code>${id}</code>`).join('\n');
    const text = `👥 <b>Verified Users (${users.length})</b>\n\n${list}\n\nUse <code>/lockuser <id></code> to revoke.`;
    
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Security', 'menu_security')]]);
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => { });
});

bot.action('action_prompt_broadcast', async (ctx) => {
    ctx.answerCbQuery('Use the command: /broadcast <message>', { show_alert: true });
});

bot.action('action_toggle_lock', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!');
    if (state.accessCode) {
        state.accessCode = undefined;
        await StateManager.save(state);
        ctx.answerCbQuery('Bot is now PUBLIC.');
    } else {
        ctx.answerCbQuery('Use /setcode <key> to enable lock.', { show_alert: true });
    }
    bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'menu_security' } } as any);
});

// ------------------------------------------
// SHARED NAVIGATION & TOGGLE ACTIONS
// ------------------------------------------
bot.action('menu_main', async (ctx) => {
    await sendMainMenu(ctx, true);
});

bot.action('action_view_wallets', async (ctx) => {
    ctx.deleteMessage().catch(() => {});
    bot.handleUpdate({ ...(ctx.update as any), message: { ...(ctx.message as any), text: '/wallets' } } as any);
});

bot.action('action_toggle_automint', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    state.autoMint = !state.autoMint;
    await StateManager.save(state);
    ctx.answerCbQuery(`Auto-Mint: ${state.autoMint ? 'ENABLED' : 'DISABLED'}`);
    bot.handleUpdate({ ...(ctx.update as any), callback_query: { ...(ctx.callbackQuery as any), data: 'menu_settings' } } as any);
});

// Emergency controls (inline buttons from status menu)
bot.action('action_pause', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    CopyMintEngine.pause();
    state.autoMint = false;
    await StateManager.save(state);
    ctx.answerCbQuery('⏸️ Auto-mint paused!');
    await sendStatusMenu(ctx, true);
});

bot.action('action_resume', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    CopyMintEngine.resume();
    state.autoMint = true;
    await StateManager.save(state);
    if (!tracker) startTracker();
    else syncTracker();
    if (tracker?.running) tracker.resumePendingDetection();
    ctx.answerCbQuery('▶️ Resumed — panic cleared');
    const msg = ctx.callbackQuery?.message;
    const fromEmergency =
        msg &&
        'text' in msg &&
        typeof (msg as { text?: string }).text === 'string' &&
        (msg as { text: string }).text.includes('EMERGENCY');
    if (fromEmergency) await sendEmergencyMenu(ctx, true);
    else await sendStatusMenu(ctx, true);
});

bot.action('action_kill', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    CopyMintEngine.panic();
    state.autoMint = false;
    if (tracker) { tracker.stop(); tracker = null; }
    await StateManager.save(state);
    ctx.answerCbQuery('🛑 Kill switch activated!');
    await sendStatusMenu(ctx, true);
});

bot.action('action_freerpc', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    const result = clearRpcLoad({ schedulerHandles, state, tracker });
    await StateManager.save(state);
    const alertDest = state.alertChatId || GROUP_ID;
    await safeSendTelegram(
        alertDest,
        `🧹 <b>RPC relief</b> (menu)\n\n` +
            `• Scheduled cleared: <b>${result.scheduledCancelled}</b>\n` +
            `• Block snipes cleared: <b>${result.blockMintsCancelled}</b>\n` +
            `• Mempool pending: <b>${result.pendingPaused ? 'paused' : 'unchanged'}</b>`,
        { parse_mode: 'HTML' }
    ).catch(() => {});
    ctx.answerCbQuery(
        `Cleared ${result.scheduledCancelled} drop(s), ${result.blockMintsCancelled} block(s)`,
        { show_alert: true }
    );
    await sendEmergencyMenu(ctx, true).catch(() => sendMainMenu(ctx, true));
});

bot.action('action_freerpc_resume', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    const resumed = tracker?.running ? tracker.resumePendingDetection() : false;
    const after = getMempoolPendingStatus(tracker);
    ctx.answerCbQuery(
        resumed
            ? 'Mempool pending resumed'
            : after.effective === 'on'
              ? 'Already ON'
              : after.debugLine,
        { show_alert: true }
    );
    await sendEmergencyMenu(ctx, true);
});

bot.action('action_freerpc_status', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    const snap = formatRpcLoadStatus(state, tracker);
    ctx.answerCbQuery(snap.replace(/<[^>]+>/g, ''), { show_alert: true });
});

bot.action('action_toggle_mev', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    const mode = inclusionModeFromState(state);
    if (mode === 'protected') {
        state.inclusionMode = 'public';
        state.mevProtection = false;
    } else {
        state.inclusionMode = 'protected';
        state.mevProtection = true;
    }
    await StateManager.save(state);
    ctx.answerCbQuery(inclusionModeShort(inclusionModeFromState(state)));
    bot.handleUpdate({ ...(ctx.update as any), callback_query: { ...(ctx.callbackQuery as any), data: 'menu_settings' } } as any);
});

bot.action('action_toggle_sim', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    state.skipSimulation = !state.skipSimulation;
    await StateManager.save(state);
    ctx.answerCbQuery(`Simulation: ${state.skipSimulation ? 'BLIND (skip)' : 'ENABLED (safe)'}`);
    bot.handleUpdate({ ...(ctx.update as any), callback_query: { ...(ctx.callbackQuery as any), data: 'menu_settings' } } as any);
});

bot.action('action_toggle_overdrive', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
    state.overdrive = !state.overdrive;
    await StateManager.save(state);
    ctx.answerCbQuery(`Overdrive: ${state.overdrive ? '🚀 400% GAS ACTIVE' : '🐢 Normal mode'}`);
    bot.handleUpdate({ ...(ctx.update as any), callback_query: { ...(ctx.callbackQuery as any), data: 'menu_settings' } } as any);
});

bot.action('menu_bribe', async (ctx) => {
    const text = `⚡ <b>Set Gas Bribe (GWEI)</b>\nSelect an aggressive preset below to front-run other buyers. Current: ${state.gasBribeGwei || '0'}`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('0 (Off)', 'set_bribe_0'), Markup.button.callback('+2 Gwei', 'set_bribe_2')],
        [Markup.button.callback('+5 Gwei', 'set_bribe_5'), Markup.button.callback('+10 Gwei', 'set_bribe_10'), Markup.button.callback('+25 Gwei', 'set_bribe_25')],
        [Markup.button.callback('⬅️ Back to Settings', 'menu_settings')]
    ]);
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => { });
});

['0', '2', '5', '10', '25'].forEach(val => {
    bot.action(`set_bribe_${val}`, async (ctx) => {
        if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
        state.gasBribeGwei = val;
        await StateManager.save(state);
        ctx.answerCbQuery(`Bribe set to +${val} GWEI`);
        bot.handleUpdate({ ...(ctx.update as any), callback_query: { ...(ctx.callbackQuery as any), data: 'menu_settings' } } as any);
    });
});

bot.action('menu_maxmint', async (ctx) => {
    const text = `💸 <b>Set Max Mint Limit (ETH)</b>\nPrevent wallet drains. Select a hard cap for transactions. Current: ${state.maxMintLimit || '1.0'} ETH`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('0.05 ETH', 'set_max_0.05'), Markup.button.callback('0.10 ETH', 'set_max_0.10')],
        [Markup.button.callback('0.25 ETH', 'set_max_0.25'), Markup.button.callback('0.50 ETH', 'set_max_0.50'), Markup.button.callback('1.0 ETH', 'set_max_1.0')],
        [Markup.button.callback('⬅️ Back to Settings', 'menu_settings')]
    ]);
    ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => { });
});

['0.05', '0.10', '0.25', '0.50', '1.0'].forEach(val => {
    bot.action(`set_max_${val}`, async (ctx) => {
        if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.answerCbQuery('Admin only!', { show_alert: true });
        state.maxMintLimit = val;
        await StateManager.save(state);
        ctx.answerCbQuery(`Max limit set to ${val} ETH`);
        bot.handleUpdate({ ...(ctx.update as any), callback_query: { ...(ctx.callbackQuery as any), data: 'menu_settings' } } as any);
    });
});



bot.command('exportwallets', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    if (ctx.chat.type !== 'private') {
        const msg = await ctx.reply('🔒 <b>SECURITY WARNING</b>\nYou can only use `/exportwallets` in a Direct Message to the bot, not in a group!');
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => { }), 10000);
        return;
    }

    const count = typeof state.userWallets[userId] === 'number' ? state.userWallets[userId] : (Array.isArray(state.userWallets[userId]) ? (state.userWallets[userId] as any[]).length : 0);

    if (count === 0) {
        return ctx.reply('You do not have any registered wallets to export.');
    }

    const wallets = getUserWallets(userId);
    let exportText = `🔑 <b>YOUR EXPORTED WALLETS</b>\n<i>Keep these very safe. Anyone with these keys controls your funds.</i>\n\n`;

    wallets.forEach((w, index) => {
        exportText += `<b>Wallet #${index + 1}</b>\n`;
        exportText += `Public: <code>${w.address}</code>\n`;
        exportText += `Private: <code>${w.privateKey}</code>\n\n`;
    });

    await ctx.reply(exportText, { parse_mode: 'HTML' });
});

bot.command('wallets', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    let myWallets = getUserWallets(userId);
    const args = ctx.message.text.split(' ');


    // Auto-Discovery flag: /wallets auto
    if (args[1] === 'auto' || myWallets.length === 0) {
        const mnemonic = getBotMnemonic();
        if (!mnemonic) {
            return ctx.reply(
                '❌ <b>No master seed configured</b>\n\n' +
                    'Set <code>MNEMONIC</code> in Railway/host env (12 or 24 words), redeploy, then <code>/wallets N</code>.\n' +
                    '<i>The bot no longer generates or stores seed phrases in saved state.</i>',
                { parse_mode: 'HTML' }
            );
        }

        const msg = await ctx.reply('🔍 <b>Scanning Blockchain...</b>\nSearching your HD derivation path for historically active wallets. This may take a few seconds...', { parse_mode: 'HTML' });

        try {
            const provider = getUserProvider(userId);
            const accountIndex = Number(BigInt(userId) % 2147483647n);

            // Scan up to depth 25 to find the highest used wallet
            const highestActive = await findHighestActiveWalletIndex(
                mnemonic,
                accountIndex,
                0,
                25,
                provider as JsonRpcProvider
            );

            // If highest active is 3, we need to generate 4 wallets (indices 0, 1, 2, 3)
            // If none found (-1), default to 1 wallet.
            const newCount = highestActive >= 0 ? highestActive + 1 : 1;

            state.userWallets[userId] = newCount;
            await StateManager.save(state);
            await saveUserState(userId);
            myWallets = getUserWallets(userId);

            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `✅ <b>Discovery Complete</b>\nFound active history up to Wallet #${highestActive + 1}. Auto-generated ${newCount} wallets to cover your active paths.`, { parse_mode: 'HTML' });
        } catch (e: any) {
            await ctx.reply(`❌ Auto-discovery failed: ${e.message}`);
            if (myWallets.length === 0) {
                state.userWallets[userId] = 1;
                await StateManager.save(state);
                await saveUserState(userId);
                myWallets = getUserWallets(userId);
            }
        }
    } else if (args[1] && !isNaN(parseInt(args[1]))) {
        // Check if user passed a custom count (e.g. /wallets 5)
        let newCount = parseInt(args[1]);
        if (newCount > 50) return ctx.reply('Max supported sub-wallets is 50 to prevent RPC rate limits.');
        if (newCount < 0) newCount = 0;

        state.userWallets[userId] = newCount;
        trimWalletLabels(state, userId, newCount);
        if (state.userHdWalletExcluded?.[userId]) {
            const pruned = state.userHdWalletExcluded[userId].filter(i => i < newCount);
            if (pruned.length === 0) delete state.userHdWalletExcluded[userId];
            else state.userHdWalletExcluded[userId] = pruned;
        }
        await flushSave(state);
        await saveUserState(userId);
        myWallets = getUserWallets(userId);
        ctx.reply(
            `✅ <b>Wallet Count Updated</b>\nYou now have <b>${myWallets.length}</b> active sub-wallet(s).`,
            { parse_mode: 'HTML' }
        );
    } else if (myWallets.length === 0) {
        // First time user initialization - 1 wallet default
        state.userWallets[userId] = 1;
        await StateManager.save(state);
        await saveUserState(userId);
        myWallets = getUserWallets(userId);
        ctx.reply(`Welcome! I've automatically created your first secure sub-wallet inside this chat.`);
    }

    try {
        const provider = getUserProvider(userId) as JsonRpcProvider;
        myWallets = await getBalances(provider, myWallets);
        await ctx.reply(
            formatWalletFleetList(
                myWallets,
                i => getWalletDisplayName(state, userId, i),
                i => isDisplayIndexCompromised(state, userId, i + 1)
            ),
            { parse_mode: 'HTML' }
        );
    } catch (e) {
        await ctx.reply('Error updating balances');
    }
});

bot.command('wallet', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const myWallets = getUserWallets(userId);
    const args = ctx.message.text.split(' ');
    const indexStr = args[1];

    if (!indexStr || isNaN(parseInt(indexStr))) {
        return ctx.reply('Please provide your wallet number. Example: /wallet 1');
    }

    const index = parseInt(indexStr) - 1;
    if (index < 0 || index >= myWallets.length) {
        return ctx.reply(`Invalid wallet index. You only have ${myWallets.length} wallet(s).`);
    }

    const wallet = myWallets[index];
    const displayName = getWalletDisplayName(state, userId, index);
    const msg = `
🔑 <b>Your Sub-Wallet ${displayName} Secrets</b>

<b>Address:</b>
<code>${wallet.address}</code>

<b>Private Key:</b>
<code>${wallet.privateKey}</code>

⚠️ <i>Never share this key with anyone. To remove it from bot memory, use /deletewallet ${index + 1}</i>
`.trim();

    // If used in a group, try to delete the message to hide the invocation, then DM the user
    if (ctx.chat.type !== 'private') {
        try {
            await ctx.deleteMessage();
        } catch (e) {
            // Bot lacks delete permissions in group
        }
        try {
            await bot.telegram.sendMessage(userId, msg, { parse_mode: 'HTML' });
            ctx.reply(`✅ @${ctx.from?.username || 'User'}, your wallet details were sent directly to your DMs for security.`);
        } catch (e) {
            ctx.reply(`❌ @${ctx.from?.username || 'User'}, Failed to DM you. Ensure you have started a private chat with the bot first.`);
        }
    } else {
        await ctx.reply(msg, { parse_mode: 'HTML' }).catch(e => console.error('[Wallet Reply Error Group/Private]', e));
    }
});

bot.command('deletewallet', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const args = ctx.message.text.split(' ').slice(1);
    const indexArg = args[0];
    const oneBased = indexArg !== undefined && indexArg !== '' ? parseInt(indexArg, 10) : undefined;
    if (oneBased !== undefined && Number.isNaN(oneBased)) {
        return ctx.reply('Usage: <code>/deletewallet &lt;number&gt;</code>\nExample: <code>/deletewallet 3</code>', {
            parse_mode: 'HTML',
        });
    }

    const result = removeUserWallet(state, userId, oneBased);
    if (!result.ok) {
        return ctx.reply(result.message);
    }

    await flushSave(state);
    await saveUserState(userId);

    const kind =
        result.kind === 'imported'
            ? 'imported wallet'
            : `wallet #${result.removedDisplay}`;
    const excludedNote =
        result.kind === 'hd' && result.activeHdCount < result.hdCount
            ? `\n<i>(${result.hdCount - result.activeHdCount} HD slot(s) hidden — excluded from mint/distribute)</i>`
            : '';
    ctx.reply(
        uiScreen({
            icon: '✓',
            title: 'Wallet removed',
            body:
                `Removed <b>${kind}</b>.\n` +
                `Active fleet: <b>${result.activeTotal}</b> ` +
                `(${result.activeHdCount} HD + ${result.importedCount} imported).` +
                excludedNote,
        }),
        { parse_mode: 'HTML' }
    );
});

bot.command('compromised', async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    const args = ctx.message.text.split(/\s+/).slice(1);
    const num = args[0] ? parseInt(args[0], 10) : NaN;

    if (!args[0] || Number.isNaN(num)) {
        const marked = listCompromisedDisplayIndices(state, userId);
        const fleet = getUserWallets(userId).length;
        const safe = getUserMintWallets(userId).length;
        return ctx.reply(
            uiScreen({
                icon: '☠️',
                title: 'Compromised wallets',
                body:
                    `Marked: ${formatCompromisedSummary(state, userId)}\n` +
                    uiRow('Fleet', `<b>${fleet}</b> total · <b>${safe}</b> safe for mint`) +
                    '\n\n' +
                    `<b>Mark drained / poisoned wallet</b>\n` +
                    `<code>/compromised N</code> — exclude #N from minting; still sweep <i>from</i> it\n` +
                    `<code>/uncompromised N</code> — clear flag\n\n` +
                    `<i>Never fund a compromised wallet or sweep into it. Use /sweep 0xColdWallet.</i>`,
            }),
            { parse_mode: 'HTML' }
        );
    }

    const result = markWalletCompromised(state, userId, num);
    if (!result.ok) return ctx.reply(result.message);
    await flushSave(state);
    await saveUserState(userId);

    const warn =
        num === 1
            ? `\n\n⚠️ <b>Wallet #1</b> is your default sweep target — use <code>/sweep 0xColdWallet</code> only.`
            : '';
    ctx.reply(
        uiScreen({
            icon: '☠️',
            title: 'Wallet marked compromised',
            body:
                `Wallet <b>#${result.display}</b> is excluded from mint, distribute receive, and sweep destination.${warn}\n\n` +
                `You can still sweep <b>from</b> it to an external safe address.`,
        }),
        { parse_mode: 'HTML' }
    );
});

bot.command('uncompromised', async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    const args = ctx.message.text.split(/\s+/).slice(1);
    const num = args[0] ? parseInt(args[0], 10) : NaN;
    if (!args[0] || Number.isNaN(num)) {
        return ctx.reply('Usage: <code>/uncompromised &lt;wallet #&gt;</code>\nExample: <code>/uncompromised 3</code>', {
            parse_mode: 'HTML',
        });
    }

    const result = unmarkWalletCompromised(state, userId, num);
    if (!result.ok) return ctx.reply(result.message);
    await flushSave(state);
    await saveUserState(userId);
    ctx.reply(
        uiScreen({
            icon: '✓',
            title: 'Compromised flag cleared',
            body: `Wallet <b>#${result.display}</b> can be used for minting again.`,
        }),
        { parse_mode: 'HTML' }
    );
});

bot.command('walletname', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2 || isNaN(parseInt(args[0]))) {
        return ctx.reply(
            'Set a display name for a sub-wallet.\n\n' +
                '<b>Usage:</b> <code>/walletname &lt;number&gt; &lt;label&gt;</code>\n' +
                '<i>Example:</i> <code>/walletname 1 Alpha</code>\n' +
                '<i>Clear:</i> <code>/walletname 2</code> (empty label)',
            { parse_mode: 'HTML' }
        );
    }

    const index = parseInt(args[0]) - 1;
    const label = args.slice(1).join(' ').trim();
    const walletCount = getUserWallets(userId).length;
    if (index < 0 || index >= walletCount) {
        return ctx.reply(`Invalid wallet number. You have ${walletCount} wallet(s) (use 1–${walletCount}).`);
    }

    setWalletLabel(state, userId, index, label);
    await StateManager.save(state);
    await saveUserState(userId);

    const display = getWalletDisplayName(state, userId, index);
    ctx.reply(
        label
            ? `✅ Wallet #${index + 1} is now labeled <b>${display}</b>.`
            : `✅ Cleared custom label for wallet #${index + 1} (shows as ${display}).`,
        { parse_mode: 'HTML' }
    );
});

// Admin: reset HD wallet slot count + clear saved imports (use after rotating MNEMONIC on Railway)
bot.command('freshadminwallets', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const userId = ctx.from?.id.toString() || PERSONAL_ID;
    const args = ctx.message.text.split(' ').slice(1);
    const purgeSeed = args[0]?.toLowerCase() === 'purge';
    const importOnly = !purgeSeed && args[0]?.toLowerCase() === 'import';
    const importCount = importOnly ? Math.min(10, Math.max(1, parseInt(args[1] || '3', 10) || 3)) : 0;
    const countArg = purgeSeed ? args[1] : importOnly ? undefined : args[0];
    const count = importOnly
        ? 0
        : Math.min(50, Math.max(0, parseInt(countArg || '5', 10) || 5));

    if (state.importedWallets?.[userId]) {
        delete state.importedWallets[userId];
    }
    if (state.userHdWalletExcluded?.[userId]) {
        delete state.userHdWalletExcluded[userId];
    }
    clearAllCompromisedWallets(state, userId);
    const hadStoredSeed = purgeStoredSeed(state);
    trimWalletLabels(state, userId, count);
    state.userWallets[userId] = count;
    await StateManager.save(state);
    await saveUserState(userId);

    const lines = getUserWallets(userId);
    const preview = lines
        .slice(0, 8)
        .map((w, i) => `#${i + 1} <code>${w.address}</code>`)
        .join('\n');

    await ctx.reply(
        `🔄 <b>Admin wallet profile reset</b>\n\n` +
            `HD slots: <b>${count}</b>\n` +
            `Saved imports: <b>cleared</b>\n` +
            `Excluded HD slots: <b>cleared</b>\n` +
            `Stored seed in state: <b>${purgeSeed ? (hadStoredSeed ? 'purged' : 'none found') : 'not touched (env only)'}</b>\n` +
            (purgeSeed
                ? `\n${formatClearSeedInstructions(userId, count || 5)}\n`
                : '') +
            (importOnly
                ? `Mode: <b>import-only</b>\n` +
                  `1. Run <code>node scripts/generate-fresh-wallets.mjs --telegram-id ${userId} --import-only ${importCount}</code> (offline)\n` +
                  `2. Railway → <code>IMPORTED_KEYS</code> = new keys (comma-separated)\n` +
                  `3. Clear old <code>IMPORTED_KEYS</code> · redeploy\n` +
                  `4. <code>/freshadminwallets import ${importCount}</code> again if needed · <code>/wallets</code> to verify\n`
                : `Mode: <b>new HD mnemonic</b>\n` +
                  `1. Sweep any salvageable ETH to a <b>safe external</b> address — <code>/sweep 0xYourColdWallet</code>\n` +
                  `2. Run <code>node scripts/generate-fresh-wallets.mjs --telegram-id ${userId} --count ${count || 5}</code> (offline)\n` +
                  `3. Railway → <code>MNEMONIC</code> = new phrase · clear <code>IMPORTED_KEYS</code>\n` +
                  `4. Redeploy → <code>/freshadminwallets ${count || 5}</code> → <code>/wallets</code>\n`) +
            `\n<b>Active addresses (${lines.length}):</b>\n${preview || '<i>none until env is updated and redeployed</i>'}` +
            `\n\n⚠️ <b>Compromised wallet?</b> Never fund it again. Do not set Wallet #1 as sweep destination if it is drained.\n` +
            `<i>Delegation scams drain anything you send — rotate keys before depositing new ETH.</i>`,
        { parse_mode: 'HTML' }
    );
});

bot.command('cleanwallets', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const count = typeof state.userWallets[userId] === 'number' ? state.userWallets[userId] : 0;
    if (count <= 1) return ctx.reply('You only have 1 active sub-wallet or none. Nothing to clean.');

    const mnemonic = getBotMnemonic();
    if (!mnemonic) return ctx.reply('MNEMONIC env is not set — cannot scan HD wallets.');

    const msg = await ctx.reply(`🧹 <b>Cleaning Empty Wallets...</b>\nChecking your highest generated wallets for zero balances to trim the fat.`, { parse_mode: 'HTML' });

    try {
        const provider = getUserProvider(userId);
        const accountIndex = Number(BigInt(userId) % 2147483647n);

        // Scan backwards starting from the highest generated index - 1
        // We look for the FIRST (highest) active wallet we hit.
        let emptyCount = 0;
        let newHighestActive = count - 1; // default to keeping everything

        let foundActive = false;
        // Iterate backwards from the top index
        for (let i = count - 1; i >= 0; i--) {
            const userBaseNode = ethers.HDNodeWallet.fromPhrase(mnemonic, "", `m/44'/60'/${accountIndex}'/0`);
            const wallet = userBaseNode.deriveChild(i);

            const [balance, nonce] = await Promise.all([
                provider.getBalance(wallet.address),
                provider.getTransactionCount(wallet.address)
            ]);

            if (balance > 0n || nonce > 0) {
                // We found the highest active wallet! We can stop shrinking.
                // The new count is this index + 1
                newHighestActive = i;
                foundActive = true;
                break;
            } else {
                emptyCount++;
            }
        }

        if (emptyCount > 0) {
            const importedCount = state.importedWallets?.[userId]?.length ?? 0;
            const newCount = foundActive ? newHighestActive + 1 : importedCount > 0 ? 0 : 1;
            state.userWallets[userId] = newCount;
            trimWalletLabels(state, userId, newCount);
            if (state.userHdWalletExcluded?.[userId]) {
                const pruned = state.userHdWalletExcluded[userId].filter(i => i < newCount);
                if (pruned.length === 0) delete state.userHdWalletExcluded[userId];
                else state.userHdWalletExcluded[userId] = pruned;
            }
            await flushSave(state);
            await saveUserState(userId);

            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `✅ <b>Cleanup Complete</b>\nSuccessfully purged ${count - newCount} empty unused tail wallets.\nYou now have ${newCount} active sub-wallets.`, { parse_mode: 'HTML' });
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `ℹ️ <b>Nothing to Clean</b>\nAll ${count} of your generated wallets have historical activity or balances.`, { parse_mode: 'HTML' });
        }
    } catch (e: any) {
        await ctx.reply(`❌ Cleanup failed: RPC Error. Try again later.`);
    }
});

bot.command('importwallet', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const args = ctx.message.text.split(' ');
    const pk = args[1];

    if (!pk) {
        return ctx.reply('Please provide your private key.\nExample: <code>/importwallet 0x123...</code>', { parse_mode: 'HTML' });
    }

    try {
        const wallet = new ethers.Wallet(pk);

        if (!state.importedWallets) state.importedWallets = {};
        if (!state.importedWallets[userId]) state.importedWallets[userId] = [];

        if (state.importedWallets[userId].includes(pk)) {
            return ctx.reply('⚠️ This wallet is already imported into your profile.');
        }

        state.importedWallets[userId].push(pk);
        await StateManager.save(state);
        await saveUserState(userId);

        try {
            await ctx.deleteMessage();
        } catch {
            /* may lack permission */
        }

        const total = getUserWallets(userId).length;
        const inGroup = ctx.chat.type !== 'private';
        ctx.reply(
            `✅ <b>Wallet Imported!</b>\n` +
                (inGroup ? `@${ctx.from?.username || 'User'}, ` : '') +
                `Linked <code>${wallet.address}</code>\n` +
                `👛 <b>${total}</b> wallet(s) active for copy-mint, /mint, and /sweepnfts\n` +
                `<i>Your key message was deleted from this chat. Imported wallets always join mints.</i>`,
            { parse_mode: 'HTML' }
        );
    } catch (e: any) {
        ctx.reply('❌ Invalid Private Key format. Ensure it includes the 0x prefix if necessary.');
    }
});

bot.command('clearimported', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    if (!state.importedWallets || !state.importedWallets[userId] || state.importedWallets[userId].length === 0) {
        return ctx.reply('You have no imported external wallets to clear.');
    }

    const count = state.importedWallets[userId].length;
    state.importedWallets[userId] = [];
    await StateManager.save(state);
    await saveUserState(userId);

    ctx.reply(`🗑️ Successfully cleared and removed ${count} external imported wallet(s) from your profile.`);
});

bot.command('kick', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only command.');

    const targetChat = state.alertChatId || GROUP_ID;
    if (!targetChat) return ctx.reply('No bound group found.');

    const args = ctx.message.text.split(' ');
    const count = parseInt(args[1]) || 10;

    if (!state.chatMembers || state.chatMembers.length === 0) {
        return ctx.reply('📭 I have not seen any members talk in the group yet. I can only kick members who have sent at least one message since this tracking feature was deployed.');
    }

    ctx.reply(`⚠️ Executing Mass Kick on bound group... Attempting to kick ${count} active users.`);

    let kicked = 0;
    // Splice removes them from the tracking array to avoid duplicate retry loops
    const membersToKick = state.chatMembers.splice(0, count);

    for (const uid of membersToKick) {
        try {
            await ctx.telegram.banChatMember(targetChat, parseInt(uid));
            await ctx.telegram.unbanChatMember(targetChat, parseInt(uid)); // Unban immediately so it acts as a kick, allowing rejoin later
            kicked++;
        } catch (e) {
            // Ignored. The bot might be lacking permissions, or the user already left.
        }
    }

    await StateManager.save(state);
    ctx.reply(`✅ Successfully kicked ${kicked} members. Remaining seen members in database: ${state.chatMembers.length}`);
});

bot.command('track', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const arg = ctx.message.text.split(' ')[1];
    if (!arg || !arg.startsWith('0x')) return ctx.reply('Please provide an address. Example: /track 0x...');

    const addr = arg.toLowerCase();
    if (!state.userTrackedAddresses) state.userTrackedAddresses = {};
    if (!state.userTrackedAddresses[userId]) state.userTrackedAddresses[userId] = [];

    if (!state.userTrackedAddresses[userId].includes(addr)) {
        state.userTrackedAddresses[userId].push(addr);
        await StateManager.saveUser(userId, { trackedAddresses: state.userTrackedAddresses[userId] });
        syncTracker();
        ctx.reply(`✅ Added <code>${addr}</code> to your personal tracking list.`, { parse_mode: 'HTML' });
    } else {
        ctx.reply(`ℹ️ <code>${addr}</code> is already in your tracking list.`, { parse_mode: 'HTML' });
    }
});

bot.command('untrack', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const arg = ctx.message.text.split(' ')[1];
    if (!arg) return ctx.reply('Please provide an address.');

    const addr = arg.toLowerCase();
    if (state.userTrackedAddresses?.[userId]?.includes(addr)) {
        state.userTrackedAddresses[userId] = state.userTrackedAddresses[userId].filter(a => a !== addr);
        await StateManager.saveUser(userId, { trackedAddresses: state.userTrackedAddresses[userId] });
        syncTracker();
        ctx.reply(`✅ Removed <code>${addr}</code> from your personal tracking list.`, { parse_mode: 'HTML' });
    } else {
        ctx.reply('❌ Address not found in your personal tracking list.');
    }
});

bot.command('globaltrack', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (userId !== PERSONAL_ID) return ctx.reply('❌ Admin only command.');
    const arg = ctx.message.text.split(' ')[1];
    if (!arg || !arg.startsWith('0x')) return ctx.reply('Please provide an address. Example: /globaltrack 0x...');

    const addr = arg.toLowerCase();
    if (!state.trackedAddresses.includes(addr)) {
        state.trackedAddresses.push(addr);
        await StateManager.save(state);
        syncTracker();
        ctx.reply(`✅ Added <code>${addr}</code> to the GLOBAL tracking list.`, { parse_mode: 'HTML' });
    } else {
        ctx.reply('ℹ️ Address is already in the global list.');
    }
});

bot.command('globaluntrack', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (userId !== PERSONAL_ID) return ctx.reply('❌ Admin only command.');
    const arg = ctx.message.text.split(' ')[1];
    if (!arg) return ctx.reply('Please provide an address.');

    const addr = arg.toLowerCase();
    if (state.trackedAddresses.includes(addr)) {
        state.trackedAddresses = state.trackedAddresses.filter(a => a !== addr);
        await StateManager.save(state);
        syncTracker();
        ctx.reply(`✅ Removed <code>${addr}</code> from the GLOBAL tracking list.`, { parse_mode: 'HTML' });
    } else {
        ctx.reply('❌ Address not found in global tracking list.');
    }
});

bot.command('trackingaudit', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const sync = syncTracker();
    const audit = buildTrackingAudit(state, tracker);

    let text =
        `🔍 <b>TRACKING AUDIT</b> (v${BOT_VERSION})\n\n` +
        `<b>State</b> global=${audit.globalCount} personal=${audit.personalEntries} union=<b>${audit.unionCount}</b>\n` +
        `<b>Tracker</b> ${audit.trackerRunning ? '🟢 running' : '🔴 stopped'} | watching=<b>${audit.trackerWatching}</b>\n` +
        `<b>Sync</b> +${sync.added} -${sync.removed}\n\n` +
        `<b>Detection</b>\n` +
        `• Pending WS: ${audit.config.pendingDetection ? 'on' : 'off'}\n` +
        `• Block HTTP: ${audit.config.blockFallback ? 'on' : 'off'}\n` +
        `• Permissive classifier: ${audit.config.permissiveClassifier ? 'on' : 'off'}\n\n`;

    if (audit.stats) {
        text +=
            `<b>Stats</b> blocks=${audit.stats.blocksProcessed} mints=${audit.stats.mintsDetected} ` +
            `rejected=${audit.stats.nonMintsRejected} dupes=${audit.stats.duplicatesSkipped}\n\n`;
    }

    if (audit.issues.length === 0) {
        text += `✅ <b>OK</b> — state and tracker are aligned.`;
    } else {
        text += `⚠️ <b>Issues:</b> ${audit.issues.join(', ')}\n`;
        if (audit.onlyInState.length > 0) {
            text += `\n<b>Only in state (not on tracker):</b>\n`;
            audit.onlyInState.slice(0, 5).forEach(a => {
                text += `• <code>${a}</code>\n`;
            });
        }
        if (audit.onlyInTracker.length > 0) {
            text += `\n<b>Only on tracker (stale):</b>\n`;
            audit.onlyInTracker.slice(0, 5).forEach(a => {
                text += `• <code>${a}</code>\n`;
            });
        }
        if (audit.unionCount === 0) {
            text += `\n<i>Add whales with /track or /globaltrack</i>`;
        }
    }

    ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('cleartrack', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const beforeUnion = StateManager.getUnionOfTrackedAddresses(state).length;
    if (beforeUnion === 0) {
        return ctx.reply('ℹ️ No tracked wallets to clear.');
    }

    const { global: globalCount, personal: personalCount, usersCleared } =
        await StateManager.clearAllTrackedAddresses(state);
    syncTracker();

    ctx.reply(
        `🧹 <b>All tracked wallets cleared!</b>\n\n` +
        `Removed: ${globalCount} global + ${personalCount} personal (${beforeUnion} unique)\n` +
        `MongoDB user docs updated: ${usersCleared}\n` +
        `Tracker now watching: 0 addresses`,
        { parse_mode: 'HTML' }
    );
});

bot.command('clearpersonaltracks', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const personalCount = Object.values(state.userTrackedAddresses || {}).reduce(
        (sum, list) => sum + (list?.length || 0),
        0
    );
    if (personalCount === 0) {
        return ctx.reply('ℹ️ No user-added personal tracked wallets to clear.');
    }

    const { personal, usersCleared } = await StateManager.clearAllUserTrackedAddresses(state);
    syncTracker();

    ctx.reply(
        `🧹 <b>User personal tracked wallets cleared!</b>\n\n` +
        `Removed personal entries: ${personal}\n` +
        `Global list kept: ${state.trackedAddresses.length} addresses\n` +
        `MongoDB user docs updated: ${usersCleared}`,
        { parse_mode: 'HTML' }
    );
});

bot.command('followglobal', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();

    if (arg !== 'on' && arg !== 'off') {
        return ctx.reply('Use /followglobal on or /followglobal off\n\nTip: /trackingprefs for per-source alerts & auto-mint.');
    }
    const on = arg === 'on';
    applyUserTrackingPrefs(state, userId, {
        alertGlobal: on,
        autoMintGlobal: on,
    });
    await persistUserTrackingPrefs(userId, getUserTrackingPrefs(state, userId));
    ctx.reply(`🌍 Global list — alerts & auto-mint ${on ? 'ON' : 'OFF'}\n\nFine-tune: /trackingprefs`);
});

bot.command('trackingprefs', async (ctx) => {
    await sendTrackingPrefsMenu(ctx, false);
});

bot.command('mytracks', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const personaList = state.userTrackedAddresses?.[userId] || [];
    const prefs = getUserTrackingPrefs(state, userId);
    const globalCount = state.trackedAddresses.length;

    let text = `🎯 <b>Your Tracking Profile</b>\n\n`;
    text += formatPrefsSummary(prefs) + '\n\n';
    text += `🌍 <b>Global whales:</b> ${globalCount}\n`;
    text += `👤 <b>Personal wallets (${personaList.length}):</b>\n`;

    if (personaList.length === 0) {
        text += `<i>(None — use /track to add)</i>`;
    } else {
        personaList.forEach((a, i) => {
            text += `${i + 1}. <code>${a}</code>\n`;
        });
    }
    text += `\n<i>/trackingprefs — sources, copy-mint filter (free / free+paid)</i>`;

    ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('monitor', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only command.');

    const args = ctx.message.text.split(' ');
    const contract = args[1];
    const target = args[2];

    if (!contract || !contract.startsWith('0x') || !target || isNaN(parseFloat(target))) {
        return ctx.reply('Usage: /monitor <contract_address> <target_eth_floor>\nExample: /monitor 0x... 0.05');
    }

    if (!state.trackedCollections) state.trackedCollections = [];

    const lowerContract = contract.toLowerCase();
    const existing = state.trackedCollections.find(c => c.address.toLowerCase() === lowerContract);

    if (existing) {
        existing.targetFloor = target;
        await StateManager.save(state);
        return ctx.reply(`♻️ Updated monitoring for <code>${lowerContract}</code> to target floor: <b>${target} ETH</b>`, { parse_mode: 'HTML' });
    }

    state.trackedCollections.push({ address: lowerContract, targetFloor: target });
    await StateManager.save(state);
    ctx.reply(`📈 <b>Profit Monitor Active!</b>\nAdded <code>${lowerContract}</code> to the watch list with a target of <b>${target} ETH</b>.`, { parse_mode: 'HTML' });
});

bot.command('unmonitor', async (ctx) => {
    if (ctx.from?.id.toString() !== PERSONAL_ID) return ctx.reply('🔒 Admin only command.');

    const args = ctx.message.text.split(' ');
    const contract = args[1]?.toLowerCase();

    if (!contract || !contract.startsWith('0x')) return ctx.reply('Usage: /unmonitor <contract_address>');
    if (!state.trackedCollections) return ctx.reply('No collections currently monitored.');

    const initialStats = state.trackedCollections.length;
    state.trackedCollections = state.trackedCollections.filter(c => c.address.toLowerCase() !== contract);

    if (state.trackedCollections.length < initialStats) {
        await StateManager.save(state);
        ctx.reply(`🛑 Removed <code>${contract}</code> from the profit monitor list.`, { parse_mode: 'HTML' });
    } else {
        ctx.reply('❌ Contract not found in your monitored list.');
    }
});

bot.command('automint', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
    if (arg === 'on') state.autoMint = true;
    else if (arg === 'off') state.autoMint = false;
    else return ctx.reply('Use /automint on or /automint off');

    await StateManager.save(state);
    ctx.reply(`🤖 Auto-Mint is now ${state.autoMint ? 'ON' : 'OFF'}`);
});

bot.command('forcesim', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    state.skipSimulation = !state.skipSimulation;
    await StateManager.save(state);

    if (state.skipSimulation) {
        ctx.reply('⚠️ <b>Simulation Bypass Enabled!</b>\nThe bot will no longer run pre-flight checks on copy-trades. It will blindly submit the transaction with a massive gas limit. If the mint is whitelist-only or sold out, you WILL lose gas fees on reverted transactions!', { parse_mode: 'HTML' });
    } else {
        ctx.reply('🛡️ <b>Simulation Protection Enabled!</b>\nThe bot will dry-run transactions and abort them if they are guaranteed to fail (e.g. whitelist missing, sold out, insufficient funds), saving you gas fees.', { parse_mode: 'HTML' });
    }
});

bot.command('overdrive', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    state.overdrive = !state.overdrive;
    await StateManager.save(state);

    if (state.overdrive) {
        ctx.reply('🚀 <b>OVERDRIVE SNIPE MODE ENABLED!</b>\nThe bot will now bid <b>4x the Base Gas Fee</b> for all executed transactions to ensure you obliterate other bots in the same block. ⚠️ <i>Warning: You will need significantly more ETH in each wallet to pass balance checks because of the massive gas limit estimation padding!</i>', { parse_mode: 'HTML' });
    } else {
        ctx.reply('🐢 <b>Overdrive Disabled (Normal Mode)</b>\nThe bot will use standard network gas profiles with a safe 10% bumper. This prevents "Insufficient Funds" errors and saves you money during uncontested mints.', { parse_mode: 'HTML' });
    }
});

bot.command('distribute', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const args = ctx.message.text.split(' ');
    const amountArg = args[1];
    // Optional: /distribute 0.01 0xFUNDING_ADDRESS - use an external wallet as the funder
    const customFunderAddress = args[2]?.startsWith('0x') ? args[2].toLowerCase() : null;

    if (!amountArg) return ctx.reply('Provide amount or "all". Example: /distribute 0.01\nor /distribute all\n\n<i>Tip: Add an external funding address as 2nd arg to fund from that wallet instead of Wallet #1</i>', { parse_mode: 'HTML' });

    const allMyWallets = getUserWallets(userId);
    if (allMyWallets.length < 2) return ctx.reply('You need at least 2 wallets to distribute funds. Generate more using /wallets 5');

    // Determine which wallet is the funding source
    // If a custom funder is specified, find it in the wallet list; otherwise use Wallet #1
    let masterWallet = allMyWallets[0];
    let receiverWallets: string[];

    if (customFunderAddress) {
        const found = allMyWallets.find(w => w.address.toLowerCase() === customFunderAddress);
        if (!found) return ctx.reply(`❌ Funding address <code>${customFunderAddress}</code> not found in your registered wallets.`, { parse_mode: 'HTML' });
        const funderIdx = allMyWallets.findIndex(w => w.address.toLowerCase() === customFunderAddress) + 1;
        if (funderIdx > 0 && isDisplayIndexCompromised(state, userId, funderIdx)) {
            return ctx.reply(
                `🚫 Wallet <b>#${funderIdx}</b> is marked compromised — do not fund it. Pick another funder or <code>/uncompromised ${funderIdx}</code>.`,
                { parse_mode: 'HTML' }
            );
        }
        masterWallet = found;
        receiverWallets = allMyWallets
            .filter(w => w.address.toLowerCase() !== customFunderAddress)
            .map(w => w.address);
    } else {
        if (isDisplayIndexCompromised(state, userId, 1)) {
            return ctx.reply(
                `🚫 <b>Wallet #1</b> is marked compromised — cannot use it as distribute source.\n` +
                    `Fund subs from an external wallet: <code>/distribute 0.01 0xSafeFunder</code>`,
                { parse_mode: 'HTML' }
            );
        }
        receiverWallets = allMyWallets.slice(1).map(w => w.address);
    }

    receiverWallets = filterDistributeReceivers(state, userId, receiverWallets, allMyWallets);

    if (receiverWallets.length === 0) {
        return ctx.reply(
            'No safe recipient wallets (all targets may be compromised). Unmark with <code>/uncompromised N</code> or add new wallets.',
            { parse_mode: 'HTML' }
        );
    }

    try {
        const provider = getUserProvider(userId);
        let valueInWei: bigint;

        if (amountArg.toLowerCase() === 'all') {
            await ctx.reply(
                uiScreen({
                    icon: '◷',
                    title: 'Calculating balance',
                    body: '<i>Reading Wallet #1 and estimating gas…</i>',
                }),
                { parse_mode: 'HTML' }
            );
            const totalBalance = await provider.getBalance(masterWallet.address);

            const feeData = await provider.getFeeData();
            const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 1000000000n;
            const gasCostPerTx = gasPrice * 21000n;
            const totalGasNeeded = gasCostPerTx * BigInt(receiverWallets.length);

            if (totalBalance <= totalGasNeeded) {
                return ctx.reply(
                    uiScreen({
                        icon: '✗',
                        title: 'Insufficient funds',
                        body:
                            `Wallet #1 has <b>${formatEther(totalBalance)}</b> ETH but needs at least <b>${formatEther(totalGasNeeded)}</b> ETH for gas across <b>${receiverWallets.length}</b> transfers.`,
                    }),
                    { parse_mode: 'HTML' }
                );
            }

            const distributableAmount = totalBalance - totalGasNeeded;
            valueInWei = distributableAmount / BigInt(receiverWallets.length);

            await ctx.reply(
                formatDistributionProgress({
                    mode: 'all',
                    perWalletEth: formatEther(valueInWei),
                    walletCount: receiverWallets.length,
                    reservedGasEth: formatEther(totalGasNeeded),
                }),
                { parse_mode: 'HTML' }
            );
        } else {
            valueInWei = parseEther(amountArg);
            await ctx.reply(
                formatDistributionProgress({
                    mode: 'fixed',
                    amountEth: amountArg,
                    walletCount: receiverWallets.length,
                }),
                { parse_mode: 'HTML' }
            );
        }

        const txs = await splitGas(
            masterWallet.privateKey,
            receiverWallets,
            formatEther(valueInWei),
            provider as JsonRpcProvider
        );

        await ctx.reply(
            uiScreen({
                icon: '◷',
                title: 'Confirming transfers',
                body: `<i>Waiting for <b>${txs.length}</b> transaction${txs.length === 1 ? '' : 's'}…</i>`,
            }),
            { parse_mode: 'HTML' }
        );

        const results = await Promise.all(txs.map(async (tx) => {
            try {
                const receipt = await tx.wait();
                return { hash: tx.hash, success: receipt?.status === 1 };
            } catch (err) {
                return { hash: tx.hash, success: false };
            }
        }));

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        const links = results
            .map(
                r =>
                    `${r.success ? '✓' : '✗'} <a href="https://etherscan.io/tx/${r.hash}">tx</a>`
            )
            .join('\n');

        ctx.reply(formatDistributionComplete({ successCount, failCount, txLines: links }), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
        });
    } catch (e: any) {
        ctx.reply(`❌ Distribution failed: ${e.message}`);
    }
});

// ==========================================
// /custommint COMMAND — ABI Encoder Wizard
// Handles mints that require specific arguments the copy-trade engine can't handle:
//   - Token-ID mints       : /custommint 0xContract 0.08 tokenId 4231
//   - Allowlist proof mints: /custommint 0xContract 0.08 allowlist 0xproof1,0xproof2
//   - Phased mints         : /custommint 0xContract 0.08 phase 2
//   - Recipient mints      : /custommint 0xContract 0.08 recipient 0xYourAddress
//   - Raw ABI sig          : /custommint 0xContract 0.08 sig "mintPhase(uint256,address)" 2,0xAddr
// ==========================================
bot.command('custommint', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    if (!userCanUseBot(state, userId, PERSONAL_ID)) {
        return ctx.reply(
            state.accessCode
                ? '🔒 Enter the access code: <code>/unlock YOUR_CODE</code>'
                : '🔒 You must /unlock to use this command.',
            { parse_mode: 'HTML' }
        );
    }

    const text = ctx.message.text;
    const parts = text.trim().split(/\s+/);
    // parts[0] = /custommint
    // parts[1] = contract address
    // parts[2] = eth value
    // parts[3] = mode (tokenid | allowlist | phase | recipient | sig | raw)
    // parts[4...] = mode-specific args

    if (parts.length < 4) {
        return ctx.reply(
            `🔧 <b>Custom Mint Builder</b> — ABI Encoder Wizard\n\n` +
            `This command lets you mint contracts that need specific parameters your bot can't auto-detect.\n\n` +
            `<b>📋 Supported Modes:</b>\n\n` +
            `<b>Token ID Mint</b>\n` +
            `<code>/custommint 0xContract 0.08 tokenid 4231</code>\n` +
            `Calls: <code>mint(uint256 tokenId)</code>\n\n` +
            `<b>Allowlist / Merkle Proof Mint</b>\n` +
            `<code>/custommint 0xContract 0.08 allowlist 0xProof1,0xProof2</code>\n` +
            `Calls: <code>mint(bytes32[] proof)</code>\n\n` +
            `<b>Phased Mint (Phase ID)</b>\n` +
            `<code>/custommint 0xContract 0.08 phase 2</code>\n` +
            `Calls: <code>mintPhase(uint256 phaseId, uint256 qty)</code>\n\n` +
            `<b>Recipient / Address Mint</b>\n` +
            `<code>/custommint 0xContract 0 recipient 0xYourAddr</code>\n` +
            `Calls: <code>mintTo(address recipient)</code>\n\n` +
            `<b>Custom ABI Signature (Advanced)</b>\n` +
            `<code>/custommint 0xContract 0.08 sig "claim(uint256,address,bytes32[])" 5,0xAddr,0xProof1</code>\n` +
            `Encodes any arbitrary function you provide.\n\n` +
            `<b>Raw Hex (Bypass Everything)</b>\n` +
            `<code>/custommint 0xContract 0.08 raw 0xa0712d68000...</code>\n` +
            `Sends the raw calldata exactly as specified.`,
            { parse_mode: 'HTML' }
        );
    }

    const contractAddress = parts[1];
    const ethValue = parts[2];
    const mode = parts[3].toLowerCase();

    if (!contractAddress.startsWith('0x') || isNaN(parseFloat(ethValue))) {
        return ctx.reply('❌ Invalid contract address or ETH value.\n\nUsage: <code>/custommint 0xContract 0.08 tokenid 4231</code>', { parse_mode: 'HTML' });
    }


    let calldata = '';
    let modeDescription = '';

    try {
        const arg = parts.slice(4).join(' ');

        switch (mode) {
            case 'tokenid':
            case 'token_id': {
                const tokenId = BigInt(arg.trim());
                // Try common token-ID mint selectors
                const mintIface = new ethers.Interface(['function mint(uint256 tokenId)']);
                calldata = mintIface.encodeFunctionData('mint', [tokenId]);
                modeDescription = `Token ID Mint\n🎫 Token ID: <code>${tokenId}</code>\n📞 Selector: <code>mint(uint256)</code>`;
                break;
            }
            case 'allowlist':
            case 'proof': {
                const proofParts = arg.split(',').map(p => p.trim()).filter(Boolean);
                if (proofParts.length === 0) throw new Error('No proof bytes provided.');
                const proofIface = new ethers.Interface(['function mint(bytes32[] calldata proof)']);
                calldata = proofIface.encodeFunctionData('mint', [proofParts]);
                modeDescription = `Allowlist Proof Mint\n🔑 Proof Leaves: ${proofParts.length}\n📞 Selector: <code>mint(bytes32[])</code>`;
                break;
            }
            case 'phase': {
                const phaseId = BigInt(arg.trim() || '0');
                // Many phased drops use mintPhase(phaseId, qty) or mint(phaseId)
                const phaseIface = new ethers.Interface(['function mintPhase(uint256 phaseId, uint256 qty)']);
                calldata = phaseIface.encodeFunctionData('mintPhase', [phaseId, 1n]);
                modeDescription = `Phased Mint\n📅 Phase ID: <code>${phaseId}</code>\n📞 Selector: <code>mintPhase(uint256,uint256)</code>`;
                break;
            }
            case 'recipient': {
                const recipient = arg.trim();
                if (!recipient.startsWith('0x')) throw new Error('Recipient must be a valid 0x address.');
                const recipIface = new ethers.Interface(['function mintTo(address recipient)']);
                calldata = recipIface.encodeFunctionData('mintTo', [recipient]);
                modeDescription = `Recipient Mint\n👤 Recipient: <code>${recipient.slice(0, 10)}...</code>\n📞 Selector: <code>mintTo(address)</code>`;
                break;
            }
            case 'sig': {
                // Format: /custommint 0xAddr 0 sig "funcName(type1,type2)" arg1,arg2
                // The signature is the first token in arg, the rest are comma-delimited param values
                const sigMatch = arg.match(/^"([^"]+)"\s*(.*)$/);
                if (!sigMatch) throw new Error('Signature must be in quotes, e.g. "claim(uint256,address)"');
                const funcSig = sigMatch[1];
                const rawParams = sigMatch[2];
                
                const sigIface = new ethers.Interface([`function ${funcSig}`]);
                const funcName = funcSig.split('(')[0];
                
                // Parse the param types from the signature
                const paramTypesMatch = funcSig.match(/\(([^)]*)\)/);
                const paramTypes = paramTypesMatch?.[1]?.split(',').map(t => t.trim()).filter(Boolean) || [];
                
                // Parse raw params by comma, respecting arrays
                let parsedArgs: unknown[] = [];
                if (rawParams.trim()) {
                    const rawArgList = rawParams.split(',').map(s => s.trim());
                    parsedArgs = paramTypes.map((type, i) => {
                        const raw = rawArgList[i] ?? '0';
                        if (type.includes('uint') || type.includes('int')) return BigInt(raw);
                        if (type === 'bool') return raw === 'true';
                        return raw; // address, bytes32, string, etc.
                    });
                }
                
                calldata = sigIface.encodeFunctionData(funcName, parsedArgs);
                modeDescription = `Custom Signature Mint\n📝 Function: <code>${funcSig}</code>\n🔢 Args: <code>${parsedArgs.join(', ')}</code>`;
                break;
            }
            case 'raw': {
                calldata = arg.trim();
                if (!calldata.startsWith('0x')) throw new Error('Raw hex data must start with 0x');
                modeDescription = `Raw Hex Broadcast\n📄 Data: <code>${calldata.slice(0, 18)}...</code>`;
                break;
            }
            default:
                return ctx.reply(
                    `❌ Unknown mode: <code>${mode}</code>\n\nValid modes: <code>tokenid</code>, <code>allowlist</code>, <code>phase</code>, <code>recipient</code>, <code>sig</code>, <code>raw</code>`,
                    { parse_mode: 'HTML' }
                );
        }
    } catch (err: any) {
        return ctx.reply(`❌ <b>ABI Encoding Failed</b>\n\nReason: ${err.message}\n\nCheck your arguments and try again.`, { parse_mode: 'HTML' });
    }

    const mintAvail = assertMintWalletAvailable(state, userId);
    if (!mintAvail.ok) return ctx.reply(mintAvail.message, { parse_mode: 'HTML' });
    const myWallets = getUserMintWallets(userId);

    const valueWei = parseEther(ethValue).toString();
    const provider = getUserProvider(userId);
    await ctx.reply(
        `🔧 <b>Custom Mint Initiated</b>\n\n` +
        `📦 Contract: <code>${contractAddress}</code>\n` +
        `💰 Value: ${ethValue} ETH per wallet\n` +
        `👛 Wallets: ${myWallets.length}\n` +
        `🔩 Mode: ${modeDescription}\n\n` +
        `⏳ Building transactions and broadcasting...`,
        { parse_mode: 'HTML' }
    );

    try {
        const options = mintOptionsForUser(userId, {
            skipSimulation: true,
            disableMaxMint: true,
        });

        const results = await batchCopyTrade(
            myWallets.map(w => w.privateKey),
            contractAddress,
            calldata,
            valueWei,
            provider as JsonRpcProvider,
            options
        );

        let mempoolLinks = '';
        results.forEach((res, i) => {
            (res as any).uid = userId; // Tag for detailed reporting
            if (res.status === 'fulfilled' && res.value) {
                const txHash = (res.value as any).hash;
                const link = `https://etherscan.io/tx/${txHash}`;
                mempoolLinks += walletLine(userId, i, `<a href="${link}">Etherscan</a> ⏳`) + '\n';
            } else {
                const err = (res as any).reason?.message || 'Send Error';
                mempoolLinks += walletLine(userId, i, `❌ ${err.slice(0, 20)}...`) + '\n';
            }
        });

        const originChatId = ctx.chat.id.toString();
        const initBody = mintReportBody(originChatId, mempoolLinks);

        await runOwnerMintMonitor({
            ownerUserId: userId,
            originChatId,
            originAck: async ack => {
                await ctx.reply(ack, { parse_mode: 'HTML' });
            },
            results,
            mempoolLinks,
            title: '✅ <b>Batch mint confirmed</b>',
            initHeading: '🤖 <b>Batch Broadcasted</b>',
            initBody,
            userRef: {
                userId,
                username: ctx.from?.username,
                firstName: ctx.from?.first_name,
                lastName: ctx.from?.last_name,
            },
            monitorCtx: {
                contractAddress,
                provider: provider as JsonRpcProvider,
                valueEth: ethValue,
            },
        });
    } catch (e: any) {
        ctx.reply(`❌ Mint failed: ${e.message}`);
    }
});

bot.command('mint', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    if (isOnCooldown(userId, 4000)) return ctx.reply('⏳ Please wait a moment.');

    const args = ctx.message.text.split(' ').filter(Boolean);
    const scopeGlobal = args.some(a => a.toLowerCase() === 'global' || a.toLowerCase() === 'all');
    const filteredArgs = args.filter(a => !['global', 'all', 'personal', 'me'].includes(a.toLowerCase()));
    const targetInput = filteredArgs[1];
    const valueEth = filteredArgs[2] || '0';
    let data = filteredArgs[3];

    const wizardDeps = {
        getUserWallets: (uid: string) => getUserMintWallets(uid),
        getUserProvider: (uid: string) => getUserProvider(uid),
        walletLine,
        getHdWalletKeyCount,
        getImportedWalletCount,
    };

    if (!targetInput) {
        startBatchMintWizard(ctx, userId, wizardDeps);
        return;
    }

    const hasCustomData = filteredArgs[3] && filteredArgs[3] !== '0x' && filteredArgs[3].startsWith('0x');
    if (!hasCustomData) {
        startBatchMintWizard(ctx, userId, wizardDeps, {
            contract: targetInput,
            valueEth: filteredArgs[2] !== undefined ? valueEth : undefined,
        });
        return;
    }

    const resolveMsg = await ctx.reply(`🔍 Resolving: <code>${targetInput.slice(0, 40)}...</code>`, { parse_mode: 'HTML' });

    // 1. Resolve Target (Handles Links & Raw Addresses)
    const drop = await resolveDropTarget(targetInput);
    if (!drop) {
        return ctx.telegram.editMessageText(ctx.chat.id, resolveMsg.message_id, undefined, '❌ Could not resolve contract address.');
    }

    const target = drop.contract;
    const valueInWei = parseEther(valueEth).toString();

    // 1.5. Safety: Prevent targeting Routers directly
    const KNOWN_ROUTERS = [
        '0x00005ea00ac477b1030ce78506496e8c2de24bf5', // SeaDrop v1.0
        '0x0000000000664ceffed39244a8312556a900b938', // SeaDrop v1.1
        '0x00000000000001ad428e4906ae943a6d5e6f53d3', // Seaport 1.4
        '0x00000000000000adc04c56bf30ac9d3c0aaf14dc'  // Seaport 1.5
    ];

    if (KNOWN_ROUTERS.includes(target.toLowerCase())) {
        return ctx.telegram.editMessageText(ctx.chat.id, resolveMsg.message_id, undefined, 
            `⚠️ <b>Invalid Target</b>\n\nYou provided a <b>Mint Router</b> address (SeaDrop/Seaport).\n\nYou must provide the <b>NFT Contract Address</b> instead. The bot will automatically use SeaDrop to mint if that's what the contract requires.`, 
            { parse_mode: 'HTML' }
        );
    }

    // 2. Auto-Detect / Max-Mint Logic
    let displayMsg = '';
    if (!data || data === '0x') {
        const iface = new ethers.Interface(['function mint(uint256 amount)']);
        data = iface.encodeFunctionData('mint', [1]); 
        displayMsg = `🚀 <b>Auto Max-Mint Engaged</b>\nTarget: <code>${target}</code>\nValue: ${valueEth} ETH\nSearching for max allowed per wallet...`;
    } else {
        displayMsg = `🚀 <b>Manual Batch Mint</b>\nTarget: <code>${target}</code>\nValue: ${valueEth} ETH\nBroadcasting custom payload...`;
    }

    await ctx.telegram.editMessageText(ctx.chat.id, resolveMsg.message_id, undefined, displayMsg, { parse_mode: 'HTML' });

    const isGlobal = userId === PERSONAL_ID && scopeGlobal;
    const targetUids = isGlobal
        ? Object.keys(state.userWallets).filter(hasCachedMintDashAccess)
        : [userId];

    if (isGlobal) {
        await ctx.reply(`👑 <b>Admin GLOBAL mint</b>\nBroadcasting to ${targetUids.length} users' wallets.\n<i>Tip: omit <code>global</code> to mint with your wallets only.</i>`, { parse_mode: 'HTML' });
    }

    try {
        const allResults: any[] = [];
        let mempoolLinks = '';

        const broadcastPromises = targetUids.map(async (uid) => {
            const wallets = getUserMintWallets(uid);
            if (wallets.length === 0) return;
            
            try {
                const userProvider = getUserProvider(uid);
                const userKeys = wallets.map(w => w.privateKey);
                const results = await batchCopyTrade(
                    userKeys,
                    target,
                    data,
                    valueInWei,
                    userProvider as JsonRpcProvider,
                    mintOptionsForUser(uid, { skipSimulation: state.skipSimulation, disableMaxMint: true })
                );
                
                results.forEach((res, i) => {
                    (res as any).uid = uid;
                    allResults.push(res);
                    
                    if (res.status === 'fulfilled' && res.value) {
                        const txHash = (res.value as any).hash;
                        const link = `https://etherscan.io/tx/${txHash}`;
                        mempoolLinks += walletLine(uid, i, `<a href="${link}">Etherscan</a> ⏳`) + '\n';
                    } else {
                        const err = (res as any).reason?.message || 'Error';
                        mempoolLinks += walletLine(uid, i, `❌ ${err.slice(0, 20)}...`) + '\n';
                    }
                });
            } catch (err: any) {
                mempoolLinks += `User <code>${uid}</code>: ❌ ${err.message.slice(0, 20)}...\n`;
            }
        });

        await Promise.all(broadcastPromises);

        if (allResults.length === 0) {
             return ctx.reply('No active wallets found across target scope.');
        }

        const originChatId = ctx.chat.id.toString();
        const initBody = mintReportBody(originChatId, mempoolLinks, { isGlobal, userCount: targetUids.length });

        await runOwnerMintMonitor({
            ownerUserId: userId,
            originChatId,
            originAck: async ack => {
                await ctx.reply(ack, { parse_mode: 'HTML' });
            },
            results: allResults,
            mempoolLinks,
            title: '✅ <b>Batch mint confirmed</b>',
            initHeading: '🤖 <b>Batch Minting</b>',
            initBody,
            userRef: {
                userId,
                username: ctx.from?.username,
                firstName: ctx.from?.first_name,
                lastName: ctx.from?.last_name,
            },
            monitorCtx: {
                contractAddress: target,
                provider: getUserProvider(userId) as JsonRpcProvider,
                valueEth,
                isGlobal,
            },
        });
    } catch (e: any) {
        ctx.reply(`❌ Error: ${e.message}`);
    }
});

bot.command('globalmint', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    if (!isAdminUserId(userId)) {
        return ctx.reply('⛔ Admin only. Use <code>/mint</code> for your own fleet.', { parse_mode: 'HTML' });
    }
    if (isOnCooldown(userId, 8000)) return ctx.reply('⏳ Please wait a moment.');

    const arg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!arg) {
        return ctx.reply(
            '👑 <b>Global link mint</b>\n\n' +
                '<code>/globalmint &lt;contract or mint link&gt;</code>\n\n' +
                'Resolves the target (SeaDrop, OpenSea, Scatter, etc.) and mints with <b>every user\'s</b> wallet fleet.\n\n' +
                '<i>Raw calldata:</i> <code>/mint global 0xContract 0.08 0x…</code>',
            { parse_mode: 'HTML' }
        );
    }

    const candidates = detectMintTargetFromMessage(arg);
    if (candidates.length === 0) {
        return ctx.reply('❌ Paste a contract address or mint link (OpenSea, Etherscan, Scatter, …).');
    }

    const adminWallets = getUserMintWallets(userId);
    if (adminWallets.length === 0) {
        return ctx.reply('❌ No mint wallets configured. Use <code>/wallets</code>.', { parse_mode: 'HTML' });
    }

    const resolveMsg = await ctx.reply('🔍 <b>Resolving mint target for global broadcast…</b>', {
        parse_mode: 'HTML',
    });

    try {
        const provider = getUserProvider(userId) as JsonRpcProvider;
        const resolved = await resolveMintTarget(candidates[0], provider, adminWallets[0].address);
        if (!resolved) {
            return ctx.telegram.editMessageText(
                ctx.chat!.id,
                resolveMsg.message_id,
                undefined,
                '❌ Could not resolve mint target.'
            );
        }

        const validation = validateMintTarget(resolved, adminWallets.length);
        if (!validation.valid) {
            return ctx.telegram.editMessageText(
                ctx.chat!.id,
                resolveMsg.message_id,
                undefined,
                `❌ <b>Cannot mint</b>\n${validation.errors.map(e => `• ${e}`).join('\n')}`,
                { parse_mode: 'HTML' }
            );
        }

        const config = loadLinkMintConfig();
        const targetUids = listUserIdsWithMintWallets();
        const registeredUsers = Object.keys(state.userWallets).length;
        if (targetUids.length === 0) {
            return ctx.telegram.editMessageText(
                ctx.chat!.id,
                resolveMsg.message_id,
                undefined,
                '❌ No users have active mint wallets (all empty or compromised).',
                { parse_mode: 'HTML' }
            );
        }

        const linkOpts = buildLinkMintExecuteOptions(resolved, config, {
            originChatId: ctx.chat!.id.toString(),
        });
        const txTo = resolved.executionTo || resolved.contractAddress;
        const calldata = resolved.suggestedCalldata || '0x1249c58b';
        const value = resolved.suggestedValue || '0';
        const concurrency = getRuntimeConfig().globalMintUserConcurrency;

        await ctx.telegram.editMessageText(
            ctx.chat!.id,
            resolveMsg.message_id,
            undefined,
            `👑 <b>Global mint</b>\n` +
                `Contract: <code>${resolved.contractAddress}</code>\n` +
                `Fleets: <b>${targetUids.length}</b> users with wallets` +
                (registeredUsers !== targetUids.length
                    ? ` <i>(${registeredUsers} registered)</i>`
                    : '') +
                `\nStarting broadcast (concurrency <b>${concurrency}</b>)…`,
            { parse_mode: 'HTML' }
        );

        const userRef = {
            userId,
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            lastName: ctx.from?.last_name,
        };

        void runGlobalLinkMintBroadcast({
            chatId: ctx.chat!.id,
            progressMessageId: resolveMsg.message_id,
            adminUserId: userId,
            targetUids,
            resolved,
            txTo,
            calldata,
            value,
            linkOpts,
            config,
            userRef,
        }).catch(err =>
            console.error('[GlobalMint] background failed:', (err as Error).message?.slice(0, 200))
        );
    } catch (e: any) {
        await ctx.reply(`❌ Global mint failed: ${shortMintError(e.message || 'Error')}`, {
            parse_mode: 'HTML',
        });
    }
});

bot.command('scattermint', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    if (isOnCooldown(userId, 4000)) return ctx.reply('⏳ Please wait a moment.');

    const arg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!arg) {
        return ctx.reply(
            '🎲 <b>Scatter mint</b>\n\n' +
                '<code>/scattermint https://www.scatter.art/collection/threadborne</code>\n\n' +
                'Or paste the Scatter link in chat and tap <b>Mint now</b>.\n' +
                '<i>Uses Scatter API calldata per wallet (free list first, then paid).</i>',
            { parse_mode: 'HTML' }
        );
    }

    const candidates = detectMintTargetFromMessage(arg);
    if (!candidates.length || !extractScatterSlug(arg)) {
        return ctx.reply('❌ Paste a <b>scatter.art/collection/…</b> link.', { parse_mode: 'HTML' });
    }

    const wallets = getUserMintWallets(userId);
    if (wallets.length === 0) {
        return ctx.reply('❌ No mint wallets. Use <code>/wallets</code>.', { parse_mode: 'HTML' });
    }

    const resolveMsg = await ctx.reply('🔍 Resolving Scatter collection…', { parse_mode: 'HTML' });
    try {
        const provider = getUserProvider(userId) as JsonRpcProvider;
        const resolved = await resolveMintTarget(candidates[0], provider, wallets[0].address);
        if (!resolved || resolved.mintPath !== 'scatter_api') {
            return ctx.telegram.editMessageText(
                ctx.chat!.id,
                resolveMsg.message_id,
                undefined,
                '❌ Could not resolve Scatter mint (check link or wallet eligibility).'
            );
        }

        const validation = validateMintTarget(resolved, wallets.length);
        if (!validation.valid) {
            return ctx.telegram.editMessageText(
                ctx.chat!.id,
                resolveMsg.message_id,
                undefined,
                `❌ ${validation.errors.join('\n')}`,
                { parse_mode: 'HTML' }
            );
        }

        const config = loadLinkMintConfig();
        const linkOpts = buildLinkMintExecuteOptions(resolved, config, {
            originChatId: ctx.chat!.id.toString(),
        });
        const candidate = DetectionEngine.candidateFromManual({
            to: resolved.executionTo || resolved.contractAddress,
            data: resolved.suggestedCalldata || '0x',
            value: resolved.suggestedValue || '0',
        });

        await ctx.telegram.editMessageText(
            ctx.chat!.id,
            resolveMsg.message_id,
            undefined,
            `${buildPreviewMessage(resolved, wallets.length)}\n\n🚀 <i>Minting <b>${wallets.length}</b> wallets…</i>`,
            { parse_mode: 'HTML' }
        );

        const engineResult = await CopyMintEngine.executeLinkMint({
            provider: provider as any,
            privateKeys: wallets.map(w => w.privateKey),
            candidate,
            paymentPlanValue: resolved.suggestedValue || '0',
            options: mintOptionsForUser(userId, {
                ...linkOpts,
                skipClassification: true,
                throttleSimulations: false,
            }),
        });
        const results = engineResult.legacyResults;
        results.forEach((res: any) => {
            (res as { uid?: string }).uid = userId;
        });
        recordLinkMintExecution(resolved);

        let mempoolLinks = buildMempoolLinksFromResults(results);
        if (results.length === 0 && engineResult.submittedCount === 0) {
            mempoolLinks += `⚠️ ${shortMintError(CopyMintEngine.getLastSkipReason() || 'engine_skip')}\n`;
        }

        const valueEth = formatEther(BigInt(resolved.suggestedValue || '0'));

        await runOwnerMintMonitor({
            ownerUserId: userId,
            originChatId: ctx.chat!.id.toString(),
            results,
            mempoolLinks,
            title: '✅ <b>Scatter mint confirmed</b>',
            initHeading: '🎲 <b>Scatter mint submitted</b>',
            initBody:
                `Collection: <code>${resolved.contractAddress}</code>\n\n` +
                mintReportBody(ctx.chat!.id.toString(), mempoolLinks),
            userRef: { userId },
            monitorCtx: {
                contractAddress: resolved.contractAddress,
                provider,
                valueEth,
            },
        });
    } catch (e: any) {
        await ctx.reply(`❌ Scatter mint failed: ${shortMintError(e.message || 'Error')}`);
    }
});

bot.command('mintall', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    if (isOnCooldown(userId, 4000)) return ctx.reply('⏳ Please wait a moment.');

    const arg = ctx.message.text.split(' ').slice(1).join(' ').trim();
    if (!arg) {
        return ctx.reply(
            '🎯 <b>Mint all your wallets</b>\n\n' +
                '<code>/mintall &lt;contract or mint link&gt;</code>\n\n' +
                'Same as pasting a link, but runs immediately on <b>your full fleet</b>.\n' +
                '<i>Scatter:</i> <code>/scattermint &lt;scatter link&gt;</code>\n' +
                '<i>Admin:</i> <code>/globalmint</code> for every user.',
            { parse_mode: 'HTML' }
        );
    }

    const candidates = detectMintTargetFromMessage(arg);
    if (candidates.length === 0) {
        return ctx.reply('❌ Paste a contract address or mint link.');
    }

    const wallets = getUserMintWallets(userId);
    if (wallets.length === 0) {
        return ctx.reply('❌ No mint wallets. Use <code>/wallets</code>.', { parse_mode: 'HTML' });
    }

    const resolveMsg = await ctx.reply('🔍 Resolving…', { parse_mode: 'HTML' });
    try {
        const provider = getUserProvider(userId) as JsonRpcProvider;
        const resolved = await resolveMintTarget(candidates[0], provider, wallets[0].address);
        if (!resolved) {
            return ctx.telegram.editMessageText(
                ctx.chat!.id,
                resolveMsg.message_id,
                undefined,
                '❌ Could not resolve mint target.'
            );
        }

        const validation = validateMintTarget(resolved, wallets.length);
        if (!validation.valid) {
            return ctx.telegram.editMessageText(
                ctx.chat!.id,
                resolveMsg.message_id,
                undefined,
                `❌ ${validation.errors.join(' · ')}`,
                { parse_mode: 'HTML' }
            );
        }

        const config = loadLinkMintConfig();
        const linkOpts = buildLinkMintExecuteOptions(resolved, config, {
            originChatId: ctx.chat!.id.toString(),
        });
        const txTo = resolved.executionTo || resolved.contractAddress;
        const calldata = resolved.suggestedCalldata || '0x1249c58b';
        const value = resolved.suggestedValue || '0';
        const candidate = DetectionEngine.candidateFromManual({ to: txTo, data: calldata, value });

        await ctx.telegram.editMessageText(
            ctx.chat!.id,
            resolveMsg.message_id,
            undefined,
            `🚀 Minting <b>${wallets.length}</b> wallets…`,
            { parse_mode: 'HTML' }
        );

        const engineResult = await CopyMintEngine.executeLinkMint({
            provider: provider as any,
            privateKeys: wallets.map(w => w.privateKey),
            candidate,
            paymentPlanValue: value,
            options: mintOptionsForUser(userId, {
                ...linkOpts,
                skipClassification: true,
                throttleSimulations: process.env.LINK_MINT_THROTTLE_SIM !== 'false',
            }),
        });
        const results = engineResult.legacyResults;
        results.forEach((res: any) => {
            (res as { uid?: string }).uid = userId;
        });
        recordLinkMintExecution(resolved);

        let mempoolLinks = buildMempoolLinksFromResults(results);
        if (results.length === 0 && engineResult.submittedCount === 0) {
            const skip = CopyMintEngine.getLastSkipReason() || 'engine_skip';
            mempoolLinks += `⚠️ ${shortMintError(skip)}\n`;
        }

        const valueEth =
            typeof value === 'bigint' ? formatEther(value) : formatEther(BigInt(value || '0'));

        await runOwnerMintMonitor({
            ownerUserId: userId,
            originChatId: ctx.chat!.id.toString(),
            results,
            mempoolLinks,
            title: '✅ <b>Fleet mint confirmed</b>',
            initHeading: '🎯 <b>Fleet mint submitted</b>',
            initBody:
                `Contract: <code>${resolved.contractAddress}</code>\n\n` +
                mintReportBody(ctx.chat!.id.toString(), mempoolLinks),
            userRef: { userId },
            monitorCtx: {
                contractAddress: resolved.contractAddress,
                provider,
                valueEth,
            },
        });
    } catch (e: any) {
        await ctx.reply(`❌ Mint failed: ${shortMintError(e.message || 'Error')}`);
    }
});

async function triggerTurboSweepForUser(
    ctx: Context,
    userId: string,
    destinationOverride?: string
): Promise<void> {
    const myWallets = getUserWallets(userId);
    const destination =
        (destinationOverride?.startsWith('0x') ? destinationOverride : null) ||
        (myWallets.length > 0 ? myWallets[0].address : null);

    if (!destination) {
        await ctx.reply('Provide destination address. Example: <code>/sweep 0x…</code>', {
            parse_mode: 'HTML',
        });
        return;
    }
    if (myWallets.length === 0) {
        await ctx.reply('You have no sub-wallets to sweep.');
        return;
    }

    const destCheck = validateSweepDestination(state, userId, destination, myWallets);
    if (!destCheck.ok) {
        await ctx.reply(destCheck.message, { parse_mode: 'HTML' });
        return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const statusMsg = await ctx.reply(`🚀 <b>Turbo-Sweep</b>\nPreparing…`, { parse_mode: 'HTML' });
    const provider = getUserProvider(userId);

    void runTurboSweep({
        userId,
        provider: provider as JsonRpcProvider,
        destination,
        wallets: myWallets.map(w => ({ address: w.address, privateKey: w.privateKey })),
        onStatus: async html => {
            await ctx.telegram
                .editMessageText(chatId, statusMsg.message_id, undefined, html, { parse_mode: 'HTML' })
                .catch(() => {});
        },
    });
}

bot.command('sweep', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const argAddr = ctx.message.text.split(/\s+/)[1];
    void triggerTurboSweepForUser(ctx, userId, argAddr);
});

bot.command('checkdb', async (ctx) => {
    const isConnected = StateManager.isConnected();
    if (isConnected) {
        ctx.reply('✅ <b>Database Health Check</b>\nStatus: <b>CONNECTED</b>\nBackend: MongoDB Atlas (Cloud Persistence Active)', { parse_mode: 'HTML' });
    } else {
        ctx.reply('⚠️ <b>Database Health Check</b>\nStatus: <b>NOT CONNECTED</b>\nBackend: Local Memory (State will reset on Render redeploy)', { parse_mode: 'HTML' });
    }
});

bot.command('db', async (ctx) => {
    // Alias for /checkdb
    const isConnected = StateManager.isConnected();
    ctx.reply(isConnected ? '✅ Database: <b>Connected</b>' : '❌ Database: <b>Disconnected</b>', { parse_mode: 'HTML' });
});

bot.command('status', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const dbStatus = StateManager.isConnected() ? '✅ Connected (Atlas)' : '⚠️ Local Storage (Non-persistent)';
    const rpcStatus = state.providerUrl ? `✅ ${new URL(state.providerUrl.split(',')[0]).hostname}` : '❌ Not Configured';
    const auto = state.autoMint ? '🟢 ACTIVE' : '🔴 DISABLED';
    const mev = state.mevProtection ? '🛡️ PROTECTED' : '🔓 PUBLIC';
    const sim = state.skipSimulation ? '⚡ BLIND' : '🔍 SAFE';
    const bribe = state.gasBribeGwei || '0';
    const walletCount = getUserWallets(userId).length;
    const personalWhales = (state.userTrackedAddresses?.[userId] || []).length;
    const tp = getUserTrackingPrefs(state, userId);
    const followsGlobal = tp.alertGlobal || tp.autoMintGlobal;
    const trackingCount = isAdminUserId(userId)
        ? state.trackedAddresses.length
        : personalWhales + (followsGlobal ? state.trackedAddresses.length : 0);
    const trackingLabel = isAdminUserId(userId) ? 'Global whales' : 'Whales you follow';

    const text = `
📊 <b>Bot Health & Engine Status</b>

🤖 <b>Auto-Mint:</b> ${auto} ${sim}
🛡️ <b>MEV Shield:</b> ${mev}
⚡ <b>Priority Bribe:</b> ${bribe} Gwei
🚧 <b>Max Limit:</b> ${state.maxMintLimit || '1.0'} ETH

🗄️ <b>Database:</b> ${dbStatus}
🌐 <b>Network:</b> ${rpcStatus}

👛 <b>Your Wallets:</b> ${walletCount} Active
👁️ <b>${trackingLabel}:</b> ${trackingCount}
📈 <b>Monitoring:</b> ${state.trackedCollections?.length || 0} Collections

🚀 <b>Performance History:</b>
✅ Success: ${botAnalytics.successfulTrades}
❌ Failed: ${botAnalytics.failedTrades}
💰 Spent: ${botAnalytics.totalEthSpent.toFixed(4)} ETH

<i>Everything is rounded up and operational. Ready for the next drop!</i>`.trim();

    ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('ping', async (ctx) => {
    const start = Date.now();
    const msg = await ctx.reply('🏓 Pinging...');
    const latency = Date.now() - start;
    ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `🏓 <b>Pong!</b>\nLatency: <code>${latency}ms</code>`, { parse_mode: 'HTML' });
});


async function handleCollectionNftSweep(ctx: any, commandName: string) {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const myWallets = getUserWallets(userId);
    const args = ctx.message.text.split(' ').filter(Boolean);
    const contractAddress = args[1];

    if (!contractAddress || !contractAddress.startsWith('0x')) {
        return ctx.reply(
            `Send the <b>NFT collection contract</b> — all subs + imported wallets sweep to <b>Wallet #1</b>.\n\n` +
                `<code>/${commandName} 0xYourCollectionContract</code>\n\n` +
                `Optional:\n` +
                `<code>/${commandName} 0xContract 0xOtherDest</code>\n` +
                `<code>/${commandName} 0xContract 0xDest 1,2,3</code> — specific token IDs only`,
            { parse_mode: 'HTML' }
        );
    }

    const destination =
        args[2] && args[2].startsWith('0x') ? args[2] : myWallets.length > 0 ? myWallets[0].address : null;

    let providedTokenIds: bigint[] = [];
    const possibleTokenStr = args.find(
        (a: string) => !a.startsWith('0x') && !a.startsWith(`/${commandName}`) && /^[0-9,]+$/.test(a)
    );
    if (possibleTokenStr) {
        providedTokenIds = possibleTokenStr.split(',').filter(Boolean).map((t: string) => BigInt(t.trim()));
    }

    if (!destination) return ctx.reply('No destination provided and you have no sub-wallets.');
    const sourceWallets = myWallets.filter(w => w.address.toLowerCase() !== destination.toLowerCase());
    const importedN = getImportedWalletCount(userId);
    if (sourceWallets.length === 0) {
        return ctx.reply('No source wallets to sweep from (destination is your only wallet). Add sub-wallets or use a different destination.');
    }

    await ctx.reply(
        `🔎 ${providedTokenIds.length > 0 ? 'Sweeping specific token IDs' : 'Scanning collection across all wallets'} ` +
            `(<code>${contractAddress.slice(0, 10)}…</code> → <code>${destination.slice(0, 10)}…</code>)\n` +
            `<i>${sourceWallets.length} source wallet(s)${importedN > 0 ? ` incl. ${importedN} imported` : ''}</i>`,
        { parse_mode: 'HTML' }
    );

    try {
        const provider = getUserProvider(userId);
        const rpcUrl = state.userRPCs?.[userId] || process.env.PROVIDER_URL || state.providerUrl;
        const sweepResult = await sweepCollectionNfts(
            provider,
            sourceWallets,
            contractAddress,
            destination,
            providedTokenIds.length > 0 ? providedTokenIds : undefined,
            rpcUrl
        );

        if (sweepResult.tokenIdsFound === 0) {
            const alchemyHint = sweepResult.discoveryMethod.includes('no_alchemy')
                ? '\n\n⚠️ Add an Alchemy URL to <code>PROVIDER_URL</code> (comma-separated) or set <code>ALCHEMY_API_KEY</code> on Railway for reliable NFT discovery.'
                : '';
            await ctx.reply(
                `ℹ️ <b>No NFTs found</b> for this collection across ${sweepResult.scannedWallets} wallet(s).\n` +
                    `Contract: <code>${contractAddress}</code>\n` +
                    `Discovery: <i>${sweepResult.discoveryMethod || 'none'}</i>${alchemyHint}`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        if (sweepResult.sweptCount === 0) {
            const errNote =
                sweepResult.errors.length > 0
                    ? sweepResult.errors.slice(0, 5).join('\n')
                    : 'Transfers failed — check wallet ETH for gas.';
            await ctx.reply(
                `❌ <b>Sweep failed</b> — found ${sweepResult.tokenIdsFound} token(s) but moved <b>0</b>.\n\n` +
                    `<code>${errNote.slice(0, 3500)}</code>`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        const txLines =
            sweepResult.txHashes.length > 0
                ? '\n' +
                  sweepResult.txHashes
                      .slice(0, 5)
                      .map(h => `<a href="https://etherscan.io/tx/${h}">${h.slice(0, 14)}…</a>`)
                      .join('\n')
                : '';
        const errNote =
            sweepResult.errors.length > 0
                ? `\n<i>${sweepResult.errors.slice(0, 3).join('; ')}${sweepResult.errors.length > 3 ? '…' : ''}</i>`
                : '';

        await ctx.reply(
            `✅ <b>Collection sweep complete</b>\n` +
                `Swept: <b>${sweepResult.sweptCount}</b> / ${sweepResult.tokenIdsFound} NFT(s)\n` +
                `Wallets scanned: ${sweepResult.scannedWallets}\n` +
                `Destination: <code>${destination}</code>${txLines}${errNote}`,
            { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
    } catch (e: any) {
        ctx.reply(`❌ NFT sweep failed: ${e.message}`);
    }
}

bot.command('sweepnfts', async (ctx) => handleCollectionNftSweep(ctx, 'sweepnfts'));
bot.command('sweepcollection', async (ctx) => handleCollectionNftSweep(ctx, 'sweepcollection'));

bot.command('listingstatus', async (ctx) => {
    const collections = state.trackedCollections || [];
    const lines =
        collections.length === 0
            ? '<i>No collections on profit monitor. Add with /monitor &lt;contract&gt; &lt;floor_eth&gt;</i>'
            : collections
                  .map(
                      (c, i) =>
                          `${i + 1}. <code>${c.address.slice(0, 10)}…</code> target ≥ <b>${c.targetFloor}</b> ETH`
                  )
                  .join('\n');

    await ctx.reply(
        `📋 <b>Listing &amp; Offers Status</b>\n\n` +
            `<b>Profit cron:</b> ${profitInterval ? '✅ active (5m)' : '❌ stopped'}\n` +
            `<b>Auto-list on floor hit:</b> ✅ (via /monitor)\n` +
            `<b>Auto-delist:</b> ❌ not implemented\n\n` +
            `<b>Auto-accept offers:</b> ${AUTO_ACCEPT_OFFERS ? `✅ (min ${MIN_ACCEPT_OFFER_ETH} ETH)` : '❌ off'}\n` +
            `<b>Offer cron:</b> ${offerAcceptInterval ? '✅ active' : '❌ off'}\n` +
            `<b>Profit strikes:</b> ${botAnalytics.profitHits}\n\n` +
            `<b>Monitored collections (${collections.length}):</b>\n${lines}`,
        { parse_mode: 'HTML' }
    );
});

async function renderGuide(ctx: any, section: GuideSection = 'overview', isEdit = false): Promise<void> {
    const userId = ctx.from?.id.toString();
    const isAdminUser = userId === PERSONAL_ID;
    const text = getGuideContent(section, { isAdmin: isAdminUser, version: BOT_VERSION });
    const keyboard = getGuideKeyboard(section, isAdminUser);

    if (isEdit && ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...keyboard }).catch(
            () => {}
        );
        ctx.answerCbQuery().catch(() => {});
    } else {
        await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...keyboard });
    }
}

bot.command('guide', async (ctx) => {
    await renderGuide(ctx, 'overview', false);
});

bot.action(/^guide_(overview|mint|whales|wallets|engine|alerts|admin)$/, async (ctx) => {
    const cbData = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
    const section = parseGuideSection(cbData || '');
    if (!section) return ctx.answerCbQuery();
    if (section === 'admin' && ctx.from?.id.toString() !== PERSONAL_ID) {
        return ctx.answerCbQuery('Admin only.', { show_alert: true });
    }
    await renderGuide(ctx, section, true);
});

bot.action('guide_help', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('Send <code>/help</code> for the full flat command reference (2 messages).', {
        parse_mode: 'HTML',
    });
});

bot.command('help', async (ctx) => {
    const userId = ctx.from?.id.toString();
    const isAdmin = userId === PERSONAL_ID;

    const helpText1 = `
🤖 <b>Ultra Dads Minter — Command Guide (1/2)</b>
<i>All commands, all features. Tap /menu for the visual interface.</i>

━━━━━━━━━━━━━━
⚙️ <b>SYSTEM & ACCESS</b>
━━━━━━━━━━━━━━
<b>/start</b> — Boot the bot and open main menu.
<b>/unlock</b> <code>&lt;passphrase&gt;</code> — Enter the access code to use the bot.
<b>/ping</b> — Test bot responsiveness and network latency.
<b>/checkdb</b> (or <b>/db</b>) — Verify MongoDB persistence connection.

━━━━━━━━━━━━━━
🎯 <b>MINTING</b>
━━━━━━━━━━━━━━
<b>/dropmint</b> <code>&lt;url|contract|slug&gt; [eth] [time]</code>
  Batch-mint any drop from OpenSea URL, contract address, or collection slug. Supports instant or scheduled mints.
  <i>Examples:</i>
  • <code>/dropmint https://opensea.io/collection/azuki 0.08 now</code>
  • <code>/dropmint 0xBC4CA0... 0.05 14:30</code> (today at 14:30 UTC)
  • <code>/dropmint azuki 0.08 +10m</code> (in 10 minutes)

<b>/custommint</b> <code>&lt;contract&gt; &lt;eth&gt; &lt;mode&gt; &lt;args&gt;</code>
  The ABI Encoder Wizard — for mints the auto-copy-trade can't handle.
  <b>Modes:</b>
  • <code>tokenid &lt;id&gt;</code> — specific NFT token ID
  • <code>allowlist &lt;proof1,proof2&gt;</code> — Merkle proof gated
  • <code>phase &lt;id&gt;</code> — phased drop selector
  • <code>recipient &lt;0xAddr&gt;</code> — mintTo() a specific address
  • <code>sig "&lt;funcSig(types)&gt;" arg1,arg2</code> — any custom ABI
  • <code>raw 0xHexData</code> — raw calldata bypass
  <i>Example: <code>/custommint 0xABC 0.08 tokenid 4231</code></i>

<b>/mint</b> <code>&lt;url|contract&gt; [eth] [hex_data]</code>
  Standard batch mint. Resolves links instantly. If <code>[hex_data]</code> is omitted, it engages <b>Aggressive Auto-Detection</b> to find the max allowed per wallet.

<b>/automint</b> <code>&lt;on|off&gt;</code>
  Whale Copy-Trade mode. When ON, every tracked whale mint triggers an automatic clone across all your wallets.

<b>/forcesim</b>
  Toggles simulation on/off. If the bot is aborting mints, disabling this broadcasts blind (gas is wasted on reverts).

<b>/maxmint</b> <code>&lt;eth&gt;</code>
  Safety cap. Any mint above this ETH value is blocked automatically.

━━━━━━━━━━━━━━
📅 <b>SCHEDULING</b>
━━━━━━━━━━━━━━
<b>/scheduled</b> — List all pending drop missions.
<b>/cancelschedule</b> <code>&lt;id&gt;</code> — Cancel a queued mission by ID.
${isAdmin ? '\n<b>/freerpc</b> — (Admin) Cancel ALL scheduled + block snipes; pause mempool pending.\n<b>/freerpc resume</b> — Turn mempool back on. <b>/freerpc status</b> — Queue snapshot.' : ''}

━━━━━━━━━━━━━━
🐋 <b>WHALE TRACKER</b>
━━━━━━━━━━━━━━
<b>/track</b> <code>&lt;address&gt;</code> — Add a whale to monitor. (Personal)
<b>/untrack</b> <code>&lt;address&gt;</code> — Stop monitoring a whale. (Personal)
<b>/trackingprefs</b> — Alert & auto-mint sources (personal / global / community) + free-only vs free+paid copy-mint.
<b>/followglobal</b> <code>&lt;on|off&gt;</code> — Quick toggle global alerts + auto-mint.
<b>/mytracks</b> — View your personal tracking list & status.
<b>/globaltrack</b> <code>&lt;address&gt;</code> — (Admin) Add a whale to global list.
<b>/clearpersonaltracks</b> — (Admin) Clear all user-added personal tracks only.
<b>/cleartrack</b> — (Admin) Clear global + personal tracked wallets.
<b>/status</b> — Live overview of tracker, wallets, and bot config.
<b>/bind</b> — Run in a group to set it as the alert destination.

💡 <i>Tip: Drag & drop a .txt file of EVM addresses into chat to bulk-import whales!</i>`.trim();

    const helpText2 = `
🤖 <b>Ultra Dads Minter — Command Guide (2/2)</b>

━━━━━━━━━━━━━━
👛 <b>WALLETS</b>
━━━━━━━━━━━━━━
<b>/wallets</b> <code>[count|auto]</code> — View balances. Add a number to set wallet count.
<b>/wallet</b> <code>&lt;number&gt;</code> — DM yourself a specific wallet's address + private key.
<b>/deletewallet</b> <code>&lt;N&gt;</code> — Remove wallet #N (HD tail or imported).
<b>/cleanwallets</b> — Auto-remove trailing empty/unused wallets.
<b>/importwallet</b> <code>&lt;private_key&gt;</code> — Link an external wallet to copy-trade.
<b>/clearimported</b> — Remove all externally linked wallets.
${isAdmin ? '<b>/exportseed</b> — (Admin) Show MNEMONIC from env (DM only).\n<b>/clearseed</b> — (Admin) Purge legacy seed from saved state; reset admin HD fleet.\n<b>/freshadminwallets purge N</b> — Purge + prep N slots after env rotation.\n' : ''}<b>/exportwallets</b> — (DM only) Export all private keys for backup.

━━━━━━━━━━━━━━
💰 <b>FUNDS</b>
━━━━━━━━━━━━━━
<b>/distribute</b> <code>&lt;amount|all&gt;</code> — Send ETH from Wallet #1 to all sub-wallets.
<b>/sweep</b> <code>[address]</code> — Drain all ETH from sub-wallets into Wallet #1 (or given address).
<b>/walletname</b> <code>&lt;N&gt; &lt;label&gt;</code> — Name sub-wallet N (shown in copy-mint reports).
<b>/sweepnfts</b> <code>&lt;contract&gt; [dest] [tokenIds]</code> — Sweep collection NFTs to one wallet.
<b>/sweepcollection</b> — Alias for /sweepnfts (collection-scoped sweep).
<b>/listingstatus</b> — Auto-list monitor, profit cron, and auto-accept offers status.

━━━━━━━━━━━━━━
📡 <b>RPC & NETWORK</b>
━━━━━━━━━━━━━━
<b>/setrpc</b> <code>&lt;rpc_url|reset&gt;</code> — Set your private RPC node (Alchemy/Infura) for faster, rate-limit-free txs.
<b>/myrpc</b> — View your current RPC node.
<b>/chain</b> <code>&lt;rpc_url&gt;</code> — (Admin) Switch the system-wide RPC node (restarts tracker).

━━━━━━━━━━━━━━
🛡️ <b>GAS & MEV</b>
━━━━━━━━━━━━━━
<b>/bribe</b> <code>&lt;gwei|off&gt;</code> — Add a priority fee tip to front-run other bots.
<b>/overdrive</b> — Toggle hyper-aggressive 400% gas padding for sniping hype mints.
<b>/inclusion</b> <code>public|protected|builder</code> — Transaction routing (public mempool, MEV Blocker, or Flashbots bundle).
<b>/mev</b> <code>&lt;on|off&gt;</code> — Legacy alias for protected mode (anti-sandwich, not for FCFS sniping).

━━━━━━━━━━━━━━
📈 <b>PRICE MONITOR</b>
━━━━━━━━━━━━━━
<b>/monitor</b> <code>&lt;contract&gt; &lt;eth_floor&gt;</code> — (Admin) Alert group when NFT floor hits target.
<b>/unmonitor</b> <code>&lt;contract&gt;</code> — Stop monitoring a contract's floor.
${isAdmin ? `
━━━━━━━━━━━━━━
🔐 <b>ADMIN</b>
━━━━━━━━━━━━━━
<b>/setcode</b> <code>&lt;code|off&gt;</code> — Set or remove the bot access code.
<b>/listusers</b> — See all users with access.
<b>/lockuser</b> <code>&lt;user_id&gt;</code> — Revoke a user's access.
<b>/broadcast</b> <code>&lt;message&gt;</code> — Push a message to all users + the alert group.
<b>/discordbroadcast</b> <code>&lt;message&gt;</code> — Post to all configured Discord channels (parallel).
<b>/discordbroadcast_status</b> — List Discord broadcast target labels.
<b>/kick</b> <code>[count]</code> — Batch-kick recent group members.\n` +
`<b>/freerpc</b> — Cancel all scheduled drops + block snipes; pause mempool pending.\n` +
`<b>/freerpc resume</b> — Turn mempool back on. <b>/freerpc status</b> — queue snapshot.\n` +
`<b>/freshadminwallets</b> <code>5</code> or <code>import 3</code> — wipe bot wallet slots after key rotation.` : ''}

━━━━━━━━━━━━━━
ℹ️ <b>/menu</b> — Open the visual Command Center button interface.`.trim();

    await ctx.reply(helpText1, { parse_mode: 'HTML' });
    await ctx.reply(helpText2, { parse_mode: 'HTML' });
});

bot.command('clearseed', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const userId = ctx.from?.id.toString() || PERSONAL_ID;
    const hadStored = purgeStoredSeed(state);
    if (state.importedWallets?.[userId]) delete state.importedWallets[userId];
    if (state.userHdWalletExcluded?.[userId]) delete state.userHdWalletExcluded[userId];
    clearAllCompromisedWallets(state, userId);
    trimWalletLabels(state, userId, 0);
    state.userWallets[userId] = 0;
    await StateManager.save(state);
    await saveUserState(userId);

    await ctx.reply(
        uiScreen({
            icon: '🧹',
            title: 'Stored seed cleared',
            body:
                `Removed legacy seed from saved bot state (${hadStored ? 'was present' : 'already absent'}).\n` +
                `Admin HD fleet set to <b>0</b>; imports and ☠️ flags cleared.\n\n` +
                `Runtime still uses <code>MNEMONIC</code> from env until you rotate it on Railway.\n\n` +
                formatClearSeedInstructions(userId, 5),
        }),
        { parse_mode: 'HTML' }
    );
});

bot.command('exportseed', async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const userId = ctx.from?.id.toString() || PERSONAL_ID;
    const mnemonic = getBotMnemonic();
    if (!mnemonic) {
        return ctx.reply(
            '❌ <b>No MNEMONIC in environment</b>\n\n' +
                'Set <code>MNEMONIC</code> on Railway/host only — it is never read from saved state.\n' +
                'After compromise use <code>/clearseed</code> then rotate env and redeploy.',
            { parse_mode: 'HTML' }
        );
    }
    const msg =
        `🌱 <b>Bot Master Seed (env only)</b>\n\n<code>${mnemonic}</code>\n\n` +
        `⚠️ <i>Derives every user's HD wallets. Never commit or paste into chats.</i>\n\n` +
        `💾 <b>Rotation:</b> <code>/clearseed</code> → new Railway <code>MNEMONIC</code> → redeploy → <code>/freshadminwallets purge N</code>`;

    if (ctx.chat.type !== 'private') {
        try { await ctx.deleteMessage(); } catch (e) { }
        try {
            await bot.telegram.sendMessage(userId, msg, { parse_mode: 'HTML' });
            ctx.reply(`✅ @${ctx.from?.username || 'User'}, your Seed Phrase was sent to your DMs.`);
        } catch (e) {
            ctx.reply(`❌ @${ctx.from?.username || 'User'}, Failed to DM you. Ensure you have started a private chat with the bot first.`);
        }
    } else {
        await ctx.reply(msg, { parse_mode: 'HTML' });
    }
});

// ==========================================
// DROP MINT SCHEDULER (commands)
// ==========================================

if (runsMintCommandServices(BOT_ROLE)) {
registerDropMintHandlers(bot, dropMintSchedulerDeps());
}

// ==========================================
// BLOCK-TARGETED MINT (per-block cap contracts, e.g. OEGP)
// ==========================================

function buildBlockMintFireContext(job: BlockMintJob): BlockMintFireContext {
    const userId = job.addedBy;
    return {
        provider: getUserProvider(userId) as JsonRpcProvider,
        privateKeys: getUserMintWallets(userId).map(w => w.privateKey),
        options: mintOptionsForUser(userId, {
            skipSimulation: true,
            skipClassification: true,
            allowUnknownPayment: true,
            paymentPrevalidated: true,
        }),
        hasActiveAccess: () => hasCachedMintDashAccess(userId),
        notify: async html => {
            await safeSendTelegram(userId, html, {
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
            });
        },
        onResults: async (results, j, blockNumber) => {
            results.forEach(r => {
                (r as { uid?: string }).uid = userId;
            });
            const alertDest = state.alertChatId || GROUP_ID;
            const setterLabel = userLabelFromStored(j.addedBy, j.addedByUsername, j.addedByFirstName);
            const mintedByLabel = `Block mint by ${setterLabel}`;
            const pending = await safeSendTelegram(
                userId,
                `⛏️ Block #${blockNumber} — confirming ${results.length} tx(s)…`,
                { parse_mode: 'HTML' }
            ).catch(() => null);
            const mempoolLinks = buildMempoolLinksFromResults(results);
            await monitorTransactions(
                userId,
                results,
                '✅ <b>Block mint confirmed</b>',
                mempoolLinks,
                pending?.message_id,
                {
                    contractAddress: j.contract,
                    provider: getUserProvider(userId) as JsonRpcProvider,
                    valueEth: j.valueEth,
                    mintedByLabel,
                }
            );
            if (alertDest !== userId) {
                await monitorTransactions(alertDest, results, '✅ <b>Block mint confirmed</b>', '', undefined, {
                    contractAddress: j.contract,
                    provider: getUserProvider(userId) as JsonRpcProvider,
                    valueEth: j.valueEth,
                    mintedByLabel,
                    sendUserDms: false,
                });
            }
        },
        onComplete: async (j) => {
            const entry = state.blockMintJobs?.find(x => x.id === j.id);
            if (entry) {
                entry.fired = j.fired;
                entry.cancelled = j.cancelled;
                entry.blocksRemaining = j.blocksRemaining;
            }
            await StateManager.save(state).catch(() => {});
        },
    };
}

function persistBlockMintJob(job: BlockMintJob): void {
    if (!state.blockMintJobs) state.blockMintJobs = [];
    state.blockMintJobs.push(job);
}

// /blockmint <contract> [free|oegp|auto|raw] [block | every N]
bot.command('blockmint', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    if (isOnCooldown(userId, 4000)) {
        return ctx.reply('⏳ Wait a few seconds between block mint commands.');
    }

    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    const sub = (parts[0] || '').toLowerCase();

    if (sub === 'list') {
        const mine = (state.blockMintJobs || []).filter(j => !j.fired && !j.cancelled && j.addedBy === userId);
        const active = getActiveBlockMintJobs().filter(j => j.addedBy === userId);
        if (mine.length === 0 && active.length === 0) {
            return ctx.reply('📭 No active block mint jobs.');
        }
        let text = `⛏️ <b>Active block mints</b>\n\n`;
        for (const j of mine.length ? mine : active) {
            text +=
                `• <code>${j.id}</code> ${j.label}\n` +
                `  <code>${j.contract.slice(0, 10)}…</code> | ` +
                `${j.strategy === 'every' ? `every block × ${j.blocksRemaining}` : `block #${j.targetBlock}`}\n`;
        }
        return ctx.reply(text, { parse_mode: 'HTML' });
    }

    if (sub === 'cancel') {
        const id = parts[1];
        if (!id) return ctx.reply('Usage: <code>/blockmint cancel &lt;id&gt;</code>', { parse_mode: 'HTML' });
        const job = state.blockMintJobs?.find(j => j.id === id && j.addedBy === userId);
        if (!job) return ctx.reply('❌ Job not found.');
        job.cancelled = true;
        job.fired = true;
        cancelBlockMint(id);
        await StateManager.save(state);
        return ctx.reply(`✅ Cancelled block mint <code>${id}</code>`, { parse_mode: 'HTML' });
    }

    const contract = parts[0];
    if (!contract?.startsWith('0x') || contract.length !== 42) {
        return ctx.reply(
            `⛏️ <b>Block Mint</b> — fire when a target block arrives.\n\n` +
                `<b>OEGP example (free per block):</b>\n` +
                `<code>/blockmint ${OEGP_CONTRACT} free next</code>\n` +
                `<code>/blockmint ${OEGP_CONTRACT} free every 20</code>\n` +
                `<code>/blockmint ${OEGP_CONTRACT} free at 25109000</code>\n\n` +
                `<b>Generic:</b>\n` +
                `<code>/blockmint 0xContract auto next</code>\n` +
                `<code>/blockmint 0xContract raw 0.01 0xCalldata next</code>\n\n` +
                `<code>/blockmint list</code> · <code>/blockmint cancel &lt;id&gt;</code>`,
            { parse_mode: 'HTML' }
        );
    }

    let i = 1;
    let mintMode = contract.toLowerCase() === OEGP_CONTRACT ? 'free' : 'auto';
    if (['free', 'oegp', 'auto', 'raw'].includes((parts[i] || '').toLowerCase())) {
        mintMode = parts[i].toLowerCase();
        i++;
    }

    let valueEth: string | undefined;
    let rawData: string | undefined;
    if (mintMode === 'raw') {
        valueEth = parts[i++];
        rawData = parts[i++];
        if (!rawData?.startsWith('0x')) {
            return ctx.reply('raw mode: <code>/blockmint 0x… raw &lt;eth&gt; &lt;0xdata&gt; next</code>', {
                parse_mode: 'HTML',
            });
        }
    }

    const provider = getUserProvider(userId) as JsonRpcProvider;
    let currentBlock: number;
    try {
        currentBlock = await provider.getBlockNumber();
    } catch (e: unknown) {
        return ctx.reply(`❌ RPC error: ${(e as Error).message?.slice(0, 80)}`);
    }

    let strategy: 'once' | 'every' = 'once';
    let blocksRemaining = 1;
    let targetBlock = currentBlock + 1;

    const spec = (parts[i] || 'next').toLowerCase();
    if (spec === 'every') {
        strategy = 'every';
        targetBlock = currentBlock + 1;
        blocksRemaining = Math.max(1, parseInt(parts[i + 1] || '1', 10));
    } else if (spec === 'at' && parts[i + 1]) {
        targetBlock = parseBlockTarget(parts[i + 1], currentBlock);
    } else {
        targetBlock = parseBlockTarget(spec, currentBlock);
    }

    try {
        const mintAvail = assertMintWalletAvailable(state, userId);
        if (!mintAvail.ok) return ctx.reply(mintAvail.message, { parse_mode: 'HTML' });
        const wallets = getUserMintWallets(userId);
        const resolved = await resolveBlockMintCalldata({
            contract,
            mintMode,
            rawData,
            valueEth,
            provider,
            minterAddress: wallets[0]?.address,
        });

        const id = `bm_${Date.now().toString(36)}`;
        const job: BlockMintJob = {
            id,
            label: resolved.label,
            contract: contract.toLowerCase(),
            sourceInput: contract,
            executionTo: resolved.executionTo,
            valueEth: resolved.valueEth,
            data: resolved.data,
            strategy,
            targetBlock,
            blocksRemaining,
            addedBy: userId,
            addedByUsername: ctx.from?.username,
            addedByFirstName: ctx.from?.first_name,
        };

        persistBlockMintJob(job);
        armBlockMint(job, buildBlockMintFireContext(job));
        await StateManager.save(state);

        await notifyAdminUserAction(
            { userId, username: ctx.from?.username, firstName: ctx.from?.first_name, lastName: ctx.from?.last_name },
            `⛏️ <b>Block mint armed</b> <code>${id}</code>\n` +
                `Contract: <code>${contract}</code>\n` +
                `Call: ${resolved.label} · <b>${resolved.valueEth} ETH</b>\n` +
                `Wallets: ${getUserWallets(userId).length}`
        );

        const strategyLine =
            strategy === 'every'
                ? `Mint <b>every block</b> for <b>${blocksRemaining}</b> blocks (from #${targetBlock})`
                : `Mint when block <b>≥ #${targetBlock}</b> (current #${currentBlock})`;

        return ctx.reply(
            `⛏️ <b>Block mint armed</b> <code>${id}</code>\n\n` +
                `Contract: <code>${contract}</code>\n` +
                `Call: ${resolved.label} · <b>${resolved.valueEth} ETH</b>\n` +
                `${strategyLine}\n` +
                `Wallets: ${getUserWallets(userId).length}\n\n` +
                `<i>Uses blind broadcast + base gas. Cancel: /blockmint cancel ${id}</i>`,
            { parse_mode: 'HTML' }
        );
    } catch (err: unknown) {
        return ctx.reply(`❌ ${(err as Error).message?.slice(0, 200)}`);
    }
});

// Start the bot processing
async function main() {
    console.log(`🚀 Starting ${SERVICE_NAME} (role=${BOT_ROLE})…`);
    console.log(`📡 Memory System: ${process.env.MONGODB_URI ? 'MongoDB Atlas (Persistent)' : 'Local state.json (Ephemeral)'}`);
    state = await StateManager.load();
    syncCapacityOverridesFromState(state);

    if (mintDashAccessRequired()) {
        const knownUsers = Object.keys(state.userWallets);
        try {
            await refreshMintDashEntitlements(knownUsers);
            console.log(`[MintDashAccess] Prewarmed ${knownUsers.length} Telegram entitlement(s).`);
        } catch (error) {
            console.error(
                '[MintDashAccess] Startup prewarm failed; automated execution remains fail-closed:',
                (error as Error).message?.slice(0, 160)
            );
        }
        startMintDashEntitlementRefresh(() => Object.keys(state.userWallets));
    }

    // Initialize legacy arrays array if empty
    if (Object.keys(state.userWallets).length === 0) {
        console.log('No user wallets found initialized in JSON. Ready for users.');
    }

    if (process.env.PROVIDER_URL || state.providerUrl) {
        await warmDedupeLedger();
        if (runsCopyMintServices(BOT_ROLE)) {
            startTracker();
            syncTracker();
            const bootAudit = buildTrackingAudit(state, tracker);
            console.log(
                `[Tracker] Boot audit: union=${bootAudit.unionCount} watching=${bootAudit.trackerWatching} ` +
                    `running=${bootAudit.trackerRunning} issues=${bootAudit.issues.join(',') || 'none'}`
            );
        } else {
            console.log('[Tracker] Skipped — mint-command-bot role (no whale listener).');
        }
        if (runsMintCommandServices(BOT_ROLE)) {
            startProfitCron();
            startOfferAcceptCron();
        }
    } else {
        console.warn('⚠️ No Provider URL set. Tracker not started.');
    }

    if (runsMintCommandServices(BOT_ROLE)) {
        rearmPendingDropMints(dropMintSchedulerDeps());

        if (state.blockMintJobs?.length) {
            const pendingBlocks = state.blockMintJobs.filter(j => !j.fired && !j.cancelled);
            if (pendingBlocks.length > 0) {
                log('info', `[BlockMint] Re-arming ${pendingBlocks.length} block mint job(s)...`);
                rearmBlockMints(pendingBlocks, buildBlockMintFireContext);
            }
        }
    }

    try {
        await registerTelegramCommandsForRole(bot, BOT_ROLE, {
            includeAdminSeedCommands: Boolean(PERSONAL_ID),
        });
    } catch (e) {
        console.error('⚠️ Failed to set Telegram menu commands:', e);
    }

    // Telegraf Polling Error Handler (prevents 409 Conflict crashes)
    bot.catch((err: any, ctx) => {
        console.error(`[Telegraf Error] for ${ctx.updateType}:`, err.message || err);
    });

    // Global Node.js Error Handlers (prevents silent process deaths)
    process.on('uncaughtException', (err) => {
        console.error('[Uncaught Exception] Bot recovered from critical crash:', err);
    });
    process.on('unhandledRejection', (reason, _promise) => {
        console.error('[Unhandled Rejection] Promise dropped but safely caught:', reason);
    });

    async function runPostLaunchAnnounce() {
        const enabled = process.env.AUTO_VERSION_ANNOUNCE === 'true';
        const mongoOk = StateManager.isConnected();
        const hasNotes = Boolean(getVersionChangelogBody(BOT_VERSION));
        console.log(
            `[AutoAnnounce] startup: version=v${BOT_VERSION} enabled=${enabled} mongo=${mongoOk} ` +
                `hasChangelog=${hasNotes} lastAnnounced=${state.lastAnnouncedVersion ?? 'none'}`
        );
        if (!enabled) {
            console.log('[AutoAnnounce] Skipped — opt-in only (set AUTO_VERSION_ANNOUNCE=true to enable).');
            return;
        }

        if (state.lastAnnouncedVersion === BOT_VERSION) {
            console.log(`[AutoAnnounce] State already recorded v${BOT_VERSION} — skipping.`);
            return;
        }

        if (await StateManager.hasVersionBeenAnnounced(BOT_VERSION)) {
            state.lastAnnouncedVersion = BOT_VERSION;
            console.log(`[AutoAnnounce] Ledger already has v${BOT_VERSION} — skipping broadcast.`);
            await StateManager.save(state).catch(() => {});
            return;
        }

        const changelog = buildVersionAnnounceMessage(BOT_VERSION);
        if (!changelog) {
            console.warn(
                `[AutoAnnounce] No release notes for v${BOT_VERSION}. ` +
                    `Add src/bot/versionChangelog.ts entry or set VERSION_CHANGELOG — not broadcasting.`
            );
            return;
        }

        const claimed = await StateManager.claimVersionAnnounce(BOT_VERSION);
        if (!claimed) {
            state.lastAnnouncedVersion = BOT_VERSION;
            console.log(`[AutoAnnounce] v${BOT_VERSION} claim lost (race) — skipping broadcast.`);
            await StateManager.save(state).catch(() => {});
            return;
        }

        const delayMs = parseInt(process.env.VERSION_ANNOUNCE_DELAY_MS || '5000', 10);
        if (delayMs > 0) {
            console.log(`[AutoAnnounce] v${BOT_VERSION} claimed — broadcasting in ${delayMs}ms...`);
            await new Promise(r => setTimeout(r, delayMs));
        } else {
            console.log(`[AutoAnnounce] v${BOT_VERSION} claimed — broadcasting now...`);
        }

        await broadcastToAll(changelog, { parse_mode: 'HTML' });
        state.lastAnnouncedVersion = BOT_VERSION;
        await StateManager.save(state).catch((e) =>
            console.error('[AutoAnnounce] Failed to persist lastAnnouncedVersion:', (e as Error).message)
        );
    }

    async function launchTelegramWebhook(cfg: TelegramWebhookConfig) {
        const url = `${cfg.baseUrl}${cfg.path}`;
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        await new Promise(r => setTimeout(r, 3000));
        await bot.telegram.setWebhook(url, {
            drop_pending_updates: true,
            secret_token: cfg.secret,
        });
        const info = await bot.telegram.getWebhookInfo();
        console.log(`✅ Telegram webhook active: ${info.url || url}`);
        if (info.last_error_message) {
            console.warn(`[Telegram] Webhook last error: ${info.last_error_message}`);
        }
        if ((info.pending_update_count ?? 0) > 0) {
            console.log(`[Telegram] Pending updates: ${info.pending_update_count}`);
        }
        telegramReady = 'ready';
        await runPostLaunchAnnounce();
    }

    async function launchTelegramPolling(retries = 5) {
        const delayMs = parseInt(process.env.TELEGRAM_LAUNCH_DELAY_MS || '0', 10);
        if (delayMs > 0) {
            console.log(`[Telegram] Waiting ${delayMs}ms before polling (deploy overlap guard)...`);
            await new Promise(r => setTimeout(r, delayMs));
        }

        try {
            await bot.telegram.deleteWebhook({ drop_pending_updates: true });
            await new Promise(r => setTimeout(r, 2000));
            telegramReady = 'not_ready';
            await bot.launch({ dropPendingUpdates: true }, () => {
                // Telegraf's polling promise remains pending for the lifetime of
                // the bot. Its launch callback fires once getMe succeeds and the
                // long-polling startup path has been entered.
                telegramReady = 'ready';
                console.log('✅ Telegram bot polling started!');
                void runPostLaunchAnnounce().catch((announceErr) =>
                    console.error('[AutoAnnounce] Post-launch task failed:', announceErr)
                );
            });
        } catch (err: any) {
            telegramReady = 'not_ready';
            if (err.message?.includes('409') && retries > 0) {
                console.warn(
                    `⚠️ Telegram 409: another process is polling this token. ` +
                        `Stop local "npm run start:bot" or set TELEGRAM_WEBHOOK_MODE=true on Railway. ` +
                        `Retry in 15s... (${retries} left)`
                );
                try {
                    bot.stop('409-conflict');
                } catch {
                    // ignore
                }
                await new Promise(r => setTimeout(r, 15000));
                return launchTelegramPolling(retries - 1);
            }
            console.error('❌ Telegram polling failed:', err.message || err);
            console.error(
                '   Fix: Railway → Variables → TELEGRAM_WEBHOOK_MODE=true and redeploy, OR stop all other bot instances.'
            );
        }
    }

    if (telegramWebhookConfig) {
        launchTelegramWebhook(telegramWebhookConfig).catch((e) =>
            console.error('❌ Telegram webhook setup failed:', (e as Error).message)
        );
    } else {
        launchTelegramPolling().catch(console.error);
    }

    async function gracefulShutdown(signal: string) {
        console.log(`[Shutdown] ${signal} received. Cleaning up...`);
        try {
            bot.stop(signal);
        } catch {
            // ignore
        }
        if (telegramWebhookConfig) {
            await bot.telegram.deleteWebhook().catch(() => {});
        }
        if (tracker) tracker.stop();
        await flushSave(state).catch(() => {});
        if (mongoose.connection.readyState === 1) await mongoose.disconnect().catch(() => {});
    }

    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

if (HEALTH_ONLY_MODE) {
    console.warn(
        `[Boot] ${SERVICE_NAME} is staged in health-only mode; Telegram, trackers, schedulers, and transaction execution are disabled.`
    );
} else {
    main();
}
