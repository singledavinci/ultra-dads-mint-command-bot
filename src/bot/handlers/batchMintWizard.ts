/**
 * Interactive batch mint wizard — resolve target, gas tiers (gwei + USD), then broadcast.
 */

import { Markup } from 'telegraf';
import { parseEther } from 'ethers';
import {
    detectMintTargetFromMessage,
    resolveMintTarget,
    type ResolvedMintTarget,
} from '../../services/linkMintService';
import {
    formatSeaDropBlockedWizardMessage,
    shouldBlockBatchMintForSeaDrop,
} from '../../services/seaDropUx';
import { buildGasAdvisorReport, formatGasAdvisorMessage } from '../../services/gasAdvisor';
import {
    formatBatchMintBroadcasting,
    formatBatchMintWizardStart,
    uiScreen,
} from '../ui/premiumMessages';
import { batchCopyTrade } from '../../utils/mintCore';

export interface BatchMintWizardDeps {
    getUserWallets: (uid: string) => { address: string; privateKey: string }[];
    getUserProvider: (uid: string) => any;
    walletLine: (uid: string, index: number, suffix: string) => string;
    getImportedWalletCount?: (uid: string) => number;
    getHdWalletKeyCount?: (uid: string) => number;
    isAdminUser?: (uid: string) => boolean;
}

interface BatchMintSession {
    userId: string;
    step: 'contract' | 'value' | 'gas';
    contractInput?: string;
    valueEth: string;
    resolved?: ResolvedMintTarget;
    gasReportJson?: string;
    timestamp: number;
}

const sessions = new Map<string, BatchMintSession>();

setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions) {
        if (now - s.timestamp > 600_000) sessions.delete(k);
    }
}, 300_000);

function sessionKey(userId: string): string {
    return userId;
}

export function getBatchMintSession(userId: string): BatchMintSession | undefined {
    return sessions.get(sessionKey(userId));
}

export function clearBatchMintSession(userId: string): void {
    sessions.delete(sessionKey(userId));
}

/** User-selected mint price overrides on-chain suggestion for simulation + broadcast. */
function applyUserMintValue(resolved: ResolvedMintTarget, valueEth: string): ResolvedMintTarget {
    const wei = parseEther(valueEth || '0');
    return {
        ...resolved,
        suggestedValue: wei > 0n ? '0x' + wei.toString(16) : '0x0',
    };
}

async function resolveForUser(
    input: string,
    userId: string,
    deps: BatchMintWizardDeps
): Promise<ResolvedMintTarget | null> {
    const wallets = deps.getUserWallets(userId);
    const provider = deps.getUserProvider(userId);
    const candidates = detectMintTargetFromMessage(input);
    const candidate = candidates[0] || {
        originalText: input.trim(),
        target: input.trim(),
        type: 'raw_address' as const,
        confidence: 'medium' as const,
    };
    return resolveMintTarget(candidate, provider, wallets[0]?.address);
}

async function showGasStep(
    ctx: any,
    session: BatchMintSession,
    deps: BatchMintWizardDeps,
    edit = false
): Promise<void> {
    const wallets = deps.getUserWallets(session.userId);
    const provider = deps.getUserProvider(session.userId);
    if (!session.resolved || wallets.length === 0) {
        await ctx.reply('⚠️ No wallets or unresolved target.').catch(() => {});
        return;
    }

    const mintEth = parseFloat(session.valueEth || '0');
    const r = session.resolved;
    const est = await buildGasAdvisorReport({
        provider,
        walletCount: wallets.length,
        mintValueEth: mintEth,
        estimateGas: {
            to: r.executionTo || r.contractAddress,
            data: r.suggestedCalldata || '0x1249c58b',
            value: r.suggestedValue || '0',
            from: wallets[0].address,
        },
    });

    session.gasReportJson = JSON.stringify(est);
    session.step = 'gas';
    session.timestamp = Date.now();

    const targetLine =
        r.executionTo.toLowerCase() !== r.contractAddress.toLowerCase()
            ? `NFT <code>${r.contractAddress}</code> via SeaDrop <code>${r.executionTo.slice(0, 10)}…</code>`
            : `Contract <code>${r.contractAddress}</code>`;

    const text = formatGasAdvisorMessage(est, targetLine);
    const rows = est.tiers.map(t =>
        Markup.button.callback(
            `${t.label} · $${t.totalUsd.toFixed(0)}`,
            `batchmint_go_${t.id}`
        )
    );
    const keyboard = Markup.inlineKeyboard([
        rows.slice(0, 2),
        rows.slice(2, 4),
        [rows[4]],
        [Markup.button.callback('❌ Cancel', 'batchmint_cancel')],
    ]);

    const opts = { parse_mode: 'HTML' as const, ...keyboard };
    if (edit && ctx.callbackQuery?.message) {
        try {
            await ctx.editMessageText(text, opts);
        } catch {
            await ctx.reply(text, opts).catch(() => {});
        }
    } else {
        await ctx.reply(text, opts).catch(() => {});
    }
}

