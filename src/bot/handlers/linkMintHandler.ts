/**
 * Link Mint Handler — watches Telegram messages for pasted mint targets.
 *
 * When a user pastes a contract address, Etherscan link, OpenSea link, etc.,
 * this handler detects it, resolves the contract, and either:
 *   - Shows a preview with Mint/DryRun/Cancel buttons (default)
 *   - Auto-executes if AUTO_MINT_FROM_LINKS=true
 *
 * Does NOT interfere with existing /commands (text starting with / is skipped).
 * Resolve runs async with a per-chat+contract lock so webhook ACK is not blocked.
 */

import { Markup } from 'telegraf';
import type { Context } from 'telegraf';
import {
    detectMintTargetFromMessage,
    resolveMintTargetWithDeadline,
    validateMintTarget,
    buildPreviewMessage,
    loadLinkMintConfig,
    recordLinkMintExecution,
} from '../../services/linkMintService';
import { rpcRetry, sleepRpcGap, withSerializedRpc } from '../../services/rpcLimiter';
import type { ResolvedMintTarget, MintTargetCandidate } from '../../services/linkMintService';
import {
    contractKeyFromCandidate,
    inflightResolveKey,
    noteWebhookUpdate,
    releaseResolveLock,
    setResolveLockStatusMsg,
    tryAcquireResolveLock,
} from '../../services/linkMintResolveLock';
import { getBatchMintSession } from './batchMintWizard';
import { dropMintWizardExpectsText } from './dropMintWizard';
import { formatTelegramUserLabel } from '../telegramFormat';
import { formatLinkMintResolving, uiScreen } from '../ui/premiumMessages';
import { extractScatterSlug } from '../../services/scatterMint';

function linkMintExecuteOptions(resolved: ResolvedMintTarget, config: ReturnType<typeof loadLinkMintConfig>, extra?: Record<string, unknown>) {
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

// Store pending targets for confirmation buttons
const pendingTargets = new Map<
    string,
    { target: ResolvedMintTarget; userId: string; actorLabel?: string; timestamp: number }
>();

function actorLabelFromCtx(ctx: Context): string | undefined {
    const userId = ctx.from?.id?.toString();
    if (!userId) return undefined;
    return formatTelegramUserLabel({
        userId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
    });
}

// Cleanup old pending targets every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of pendingTargets) {
        if (now - val.timestamp > 600_000) pendingTargets.delete(key);
    }
}, 300_000);

