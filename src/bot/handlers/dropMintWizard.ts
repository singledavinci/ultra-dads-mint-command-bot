/**
 * Interactive /dropmint wizard — presets, custom entry, and per-user saved buttons.
 */

import { Markup } from 'telegraf';
import { parseEther } from 'ethers';
import type { Context } from 'telegraf';
import { resolveDropTarget } from '../../utils/dropResolver.js';
import type { DropInfo } from '../../utils/dropResolver.js';
import { parseDropMintTimeArg } from '../../utils/dropMintScheduleUtils.js';
import {
    clearUserDropMintPresets,
    formatUserPresetsSummary,
    getEthPresetButtons,
    getSavedGasPreset,
    getTimePresetButtons,
    parseCustomEthInput,
    parseCustomTimeInput,
    saveUserEthPreset,
    saveUserGasPreset,
    saveUserTimePreset,
} from '../../utils/dropMintPresets.js';
import {
    defaultDropMintGasChoice,
    formatGasChoiceLabel,
    gasChoiceFromTierReport,
    parseCustomGweiBribe,
    parseCustomTipEth,
    type DropMintGasChoice,
} from '../../utils/dropMintGas.js';
import {
    detectMintTargetFromMessage,
    resolveMintTarget,
} from '../../services/linkMintService.js';
import { buildGasAdvisorReport, formatGasAdvisorMessage } from '../../services/gasAdvisor.js';
import {
    scheduleDropMint,
    type DropMintSchedulerDeps,
} from './dropMintScheduler.js';

export type DropMintWizardDeps = DropMintSchedulerDeps;

type WizardStep =
    | 'input'
    | 'eth'
    | 'eth_custom'
    | 'time'
    | 'time_custom'
    | 'gas'
    | 'gas_custom_bribe'
    | 'gas_custom_tip'
    | 'confirm';

interface DropMintSession {
    userId: string;
    step: WizardStep;
    sourceInput?: string;
    drop?: DropInfo;
    valueEth: string;
    timeArg: string;
    gas: DropMintGasChoice;
    gasReportJson?: string;
    timestamp: number;
}

const sessions = new Map<string, DropMintSession>();

setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions) {
        if (now - s.timestamp > 600_000) sessions.delete(k);
    }
}, 300_000);

function sk(userId: string): string {
    return userId;
}

export function getDropMintSession(userId: string): DropMintSession | undefined {
    return sessions.get(sk(userId));
}

function isWizardTextStep(step: WizardStep): boolean {
    return (
        step === 'input' ||
        step === 'eth_custom' ||
        step === 'time_custom' ||
        step === 'gas_custom_bribe' ||
        step === 'gas_custom_tip'
    );
}

function initialSessionGas(deps: DropMintWizardDeps, userId: string): DropMintGasChoice {
    const saved = getSavedGasPreset(deps.getState(), userId);
    return saved ? { ...defaultDropMintGasChoice(), ...saved } : defaultDropMintGasChoice();
}

/** True when pasted links should not trigger link-mint. */
export function dropMintWizardExpectsText(userId: string): boolean {
    const s = sessions.get(sk(userId));
    return !!s && isWizardTextStep(s.step);
}

export function clearDropMintSession(userId: string): void {
    sessions.delete(sk(userId));
}

function chunkButtons<T>(items: T[], size: number): T[][] {
    const rows: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        rows.push(items.slice(i, i + size));
    }
    return rows;
}

function buildEthKeyboard(deps: DropMintWizardDeps, userId: string) {
    const state = deps.getState();
    const presets = getEthPresetButtons(state, userId);
    const rows = chunkButtons(presets, 3).map(chunk =>
        chunk.map((p, i) => {
            const idx = presets.indexOf(p);
            return Markup.button.callback(p.label, `dropmint_pe_${idx}`);
        })
    );
    rows.push([
        Markup.button.callback('✏️ Custom', 'dropmint_eth_custom'),
        Markup.button.callback('💾 Save preset', 'dropmint_save_eth'),
    ]);
    rows.push([
        Markup.button.callback('⚙️ My presets', 'dropmint_presets'),
        Markup.button.callback('❌ Cancel', 'dropmint_cancel'),
    ]);
    return Markup.inlineKeyboard(rows);
}