async function executeBatch(
    ctx: any,
    session: BatchMintSession,
    tierId: string,
    deps: BatchMintWizardDeps
): Promise<void> {
    const wallets = deps.getUserWallets(session.userId);
    if (!session.resolved || wallets.length === 0) {
        await ctx.answerCbQuery('Session expired', { show_alert: true });
        return;
    }

    let gasTierId = tierId;
    let overdrive = false;
    let gasLimitOverride: string | undefined;
    let inclusionMode: 'public' | 'builder_flashbots' = 'public';
    let builderTipWei: string | undefined;
    let bundleAllWallets = false;
    if (session.gasReportJson) {
        const report = JSON.parse(session.gasReportJson);
        const tier = report.tiers?.find((t: { id: string }) => t.id === tierId);
        if (tier) {
            overdrive = Boolean(tier.overdrive);
            gasLimitOverride = tier.gasLimit;
            inclusionMode = tier.suggestedInclusionMode || 'public';
            builderTipWei = tier.builderTipWei;
            bundleAllWallets =
                inclusionMode === 'builder_flashbots' && wallets.length > 1;
        }
    }

    const r = session.resolved;
    const txTo = r.executionTo || r.contractAddress;
    const data = r.suggestedCalldata || '0x1249c58b';
    const value = r.suggestedValue || parseEther(session.valueEth || '0').toString();

    const routeLabel =
        inclusionMode === 'builder_flashbots'
            ? `Builder bundle${bundleAllWallets ? ' (all wallets)' : ''}`
            : 'Public mempool';
    await ctx
        .editMessageText(
            formatBatchMintBroadcasting({
                tierId,
                routeLabel,
                walletCount: wallets.length,
                overdrive,
            }),
            { parse_mode: 'HTML' }
        )
        .catch(() => {});

    const provider = deps.getUserProvider(session.userId);
    const keys = wallets.map(w => w.privateKey);
    const adminBypass = Boolean(deps.isAdminUser?.(session.userId));

    const results = await batchCopyTrade(keys, txTo, data, value, provider, {
        maxMintLimit: process.env.MAX_MINT_ETH || '1',
        gasTierId,
        gasLimitOverride,
        overdrive,
        inclusionMode,
        builderTipWei,
        bundleAllWallets,
        skipSimulation: false,
        disableMaxMint: true,
        forceGasEstimate: true,
        paymentPrevalidated: false,
        allowUnknownPayment: false,
        quantity: r.suggestedQuantity ?? 1,
        uid: session.userId,
        hdWalletKeyCount: deps.getHdWalletKeyCount?.(session.userId) ?? 0,
        importedWalletCount: deps.getImportedWalletCount?.(session.userId) ?? 0,
        bypassWalletCap: adminBypass,
        ignoreInsufficientBalance: false,
    });

    let lines = '';
    results.forEach((res: any, i: number) => {
        if (res.status === 'fulfilled' && res.value) {
            lines += deps.walletLine(session.userId, i, `<a href="https://etherscan.io/tx/${res.value.hash}">tx</a> ⏳`) + '\n';
        } else {
            const err = res.reason?.message || 'failed';
            lines += deps.walletLine(session.userId, i, `❌ ${err.slice(0, 40)}`) + '\n';
        }
    });

    clearBatchMintSession(session.userId);
    await ctx
        .reply(
            uiScreen({
                icon: '✓',
                title: 'Batch mint sent',
                body:
                    `<code>${r.contractAddress}</code>\n\n${lines}` +
                    '\n\n<i>Confirmations will arrive in DM.</i>',
            }),
            { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        )
        .catch(() => {});
}

export function startBatchMintWizard(
    ctx: any,
    userId: string,
    deps: BatchMintWizardDeps,
    prefill?: { contract?: string; valueEth?: string }
): void {
    const session: BatchMintSession = {
        userId,
        step: prefill?.contract ? (prefill.valueEth !== undefined ? 'gas' : 'value') : 'contract',
        contractInput: prefill?.contract,
        valueEth: prefill?.valueEth ?? '0',
        timestamp: Date.now(),
    };
    sessions.set(sessionKey(userId), session);

    if (session.step === 'contract') {
        void ctx.reply(formatBatchMintWizardStart(), {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'batchmint_cancel')]]),
        });
        return;
    }

    if (session.step === 'value') {
        void ctx.reply(
            `🎯 Target: <code>${prefill!.contract!.slice(0, 42)}</code>\n\n` +
                `<b>Mint price per NFT (ETH)?</b>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('Free (0)', 'batchmint_val_0'),
                        Markup.button.callback('0.01', 'batchmint_val_001'),
                        Markup.button.callback('0.05', 'batchmint_val_005'),
                    ],
                    [
                        Markup.button.callback('0.08', 'batchmint_val_008'),
                        Markup.button.callback('0.1', 'batchmint_val_01'),
                    ],
                    [Markup.button.callback('❌ Cancel', 'batchmint_cancel')],
                ]),
            }
        );
        return;
    }

    void (async () => {
        try {
            session.resolved = (await resolveForUser(prefill!.contract!, userId, deps)) || undefined;
        } catch (e: unknown) {
            clearBatchMintSession(userId);
            await ctx
                .reply(`❌ <b>Cannot mint this contract</b>\n\n${(e as Error).message}`, { parse_mode: 'HTML' })
                .catch(() => {});
            return;
        }
        if (!session.resolved) {
            clearBatchMintSession(userId);
            await ctx.reply('❌ Could not resolve contract.').catch(() => {});
            return;
        }
        if (shouldBlockBatchMintForSeaDrop(session.resolved)) {
            const body = formatSeaDropBlockedWizardMessage(
                session.resolved.contractAddress,
                session.resolved.seaDropStatus?.summary
            );
            await ctx.reply(body, { parse_mode: 'HTML' }).catch(() => {});
            clearBatchMintSession(userId);
            return;
        }
        await showGasStep(ctx, session, deps);
    })();
}

export function registerBatchMintWizard(bot: any, deps: BatchMintWizardDeps): void {
    bot.action('batchmint_start', async (ctx: any) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        ctx.answerCbQuery();
        clearBatchMintSession(userId);
        startBatchMintWizard(ctx, userId, deps);
    });

    bot.action('batchmint_cancel', async (ctx: any) => {
        const userId = ctx.from?.id?.toString();
        if (userId) clearBatchMintSession(userId);
        ctx.answerCbQuery('Cancelled');
        await ctx.editMessageText('❌ Batch mint cancelled.').catch(() => {});
    });

    const valMap: Record<string, string> = {
        batchmint_val_0: '0',
        batchmint_val_001: '0.01',
        batchmint_val_005: '0.05',
        batchmint_val_008: '0.08',
        batchmint_val_01: '0.1',
    };

    for (const [action, eth] of Object.entries(valMap)) {
        bot.action(action, async (ctx: any) => {
            const userId = ctx.from?.id?.toString();
            if (!userId) return;
            const session = sessions.get(sessionKey(userId));
            if (!session?.contractInput) {
                return ctx.answerCbQuery('Start with /mint', { show_alert: true });
            }

            try {
                await ctx.answerCbQuery('Loading gas advisor…');
                await ctx
                    .editMessageText(
                        `⏳ <b>Resolving mint + gas…</b>\n<code>${session.contractInput.slice(0, 42)}</code>\nPrice: <b>${eth}</b> ETH`,
                        { parse_mode: 'HTML' }
                    )
                    .catch(() => {});

                session.valueEth = eth;
                session.timestamp = Date.now();

                const resolved = await resolveForUser(session.contractInput, userId, deps);
                if (!resolved) {
                    clearBatchMintSession(userId);
                    await ctx
                        .editMessageText('❌ Could not resolve contract.', { parse_mode: 'HTML' })
                        .catch(() => {});
                    return;
                }
                if (shouldBlockBatchMintForSeaDrop(resolved)) {
                    clearBatchMintSession(userId);
                    await ctx
                        .editMessageText(
                            formatSeaDropBlockedWizardMessage(
                                resolved.contractAddress,
                                resolved.seaDropStatus?.summary
                            ),
                            { parse_mode: 'HTML' }
                        )
                        .catch(() => {});
                    return;
                }
                session.resolved = applyUserMintValue(resolved, eth);
                await showGasStep(ctx, session, deps, true);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error('[BatchMintWizard] value step failed:', msg);
                await ctx
                    .reply(
                        `❌ <b>Gas step failed</b>\n<code>${msg.slice(0, 200).replace(/</g, '&lt;')}</code>\n\nTry /mint again.`,
                        { parse_mode: 'HTML' }
                    )
                    .catch(() => {});
            }
        });
    }

    bot.action(/^batchmint_go_(.+)$/, async (ctx: any) => {
        const tierId = ctx.match[1];
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sessionKey(userId));
        if (!session?.resolved) {
            return ctx.answerCbQuery('Session expired — run /mint again', { show_alert: true });
        }
        ctx.answerCbQuery('Sending…');
        await executeBatch(ctx, session, tierId, deps);
    });

    /** Wizard text input (contract address) — call before other text handlers when session active */
    bot.on('text', async (ctx: any, next: () => Promise<void>) => {
        const userId = ctx.from?.id?.toString();
        const text = ctx.message?.text;
        if (!userId || !text || text.startsWith('/')) return next();

        const session = sessions.get(sessionKey(userId));
        if (!session || session.step !== 'contract') return next();

        session.contractInput = text.trim();
        session.step = 'value';
        session.timestamp = Date.now();
        await ctx.reply(
            `✅ Got target.\n\n<b>Mint price per NFT (ETH)?</b>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('Free (0)', 'batchmint_val_0'),
                        Markup.button.callback('0.01', 'batchmint_val_001'),
                        Markup.button.callback('0.05', 'batchmint_val_005'),
                    ],
                    [
                        Markup.button.callback('0.08', 'batchmint_val_008'),
                        Markup.button.callback('0.1', 'batchmint_val_01'),
                    ],
                    [Markup.button.callback('❌ Cancel', 'batchmint_cancel')],
                ]),
            }
        );
    });
}