async function processLinkMintResolve(
    ctx: Context,
    candidate: MintTargetCandidate,
    lockKey: string,
    statusMsgId: number | undefined,
    userId: string,
    getUserWallets: (uid: string) => { address: string; privateKey: string }[],
    getProvider: (() => any) | undefined,
    executeMint: (userId: string, contract: string, data: string, value: string, options: any) => Promise<any>,
    config: ReturnType<typeof loadLinkMintConfig>
): Promise<void> {
    const chatId = ctx.chat!.id;
    try {
        const provider = getProvider?.();
        const wallets = getUserWallets(userId);
        const resolved = await resolveMintTargetWithDeadline(candidate, provider, wallets[0]?.address);

        if (statusMsgId) {
            await ctx.telegram.deleteMessage(chatId, statusMsgId).catch(() => {});
        }
        if (!resolved) {
            return;
        }

        if (wallets.length === 0) {
            await ctx
                .reply(
                    uiScreen({
                        icon: '⚠️',
                        title: 'No wallets',
                        body: 'Configure your fleet first with <code>/wallets</code>.',
                    }),
                    { parse_mode: 'HTML' }
                )
                .catch(() => {});
            return;
        }

        const validation = validateMintTarget(resolved, wallets.length);
        const preview = buildPreviewMessage(resolved, wallets.length);

        if (!validation.valid) {
            await ctx
                .reply(
                    `${preview}\n\n✗ <b>Cannot mint</b>\n${validation.errors.map(e => `• ${e}`).join('\n')}`,
                    { parse_mode: 'HTML' }
                )
                .catch(() => {});
            return;
        }

        const targetId = `lm_${Date.now().toString(36)}`;
        pendingTargets.set(targetId, {
            target: resolved,
            userId,
            actorLabel: actorLabelFromCtx(ctx),
            timestamp: Date.now(),
        });

        if (config.autoMintFromLinks && !config.confirmationRequired) {
            await ctx
                .reply(`${preview}\n\n⚡ <i>Auto-executing…</i>`, { parse_mode: 'HTML' })
                .catch(() => {});
            try {
                await executeMint(
                    userId,
                    resolved.contractAddress,
                    resolved.suggestedCalldata || '0x1249c58b',
                    resolved.suggestedValue || '0',
                    linkMintExecuteOptions(resolved, config, {
                        actorLabel: actorLabelFromCtx(ctx),
                        originChatId: ctx.chat!.id.toString(),
                    })
                );
                recordLinkMintExecution(resolved);
            } catch (err: any) {
                await ctx.reply(`❌ Execution failed: ${err.message?.slice(0, 100)}`).catch(() => {});
            }
            return;
        }

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('Mint now', `linkmint_exec_${targetId}`),
                Markup.button.callback('Dry run', `linkmint_dry_${targetId}`),
            ],
            [
                Markup.button.callback('Cancel', `linkmint_cancel_${targetId}`),
                Markup.button.callback('Etherscan', `linkmint_view_${targetId}`),
            ],
        ]);

        await ctx.reply(preview, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } catch (err) {
        if (statusMsgId) {
            await ctx.telegram.deleteMessage(chatId, statusMsgId).catch(() => {});
        }
        await ctx
            .reply(`❌ Resolve failed: ${((err as Error).message || 'unknown').slice(0, 120)}`, {
                parse_mode: 'HTML',
            })
            .catch(() => {});
        console.error('[LinkMint] Error processing target:', (err as Error).message);
    } finally {
        releaseResolveLock(lockKey);
    }
}

/**
 * Register the link mint handler on a Telegraf bot instance.
 * Call this from index.ts after bot initialization.
 */