function buildTimeKeyboard(deps: DropMintWizardDeps, userId: string) {
    const state = deps.getState();
    const presets = getTimePresetButtons(state, userId);
    const rows = chunkButtons(presets, 2).map(chunk =>
        chunk.map(p => {
            const idx = presets.indexOf(p);
            return Markup.button.callback(p.label, `dropmint_pt_${idx}`);
        })
    );
    rows.push([
        Markup.button.callback('✏️ Custom', 'dropmint_time_custom'),
        Markup.button.callback('💾 Save preset', 'dropmint_save_time'),
    ]);
    rows.push([
        Markup.button.callback('⬅️ Price', 'dropmint_back_eth'),
        Markup.button.callback('⚙️ My presets', 'dropmint_presets'),
    ]);
    rows.push([Markup.button.callback('❌ Cancel', 'dropmint_cancel')]);
    return Markup.inlineKeyboard(rows);
}

function confirmKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ Schedule drop', 'dropmint_confirm'),
            Markup.button.callback('❌ Cancel', 'dropmint_cancel'),
        ],
        [
            Markup.button.callback('⬅️ Change gas', 'dropmint_back_gas'),
            Markup.button.callback('⬅️ Change time', 'dropmint_back_time'),
        ],
    ]);
}

function formatEthLabel(valueEth: string): string {
    return parseFloat(valueEth) > 0 ? `${valueEth} ETH (hint)` : 'Auto at fire';
}

function formatTimeLabel(timeArg: string): string {
    if (timeArg === 'now') return 'Immediately (~2s)';
    if (timeArg.startsWith('+')) return `In ${timeArg.slice(1)}`;
    return `${timeArg} UTC`;
}

function confirmBody(session: DropMintSession, walletCount: number): string {
    const d = session.drop!;
    const parsed = parseDropMintTimeArg(session.timeArg);
    const fireLine =
        typeof parsed === 'number'
            ? `<b>${new Date(parsed).toUTCString()}</b>`
            : `<i>${(parsed as { error: string }).error}</i>`;

    return (
        `📋 <b>Confirm drop mint</b>\n\n` +
        `🎨 <b>${d.label}</b>\n` +
        `🏦 <code>${d.contract}</code>\n` +
        `⛓️ ${d.chainSlug}\n` +
        `💰 ${formatEthLabel(session.valueEth)}\n` +
        `👛 ${walletCount} wallet(s)\n` +
        `⏰ ${formatTimeLabel(session.timeArg)} → ${fireLine}\n` +
        `⛽ ${formatGasChoiceLabel(session.gas)}\n\n` +
        `<i>Calldata re-resolves at fire (SeaDrop / Scatter / FCFS).</i>`
    );
}

function ethStepText(drop: DropInfo): string {
    return (
        `✅ <b>${drop.label}</b>\n` +
        `<code>${drop.contract}</code> · ${drop.chainSlug}\n\n` +
        `<b>Price per wallet?</b>\n` +
        `<i>Tap a preset, ✏️ Custom, or 💾 Save after picking a value.</i>`
    );
}

function timeStepText(valueEth: string): string {
    return (
        `⏰ <b>When should it fire?</b> (UTC)\n` +
        `Price: <b>${formatEthLabel(valueEth)}</b>\n\n` +
        `<i>Custom examples: <code>now</code> · <code>+45m</code> · <code>14:30</code></i>`
    );
}

function resolveEthByIndex(deps: DropMintWizardDeps, userId: string, index: number): string | null {
    const presets = getEthPresetButtons(deps.getState(), userId);
    return presets[index]?.value ?? null;
}

function resolveTimeByIndex(deps: DropMintWizardDeps, userId: string, index: number): string | null {
    const presets = getTimePresetButtons(deps.getState(), userId);
    return presets[index]?.value ?? null;
}