export function registerLinkMintHandler(
    bot: any,
    getPersonalId: () => string,
    getUserWallets: (uid: string) => { address: string; privateKey: string }[],
    executeMint: (userId: string, contract: string, data: string, value: string, options: any) => Promise<any>,
    getProvider?: () => any
) {
    const config = loadLinkMintConfig();

    bot.on('text', async (ctx: Context, next: () => Promise<void>) => {
        const text = (ctx.message as any)?.text;
        if (!text || text.startsWith('/')) return next();

        const userId = ctx.from?.id?.toString();
        if (!userId) return next();

        if (config.adminOnly && userId !== getPersonalId()) {
            return next();
        }

        if (getBatchMintSession(userId) || dropMintWizardExpectsText(userId)) return next();

        const candidates = detectMintTargetFromMessage(text);
        if (candidates.length === 0) {
            return next();
        }

        const candidate = candidates[0];
        const contractKey = contractKeyFromCandidate(candidate.target);
        const chatId = ctx.chat!.id.toString();
        const lockKey = inflightResolveKey(chatId, contractKey);

        const updateId = ctx.update.update_id;
        const webhookNote = noteWebhookUpdate(updateId);
        if (webhookNote === 'duplicate') {
            return;
        }

        const lock = tryAcquireResolveLock(lockKey);
        if (!lock.acquired) {
            if (lock.entry.statusMsgId) {
                await ctx.telegram
                    .editMessageText(
                        chatId,
                        lock.entry.statusMsgId,
                        undefined,
                        formatLinkMintResolving().replace('Resolving mint', 'Still resolving mint'),
                        { parse_mode: 'HTML' }
                    )
                    .catch(() => {});
            }
            return;
        }

        const statusMsg = await ctx
            .reply(formatLinkMintResolving(), { parse_mode: 'HTML' })
            .catch(() => null);
        const statusMsgId = statusMsg?.message_id;
        if (statusMsgId) setResolveLockStatusMsg(lockKey, statusMsgId);

        void processLinkMintResolve(
            ctx,
            candidate,
            lockKey,
            statusMsgId,
            userId,
            getUserWallets,
            getProvider,
            executeMint,
            config
        );
    });

    // ---- Button callbacks ----

    bot.action(/^linkmint_exec_(.+)$/, async (ctx: any) => {
        const targetId = ctx.match[1];
        const pending = pendingTargets.get(targetId);
        if (!pending) return ctx.answerCbQuery('Target expired. Paste the link again.', { show_alert: true });
        if (pending.userId !== ctx.from?.id?.toString()) return ctx.answerCbQuery('Not your target.', { show_alert: true });

        pendingTargets.delete(targetId);

        ctx.answerCbQuery('Executing...');
        await ctx.editMessageText(`🚀 <b>Executing mint...</b>\nContract: <code>${pending.target.contractAddress}</code>`, { parse_mode: 'HTML' }).catch(() => {});

        try {
            await executeMint(
                pending.userId,
                pending.target.contractAddress,
                pending.target.suggestedCalldata || '0x1249c58b',
                pending.target.suggestedValue || '0',
                linkMintExecuteOptions(pending.target, config, {
                    actorLabel: pending.actorLabel || actorLabelFromCtx(ctx),
                    originChatId: ctx.chat!.id.toString(),
                })
            );
            recordLinkMintExecution(pending.target);
        } catch (err: any) {
            await ctx.reply(`❌ Execution failed: ${err.message?.slice(0, 100)}`).catch(() => {});
        }
    });

    bot.action(/^linkmint_dry_(.+)$/, async (ctx: any) => {
        const targetId = ctx.match[1];
        const pending = pendingTargets.get(targetId);
        if (!pending) return ctx.answerCbQuery('Target expired.', { show_alert: true });

        ctx.answerCbQuery('Running dry-run simulation...');
        const prov = getProvider?.();
        const wallets = getUserWallets(pending.userId);
        if (!prov || !wallets[0]) {
            await ctx
                .editMessageText(
                    `🧪 <b>Dry Run</b>\nContract: <code>${pending.target.contractAddress}</code>\n<i>No RPC or wallet — cannot simulate.</i>`,
                    { parse_mode: 'HTML' }
                )
                .catch(() => {});
            return;
        }
        try {
            const gas: bigint = await withSerializedRpc(async () => {
                await sleepRpcGap();
                return rpcRetry(
                    () =>
                        prov.estimateGas({
                            to: pending.target.executionTo || pending.target.contractAddress,
                            data: pending.target.suggestedCalldata || '0x1249c58b',
                            value: pending.target.suggestedValue || '0',
                            from: wallets[0].address,
                        }),
                    'linkDryRun'
                );
            });
            await ctx
                .editMessageText(
                    `🧪 <b>Dry Run OK</b>\nContract: <code>${pending.target.contractAddress}</code>\nSelector: <code>${pending.target.detectedSelector}</code>\nGas estimate: <code>${gas.toString()}</code>\n<i>No funds spent.</i>`,
                    { parse_mode: 'HTML' }
                )
                .catch(() => {});
        } catch (e: any) {
            const msg = (e?.message || e || 'unknown error').toString().slice(0, 400);
            await ctx
                .editMessageText(`🧪 <b>Dry Run Failed</b>\n<code>${msg.replace(/</g, '&lt;')}</code>`, { parse_mode: 'HTML' })
                .catch(() => {});
        }
    });

    bot.action(/^linkmint_cancel_(.+)$/, async (ctx: any) => {
        const targetId = ctx.match[1];
        pendingTargets.delete(targetId);
        ctx.answerCbQuery('Cancelled.');
        await ctx.editMessageText('❌ Link mint cancelled.').catch(() => {});
    });

    bot.action(/^linkmint_view_(.+)$/, async (ctx: any) => {
        const targetId = ctx.match[1];
        const pending = pendingTargets.get(targetId);
        if (!pending) return ctx.answerCbQuery('Target expired.', { show_alert: true });
        ctx.answerCbQuery(`https://etherscan.io/address/${pending.target.contractAddress}`, { show_alert: true });
    });
}