export function startDropMintWizard(ctx: Context, userId: string, deps: DropMintWizardDeps): void {
    if (deps.getUserWallets(userId).length === 0) {
        void ctx.reply('⚠️ No wallets configured. Use <code>/wallets</code> first.', { parse_mode: 'HTML' });
        return;
    }

    sessions.set(sk(userId), {
        userId,
        step: 'input',
        valueEth: '0',
        timeArg: 'now',
        gas: initialSessionGas(deps, userId),
        timestamp: Date.now(),
    });

    void ctx.reply(
        `🧩 <b>Drop Mint Wizard</b>\n\n` +
            `Paste an <b>OpenSea link</b>, collection <b>slug</b>, or <b>contract address</b>.\n\n` +
            `<i>Tip: save price, time, and gas with 💾 on each step.</i>\n` +
            `<i>One-liner: <code>/dropmint url 0.08 +10m</code></i>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'dropmint_cancel')]]),
        }
    );
}

async function onTargetResolved(
    ctx: Context,
    session: DropMintSession,
    input: string,
    drop: DropInfo,
    deps: DropMintWizardDeps,
    edit: boolean
): Promise<void> {
    session.sourceInput = input;
    session.drop = drop;
    session.step = 'eth';
    session.timestamp = Date.now();

    const text = ethStepText(drop);
    const opts = { parse_mode: 'HTML' as const, ...buildEthKeyboard(deps, session.userId) };
    if (edit && 'editMessageText' in ctx) {
        await ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
    } else {
        await ctx.reply(text, opts);
    }
}

async function showTimeStep(
    ctx: Context,
    session: DropMintSession,
    deps: DropMintWizardDeps,
    edit: boolean
): Promise<void> {
    session.step = 'time';
    session.timestamp = Date.now();
    const text = timeStepText(session.valueEth);
    const opts = { parse_mode: 'HTML' as const, ...buildTimeKeyboard(deps, session.userId) };
    if (edit) {
        await ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
    } else {
        await ctx.reply(text, opts);
    }
}

async function resolveMintForGasEstimate(
    session: DropMintSession,
    deps: DropMintWizardDeps
): Promise<{
    executionTo: string;
    contractAddress: string;
    data: string;
    value: string;
    from: string;
} | null> {
    const wallets = deps.getUserWallets(session.userId);
    if (!session.drop || wallets.length === 0) return null;
    const provider = deps.getUserProvider(session.userId);
    const input = session.sourceInput || session.drop.contract;
    const candidates = detectMintTargetFromMessage(input);
    const candidate = candidates[0] || {
        originalText: input.trim(),
        target: input.trim(),
        type: input.trim().startsWith('http') ? ('opensea' as const) : ('raw_address' as const),
        confidence: 'medium' as const,
    };
    const resolved = await resolveMintTarget(candidate, provider, wallets[0]!.address);
    if (!resolved) return null;
    const mintEth = parseFloat(session.valueEth || '0');
    const value =
        mintEth > 0 ? parseEther(String(mintEth)).toString() : resolved.suggestedValue || '0';
    return {
        executionTo: resolved.executionTo || resolved.contractAddress,
        contractAddress: resolved.contractAddress,
        data: resolved.suggestedCalldata || '0x1249c58b',
        value,
        from: wallets[0]!.address,
    };
}

function buildGasKeyboard(session: DropMintSession, reportJson: string) {
    let est: { tiers: Array<{ id: string; label: string; totalUsd: number }> };
    try {
        est = JSON.parse(reportJson);
    } catch {
        est = { tiers: [] };
    }
    const rows = chunkButtons(est.tiers, 2).map(chunk =>
        chunk.map(t => Markup.button.callback(`${t.label} · $${t.totalUsd.toFixed(0)}`, `dropmint_gt_${t.id}`))
    );
    rows.push([
        Markup.button.callback('✏️ Bribe (gwei)', 'dropmint_gas_bribe'),
        Markup.button.callback('✏️ Tip (ETH)', 'dropmint_gas_tip'),
    ]);
    rows.push([
        Markup.button.callback('⭐ Use saved gas', 'dropmint_gas_saved'),
        Markup.button.callback('💾 Save gas', 'dropmint_save_gas'),
    ]);
    rows.push([
        Markup.button.callback('⬅️ Time', 'dropmint_back_time'),
        Markup.button.callback('❌ Cancel', 'dropmint_cancel'),
    ]);
    return Markup.inlineKeyboard(rows);
}

async function showGasStep(
    ctx: Context,
    session: DropMintSession,
    deps: DropMintWizardDeps,
    edit: boolean
): Promise<void> {
    const wallets = deps.getUserWallets(session.userId);
    if (!session.drop || wallets.length === 0) {
        await ctx.reply('⚠️ No wallets configured.').catch(() => {});
        return;
    }

    const estTarget = await resolveMintForGasEstimate(session, deps);
    const provider = deps.getUserProvider(session.userId);
    const mintEth = parseFloat(session.valueEth || '0') || 0;

    const est = await buildGasAdvisorReport({
        provider,
        walletCount: wallets.length,
        mintValueEth: mintEth,
        estimateGas: estTarget
            ? {
                  to: estTarget.executionTo,
                  data: estTarget.data,
                  value: estTarget.value,
                  from: estTarget.from,
              }
            : undefined,
    });

    session.gasReportJson = JSON.stringify(est);
    session.step = 'gas';
    session.timestamp = Date.now();

    const targetLine = session.drop
        ? `🎨 <b>${session.drop.label}</b>\n<code>${session.drop.contract}</code>`
        : 'Drop target';
    const text =
        formatGasAdvisorMessage(est, targetLine) +
        `\n\n<b>Current pick:</b> ${formatGasChoiceLabel(session.gas)}\n` +
        `<i>Tap a tier or ✏️ custom bribe/tip. Saved gas applies with ⭐.</i>`;

    const opts = { parse_mode: 'HTML' as const, ...buildGasKeyboard(session, session.gasReportJson) };
    if (edit) {
        await ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
    } else {
        await ctx.reply(text, opts);
    }
}

async function showConfirmStep(
    ctx: Context,
    session: DropMintSession,
    deps: DropMintWizardDeps,
    edit: boolean
): Promise<void> {
    session.step = 'confirm';
    session.timestamp = Date.now();
    const walletCount = deps.getUserWallets(session.userId).length;
    const text = confirmBody(session, walletCount);
    const opts = { parse_mode: 'HTML' as const, ...confirmKeyboard() };
    if (edit) {
        await ctx.editMessageText(text, opts).catch(() => ctx.reply(text, opts));
    } else {
        await ctx.reply(text, opts);
    }
}

export function registerDropMintWizard(
    bot: { action: Function; on: Function; command?: Function },
    deps: DropMintWizardDeps
): void {
    bot.action('dropmint_start', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        await ctx.answerCbQuery();
        clearDropMintSession(userId);
        startDropMintWizard(ctx, userId, deps);
    });

    bot.action('dropmint_cancel', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (userId) clearDropMintSession(userId);
        await ctx.answerCbQuery('Cancelled');
        await ctx.editMessageText('❌ Drop mint cancelled.', { parse_mode: 'HTML' }).catch(() => {});
    });

    bot.action(/^dropmint_pe_(\d+)$/, async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) {
            return ctx.answerCbQuery('Start with Schedule drop mint', { show_alert: true });
        }
        const idx = parseInt((ctx as { match?: string[] }).match?.[1] ?? '-1', 10);
        const value = resolveEthByIndex(deps, userId, idx);
        if (value === null) return ctx.answerCbQuery('Preset unavailable', { show_alert: true });
        session.valueEth = value;
        await ctx.answerCbQuery();
        await showTimeStep(ctx, session, deps, true);
    });

    bot.action(/^dropmint_pt_(\d+)$/, async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) {
            return ctx.answerCbQuery('Session expired', { show_alert: true });
        }
        const idx = parseInt((ctx as { match?: string[] }).match?.[1] ?? '-1', 10);
        const arg = resolveTimeByIndex(deps, userId, idx);
        if (arg === null) return ctx.answerCbQuery('Preset unavailable', { show_alert: true });
        session.timeArg = arg;
        await ctx.answerCbQuery();
        await showGasStep(ctx, session, deps, true);
    });

    bot.action(/^dropmint_gt_(.+)$/, async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) {
            return ctx.answerCbQuery('Session expired', { show_alert: true });
        }
        const tierId = (ctx as { match?: string[] }).match?.[1];
        if (!tierId || !session.gasReportJson) {
            return ctx.answerCbQuery('Gas report missing — go back to time step', { show_alert: true });
        }
        const choice = gasChoiceFromTierReport(tierId, session.gasReportJson);
        if (!choice) return ctx.answerCbQuery('Tier unavailable', { show_alert: true });
        session.gas = choice;
        await ctx.answerCbQuery();
        await showConfirmStep(ctx, session, deps, true);
    });

    bot.action('dropmint_gas_bribe', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        session.step = 'gas_custom_bribe';
        session.timestamp = Date.now();
        await ctx.answerCbQuery();
        await ctx
            .editMessageText(
                `✏️ <b>Custom miner bribe</b> (gwei)\n\n` +
                    `Send extra priority in chat (added on top of network fees):\n` +
                    `• <code>0</code> — no extra bribe\n` +
                    `• <code>5</code> or <code>12 gwei</code>\n\n` +
                    `Current: <b>${session.gas.gasBribeGwei ?? '0'}</b> gwei`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('⬅️ Gas tiers', 'dropmint_back_gas'),
                            Markup.button.callback('❌ Cancel', 'dropmint_cancel'),
                        ],
                    ]),
                }
            )
            .catch(() => {});
    });

    bot.action('dropmint_gas_tip', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        session.step = 'gas_custom_tip';
        session.timestamp = Date.now();
        await ctx.answerCbQuery();
        await ctx
            .editMessageText(
                `✏️ <b>Custom builder tip</b> (ETH per wallet)\n\n` +
                    `Send in chat:\n` +
                    `• <code>0</code> — public mempool only\n` +
                    `• <code>0.004</code> — typical FCFS+ bundle tip\n\n` +
                    `Current: <b>${session.gas.priorityBoostEth ?? '0'}</b> ETH`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('⬅️ Gas tiers', 'dropmint_back_gas'),
                            Markup.button.callback('❌ Cancel', 'dropmint_cancel'),
                        ],
                    ]),
                }
            )
            .catch(() => {});
    });

    bot.action('dropmint_gas_saved', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        const saved = getSavedGasPreset(deps.getState(), userId);
        if (!saved) {
            return ctx.answerCbQuery('No saved gas preset — pick a tier and tap Save gas', { show_alert: true });
        }
        session.gas = { ...defaultDropMintGasChoice(), ...saved };
        await ctx.answerCbQuery('Applied saved gas');
        await showConfirmStep(ctx, session, deps, true);
    });

    bot.action('dropmint_save_gas', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session) return ctx.answerCbQuery('No active session', { show_alert: true });
        const state = deps.getState();
        saveUserGasPreset(state, userId, session.gas);
        await deps.saveState(state);
        await ctx.answerCbQuery(`Saved gas: ${formatGasChoiceLabel(session.gas)}`, { show_alert: true });
        if (session.step === 'gas' && session.gasReportJson) {
            const est = JSON.parse(session.gasReportJson);
            const targetLine = session.drop
                ? `🎨 <b>${session.drop.label}</b>\n<code>${session.drop.contract}</code>`
                : 'Drop target';
            const text =
                formatGasAdvisorMessage(est, targetLine) +
                `\n\n<b>Current pick:</b> ${formatGasChoiceLabel(session.gas)}`;
            await ctx
                .editMessageText(text, {
                    parse_mode: 'HTML',
                    ...buildGasKeyboard(session, session.gasReportJson),
                })
                .catch(() => {});
        }
    });

    bot.action('dropmint_back_gas', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        await ctx.answerCbQuery();
        await showGasStep(ctx, session, deps, true);
    });

    bot.action('dropmint_eth_custom', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        session.step = 'eth_custom';
        session.timestamp = Date.now();
        await ctx.answerCbQuery();
        await ctx
            .editMessageText(
                `✏️ <b>Custom price</b>\n\n` +
                    `Send ETH per wallet in chat:\n` +
                    `• <code>0</code> — auto at fire time\n` +
                    `• <code>0.12</code> — your hint\n\n` +
                    `<i>Then use 💾 Save preset to remember it.</i>`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('⬅️ Back', 'dropmint_back_eth'),
                            Markup.button.callback('❌ Cancel', 'dropmint_cancel'),
                        ],
                    ]),
                }
            )
            .catch(() => {});
    });

    bot.action('dropmint_time_custom', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        session.step = 'time_custom';
        session.timestamp = Date.now();
        await ctx.answerCbQuery();
        await ctx
            .editMessageText(
                `✏️ <b>Custom fire time</b> (UTC)\n\n` +
                    `Send in chat:\n` +
                    `• <code>now</code>\n` +
                    `• <code>+45m</code> · <code>+2h</code>\n` +
                    `• <code>14:30</code> (today or tomorrow)\n\n` +
                    `<i>Then use 💾 Save preset to remember it.</i>`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('⬅️ Back', 'dropmint_back_time'),
                            Markup.button.callback('❌ Cancel', 'dropmint_cancel'),
                        ],
                    ]),
                }
            )
            .catch(() => {});
    });

    bot.action('dropmint_save_eth', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session) return ctx.answerCbQuery('No active session', { show_alert: true });
        const state = deps.getState();
        saveUserEthPreset(state, userId, session.valueEth);
        await deps.saveState(state);
        await ctx.answerCbQuery(`Saved price ${session.valueEth || '0'}`, { show_alert: true });
        if (session.drop && session.step === 'eth') {
            await ctx
                .editMessageText(ethStepText(session.drop), {
                    parse_mode: 'HTML',
                    ...buildEthKeyboard(deps, userId),
                })
                .catch(() => {});
        }
    });

    bot.action('dropmint_save_time', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session) return ctx.answerCbQuery('No active session', { show_alert: true });
        const state = deps.getState();
        saveUserTimePreset(state, userId, session.timeArg);
        await deps.saveState(state);
        await ctx.answerCbQuery(`Saved time ${session.timeArg}`, { show_alert: true });
        if (session.step === 'time') {
            await ctx
                .editMessageText(timeStepText(session.valueEth), {
                    parse_mode: 'HTML',
                    ...buildTimeKeyboard(deps, userId),
                })
                .catch(() => {});
        }
    });

    bot.action('dropmint_presets', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const state = deps.getState();
        await ctx.answerCbQuery();
        await ctx
            .editMessageText(
                `⚙️ <b>Your drop mint presets</b>\n\n` +
                    formatUserPresetsSummary(state, userId) +
                    `\n\n` +
                    `<b>How to add</b>\n` +
                    `1. Pick or type a value (✏️ Custom)\n` +
                    `2. Tap <b>💾 Save preset</b>\n\n` +
                    `<i>Defaults can be set in Railway via DROP_MINT_ETH_PRESETS / DROP_MINT_TIME_PRESETS.</i>`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('🗑 Clear my presets', 'dropmint_clear_presets')],
                        [Markup.button.callback('⬅️ Back to wizard', 'dropmint_back_wizard')],
                    ]),
                }
            )
            .catch(() => {});
    });

    bot.action('dropmint_clear_presets', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const state = deps.getState();
        clearUserDropMintPresets(state, userId);
        await deps.saveState(state);
        await ctx.answerCbQuery('Presets cleared');
        await ctx
            .editMessageText('🗑 Cleared your saved drop mint presets.', { parse_mode: 'HTML' })
            .catch(() => {});
    });

    bot.action('dropmint_back_wizard', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        await ctx.answerCbQuery();
        if (session.step === 'confirm' || session.step === 'gas' || session.step.startsWith('gas_')) {
            await showGasStep(ctx, session, deps, true);
        } else if (session.step === 'time' || session.step === 'time_custom') {
            await showTimeStep(ctx, session, deps, true);
        } else {
            session.step = 'eth';
            await ctx
                .editMessageText(ethStepText(session.drop), {
                    parse_mode: 'HTML',
                    ...buildEthKeyboard(deps, userId),
                })
                .catch(() => {});
        }
    });

    bot.action('dropmint_back_eth', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        session.step = 'eth';
        await ctx.answerCbQuery();
        await ctx
            .editMessageText(ethStepText(session.drop), {
                parse_mode: 'HTML',
                ...buildEthKeyboard(deps, userId),
            })
            .catch(() => {});
    });

    bot.action('dropmint_back_time', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop) return ctx.answerCbQuery('Session expired', { show_alert: true });
        await ctx.answerCbQuery();
        await showTimeStep(ctx, session, deps, true);
    });

    bot.action('dropmint_confirm', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;
        const session = sessions.get(sk(userId));
        if (!session?.drop || !session.sourceInput) {
            return ctx.answerCbQuery('Session expired — tap Schedule drop mint again', { show_alert: true });
        }

        if (deps.isOnCooldown(userId, 8000)) {
            return ctx.answerCbQuery('Wait a few seconds between schedules', { show_alert: true });
        }

        await ctx.answerCbQuery('Scheduling…');
        await ctx
            .editMessageText(`⏳ <b>Scheduling…</b>\n${session.drop.label}`, { parse_mode: 'HTML' })
            .catch(() => {});

        const result = await scheduleDropMint({
            userId,
            input: session.sourceInput,
            valueEth: session.valueEth,
            timeArg: session.timeArg,
            gas: session.gas,
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            lastName: ctx.from?.last_name,
            deps,
        });

        clearDropMintSession(userId);

        if (!result.ok) {
            await ctx
                .editMessageText(`❌ <b>Could not schedule</b>\n\n${result.error}`, { parse_mode: 'HTML' })
                .catch(() => {});
            return;
        }

        const { drop, walletCount, isNow, timeStr, id, chainNote } = result;
        await ctx
            .editMessageText(
                `✅ <b>Drop Mint ${isNow ? 'Firing' : 'Scheduled'}!</b>\n\n` +
                    `🎨 <b>${drop.label}</b>\n` +
                    `🏦 <code>${drop.contract}</code>\n` +
                    `⛓️ ${drop.chainSlug}\n` +
                    `💰 ${session.valueEth} ETH${result.valueEthIsHint ? ' (hint)' : ' (auto)'}\n` +
                    `👛 ${walletCount} wallets\n` +
                    `⏰ ${timeStr}\n` +
                    `⛽ ${formatGasChoiceLabel(session.gas)}\n` +
                    chainNote +
                    `\n\nID: <code>${id}</code> — /cancelschedule ${id}`,
                { parse_mode: 'HTML' }
            )
            .catch(() => {});
    });

    bot.on('text', async (ctx: Context, next: () => Promise<void>) => {
        const userId = ctx.from?.id?.toString();
        const text = (ctx.message as { text?: string })?.text;
        if (!userId || !text || text.startsWith('/')) return next();

        const session = sessions.get(sk(userId));
        if (!session || !isWizardTextStep(session.step)) return next();

        if (session.step === 'input') {
            const input = text.trim();
            const status = await ctx.reply(`🔍 Resolving <code>${input.slice(0, 50)}</code>…`, {
                parse_mode: 'HTML',
            });

            const drop = await resolveDropTarget(input);
            if (!drop) {
                await ctx.telegram
                    .editMessageText(
                        ctx.chat!.id,
                        status.message_id,
                        undefined,
                        `❌ Could not resolve:\n<code>${input}</code>\n\nTry a contract address or OpenSea URL.`,
                        { parse_mode: 'HTML' }
                    )
                    .catch(() => {});
                return;
            }

            await ctx.telegram.deleteMessage(ctx.chat!.id, status.message_id).catch(() => {});
            await onTargetResolved(ctx, session, input, drop, deps, false);
            return;
        }

        if (session.step === 'eth_custom') {
            const parsed = parseCustomEthInput(text);
            if (!parsed.ok) {
                await ctx.reply(`❌ ${parsed.error}`, { parse_mode: 'HTML' });
                return;
            }
            session.valueEth = parsed.value;
            session.step = 'time';
            session.timestamp = Date.now();
            await ctx.reply(
                `✅ Price set to <b>${formatEthLabel(parsed.value)}</b>\n\n<i>Tap 💾 Save preset on the time step to keep it.</i>`,
                { parse_mode: 'HTML', ...buildTimeKeyboard(deps, userId) }
            );
            return;
        }

        if (session.step === 'time_custom') {
            const parsed = parseCustomTimeInput(text);
            if (!parsed.ok) {
                await ctx.reply(`❌ ${parsed.error}`, { parse_mode: 'HTML' });
                return;
            }
            session.timeArg = parsed.arg;
            await showGasStep(ctx, session, deps, false);
            return;
        }

        if (session.step === 'gas_custom_bribe') {
            const parsed = parseCustomGweiBribe(text);
            if (!parsed.ok) {
                await ctx.reply(`❌ ${parsed.error}`, { parse_mode: 'HTML' });
                return;
            }
            session.gas = {
                ...session.gas,
                gasBribeGwei: parsed.value,
                gasTierId: session.gas.gasTierId || 'custom_bribe',
            };
            session.step = 'gas';
            session.timestamp = Date.now();
            await ctx.reply(
                `✅ Bribe set to <b>${parsed.value}</b> gwei\n\n<i>Pick a tier or continue to confirm.</i>`,
                { parse_mode: 'HTML' }
            );
            await showGasStep(ctx, session, deps, false);
            return;
        }

        if (session.step === 'gas_custom_tip') {
            const parsed = parseCustomTipEth(text);
            if (!parsed.ok) {
                await ctx.reply(`❌ ${parsed.error}`, { parse_mode: 'HTML' });
                return;
            }
            const tip = parseFloat(parsed.value);
            session.gas = {
                ...session.gas,
                priorityBoostEth: parsed.value,
                inclusionMode: tip > 0 ? 'builder_flashbots' : 'public',
                gasTierId: session.gas.gasTierId || 'custom_tip',
            };
            session.step = 'gas';
            session.timestamp = Date.now();
            await showGasStep(ctx, session, deps, false);
        }
    });
}
