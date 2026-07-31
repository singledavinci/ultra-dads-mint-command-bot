/**
 * Drop mint scheduler — /dropmint, /scheduled, /cancelschedule, fire-time execution.
 */

import type { Context } from 'telegraf';
import { parseEther, type JsonRpcProvider } from 'ethers';
import type { BotState, ScheduledMint } from '../stateManager.js';
import {
    DROP_MINT_CATCHUP_GRACE_MS,
    parseDropMintTimeArg,
    pendingScheduledMints as filterPendingScheduledMints,
} from '../../utils/dropMintScheduleUtils.js';

export { DROP_MINT_CATCHUP_GRACE_MS, parseDropMintTimeArg } from '../../utils/dropMintScheduleUtils.js';
import { resolveDropTarget, type DropInfo } from '../../utils/dropResolver.js';
import {
    detectMintTargetFromMessage,
    loadLinkMintConfig,
    resolveMintTarget,
    validateMintTarget,
} from '../../services/linkMintService.js';
import {
    resolveDropMintAtFireTime,
} from '../../services/scheduledDropResolver.js';
import {
    defaultDropMintGasChoice,
    dropMintExecuteOptionsFromScheduled,
    formatGasChoiceLabel,
    gasChoiceFromScheduledMint,
    scheduledMintGasFields,
    type DropMintGasChoice,
} from '../../utils/dropMintGas.js';
import { getSavedGasPreset } from '../../utils/dropMintPresets.js';
import { CopyMintEngine } from '../../engine/CopyMintEngine.js';
import { DetectionEngine } from '../../engine/DetectionEngine.js';
export type DropMintSchedulerDeps = {
    getState: () => BotState;
    saveState: (s: BotState) => Promise<void>;
    schedulerHandles: Map<string, NodeJS.Timeout>;
    getUserProvider: (userId: string) => JsonRpcProvider;
    getUserWallets: (userId: string) => { address: string; privateKey: string }[];
    mintOptionsForUser: (userId: string, extra?: Record<string, unknown>) => Record<string, unknown>;
    getAlertDest: () => string;
    personalId: string;
    isOnCooldown: (userId: string, ms?: number) => boolean;
    safeSendTelegram: (chatId: string, msg: string, options?: Record<string, unknown>) => Promise<unknown>;
    userLabelFromStored: (userId: string, username?: string, firstName?: string) => string;
    walletLine: (userId: string | undefined, index: number, suffix: string) => string;
    mintReportBody: (chatId: string, mempoolLinks: string) => string;
    buildMempoolLinksFromResults: (results: unknown[]) => string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runOwnerMintMonitor: (params: any) => Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monitorTransactions: (...args: any[]) => Promise<unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notifyAdminUserAction: (actor: any, body: string) => Promise<void>;
    isAdminUserId: (userId: string) => boolean;
    hasActiveMintDashAccess?: (userId: string) => boolean;
};

function validateScheduleEthHint(
    valueEth: string,
    walletCount: number,
    config: ReturnType<typeof loadLinkMintConfig>
): string | null {
    const v = parseFloat(valueEth);
    if (Number.isNaN(v) || v < 0) return 'Invalid ETH value. Use a number like 0.08 or 0 for auto.';
    if (v === 0) return null;
    if (v > config.maxMintEth) {
        return `Value ${v} ETH exceeds MAX_MINT_ETH (${config.maxMintEth})`;
    }
    const total = v * walletCount;
    if (total > config.maxTotalBatchEth) {
        return `Total batch ${total.toFixed(4)} ETH exceeds MAX_TOTAL_BATCH_ETH (${config.maxTotalBatchEth})`;
    }
    return null;
}

async function optionalPreflightValidate(
    sourceInput: string,
    userId: string,
    valueEth: string,
    deps: DropMintSchedulerDeps
): Promise<string | null> {
    if (process.env.DROP_MINT_PREFLIGHT !== 'true') return null;

    const wallets = deps.getUserWallets(userId);
    if (wallets.length === 0) return 'No wallets configured. Use /wallets first.';

    const candidates = detectMintTargetFromMessage(sourceInput);
    if (candidates.length === 0) return null;

    try {
        const provider = deps.getUserProvider(userId);
        const target = await resolveMintTarget(candidates[0]!, provider, wallets[0]!.address);
        if (!target) return 'Could not preflight mint calldata for this drop.';
        const validation = validateMintTarget(target, wallets.length);
        if (!validation.valid) return validation.errors.join(' ');
    } catch (e) {
        return (e as Error).message?.slice(0, 200) || 'Preflight resolve failed';
    }

    const ethErr = validateScheduleEthHint(valueEth, wallets.length, loadLinkMintConfig());
    return ethErr;
}

export function armScheduledMint(sm: ScheduledMint, deps: DropMintSchedulerDeps): void {
    const now = Date.now();
    const delay = sm.scheduledAt - now;
    if (sm.fired || sm.missed) return;

    if (delay < 0) {
        const overdueMs = now - sm.scheduledAt;
        if (overdueMs <= DROP_MINT_CATCHUP_GRACE_MS) {
            console.log(`[Scheduler] Catch-up firing overdue mint: ${sm.id} (${Math.round(overdueMs / 1000)}s late)`);
            void fireScheduledMint(sm, deps);
        } else {
            void handleMissedScheduledMint(sm, deps, overdueMs);
        }
        return;
    }

    const handle = setTimeout(() => {
        void fireScheduledMint(sm, deps);
    }, delay);

    deps.schedulerHandles.set(sm.id, handle);
    console.log(
        `[Scheduler] Armed: "${sm.label}" fires in ${Math.round(delay / 1000)}s (${new Date(sm.scheduledAt).toISOString()})`
    );
}

async function handleMissedScheduledMint(
    sm: ScheduledMint,
    deps: DropMintSchedulerDeps,
    overdueMs: number
): Promise<void> {
    const state = deps.getState();
    const entry = state.scheduledMints?.find(s => s.id === sm.id);
    if (entry) {
        entry.missed = true;
        entry.fired = true;
        await deps.saveState(state);
    }
    deps.schedulerHandles.delete(sm.id);

    const mins = Math.round(overdueMs / 60_000);
    const msg =
        `⏭️ <b>Scheduled drop missed</b>\n\n` +
        `🎨 <b>${sm.label}</b>\n` +
        `Was due ${mins} minute(s) ago — outside catch-up window.\n\n` +
        `Re-queue with <code>/dropmint</code> if the drop is still live.\n` +
        `ID: <code>${sm.id}</code>`;

    await deps.safeSendTelegram(sm.addedBy, msg, { parse_mode: 'HTML' }).catch(() => {});

    const alertDest = deps.getAlertDest();
    if (alertDest !== sm.addedBy) {
        await deps.safeSendTelegram(alertDest, msg, { parse_mode: 'HTML' }).catch(() => {});
    }
}

export async function fireScheduledMint(sm: ScheduledMint, deps: DropMintSchedulerDeps): Promise<void> {
    deps.schedulerHandles.delete(sm.id);
    console.log(`[Scheduler] Firing scheduled mint: ${sm.id} – ${sm.label}`);

    if (deps.hasActiveMintDashAccess && !deps.hasActiveMintDashAccess(sm.addedBy)) {
        const state = deps.getState();
        const entry = state.scheduledMints?.find(s => s.id === sm.id);
        if (entry) entry.fired = true;
        await deps.saveState(state).catch(() => {});
        await deps
            .safeSendTelegram(
                sm.addedBy,
                `🔒 <b>Scheduled mint cancelled</b>\n\n${sm.label}\nYour MintDash subscription is no longer active. Relink or renew before scheduling another mint.`,
                { parse_mode: 'HTML' }
            )
            .catch(() => {});
        console.warn(`[Scheduler] Access denied for scheduled mint ${sm.id}; no transaction submitted.`);
        return;
    }

    const alertDest = deps.getAlertDest();
    const setterLabel = deps.userLabelFromStored(sm.addedBy, sm.addedByUsername, sm.addedByFirstName);

    await deps
        .safeSendTelegram(
            alertDest,
            `⏰ <b>Scheduled Drop Minting Now!</b>\n\n` +
                `👤 ${setterLabel}\n` +
                `🎨 <b>${sm.label}</b>\n` +
                `🏦 Contract: <code>${sm.contract}</code>\n` +
                `💰 Value: ${sm.valueEth} ETH per wallet${sm.valueEthIsHint ? ' (hint)' : ' (auto)'}\n` +
                `⛽ ${formatGasChoiceLabel(gasChoiceFromScheduledMint(sm))}\n\n` +
                `⏳ Resolving drop (SeaDrop / Scatter / FCFS) and broadcasting...`,
            { parse_mode: 'HTML' }
        )
        .catch(() => {});

    try {
        const provider = deps.getUserProvider(sm.addedBy);
        const userWallets = deps.getUserWallets(sm.addedBy);
        const userKeys = userWallets.map(w => w.privateKey);
        if (userKeys.length === 0) {
            await deps
                .safeSendTelegram(
                    alertDest,
                    `⚠️ Scheduled mint <b>${sm.label}</b> aborted — no wallets found for this user.`,
                    { parse_mode: 'HTML' }
                )
                .catch(() => {});
            return;
        }

        const resolved = await resolveDropMintAtFireTime({
            sourceInput: sm.sourceInput || sm.contract,
            provider,
            minter: userWallets[0]!.address,
            valueEthHint: sm.valueEth,
            valueEthIsHint: sm.valueEthIsHint,
        });

        const linkCfg = loadLinkMintConfig();
        const valueWei = parseEther(resolved.valueEth).toString();
        const valueNote =
            sm.valueEthIsHint && resolved.valueEth !== sm.valueEth
                ? `\n💡 Resolved price: <b>${resolved.valueEth}</b> ETH (scheduled hint was ${sm.valueEth})`
                : '';

        const engineResult = await CopyMintEngine.executeScheduledMint({
            provider,
            privateKeys: userKeys,
            candidate: DetectionEngine.candidateFromManual({
                to: resolved.executionTo,
                data: resolved.data,
                value: valueWei,
            }),
            paymentPlanValue: valueWei,
            options: deps.mintOptionsForUser(
                sm.addedBy,
                dropMintExecuteOptionsFromScheduled(resolved, sm, linkCfg)
            ),
        });
        const results = engineResult.legacyResults;

        let mempoolLinks = '';
        results.forEach((res, i) => {
            (res as { uid?: string }).uid = sm.addedBy;
            if (res.status === 'fulfilled' && res.value) {
                const txHash = (res.value as { hash?: string }).hash;
                mempoolLinks +=
                    deps.walletLine(sm.addedBy, i, `<a href="https://etherscan.io/tx/${txHash}">Etherscan</a> ⏳`) +
                    '\n';
            } else {
                const reason = (res as { reason?: { message?: string } }).reason?.message || 'Unknown Error';
                mempoolLinks += deps.walletLine(sm.addedBy, i, `❌ ${reason.slice(0, 20)}...`) + '\n';
            }
        });

        const confirmContract = resolved.seaDropNftContract || sm.contract;
        const displayValue = resolved.valueEth;

        await deps.runOwnerMintMonitor({
            ownerUserId: sm.addedBy,
            originChatId: sm.addedBy,
            results,
            mempoolLinks,
            title: '✅ <b>Scheduled drop confirmed</b>',
            initHeading: `⏰ <b>Scheduled drop: ${sm.label}</b>${valueNote}`,
            initBody:
                `Contract: <code>${confirmContract}</code>\n` +
                `Value: ${displayValue} ETH per wallet\n\n` +
                deps.mintReportBody(sm.addedBy, mempoolLinks),
            userRef: {
                userId: sm.addedBy,
                username: sm.addedByUsername,
                firstName: sm.addedByFirstName,
            },
            monitorCtx: {
                contractAddress: confirmContract,
                provider,
                valueEth: displayValue,
                mintedByLabel: `Scheduled by ${setterLabel}`,
            },
        });

        if (alertDest !== sm.addedBy) {
            await deps.monitorTransactions(
                alertDest,
                results,
                '✅ <b>Scheduled drop confirmed</b>',
                '',
                undefined,
                {
                    contractAddress: confirmContract,
                    provider,
                    valueEth: displayValue,
                    mintedByLabel: `Scheduled by ${setterLabel}`,
                    sendUserDms: false,
                }
            );
        }
    } catch (err: unknown) {
        const message = (err as Error).message || 'unknown';
        console.error('[Scheduler] Drop mint failed:', message);
        await deps
            .safeSendTelegram(
                alertDest,
                `❌ <b>Scheduled Drop Failed: ${sm.label}</b>\nReason: ${message}`,
                { parse_mode: 'HTML' }
            )
            .catch(() => {});
    }

    const state = deps.getState();
    if (state.scheduledMints) {
        const entry = state.scheduledMints.find(s => s.id === sm.id);
        if (entry) entry.fired = true;
        await deps.saveState(state).catch(() => {});
    }
}

export type ScheduleDropMintResult =
    | {
          ok: true;
          id: string;
          drop: DropInfo;
          walletCount: number;
          isNow: boolean;
          timeStr: string;
          chainNote: string;
          valueEthIsHint: boolean;
      }
    | { ok: false; error: string };

export async function scheduleDropMint(params: {
    userId: string;
    input: string;
    valueEth: string;
    timeArg: string;
    gas?: DropMintGasChoice;
    username?: string;
    firstName?: string;
    lastName?: string;
    deps: DropMintSchedulerDeps;
}): Promise<ScheduleDropMintResult> {
    const { userId, input, valueEth, timeArg, deps } = params;
    const walletCount = deps.getUserWallets(userId).length;
    if (walletCount === 0) {
        return { ok: false, error: 'No wallets configured. Use /wallets first.' };
    }

    const ethErr = validateScheduleEthHint(valueEth, walletCount, loadLinkMintConfig());
    if (ethErr) return { ok: false, error: ethErr };

    const parsedTime = parseDropMintTimeArg(timeArg);
    if (typeof parsedTime !== 'number') {
        return { ok: false, error: parsedTime.error };
    }

    const drop = await resolveDropTarget(input);
    if (!drop) {
        return {
            ok: false,
            error: 'Could not resolve a contract address. Try a raw 0x address or OpenSea URL.',
        };
    }

    const preflightErr = await optionalPreflightValidate(input, userId, valueEth, deps);
    if (preflightErr) return { ok: false, error: preflightErr };

    const state = deps.getState();
    const dup = (state.scheduledMints || []).find(
        s =>
            !s.fired &&
            !s.missed &&
            s.addedBy === userId &&
            (s.sourceInput || s.contract).toLowerCase() === input.toLowerCase()
    );
    if (dup) {
        return {
            ok: false,
            error: `You already have a pending drop for this target.\nID: ${dup.id}\nUse /cancelschedule ${dup.id} first.`,
        };
    }

    const valueEthIsHint = parseFloat(valueEth) > 0;
    const scheduledAt = parsedTime;
    const id = `dm_${Date.now().toString(36)}`;

    const gas =
        params.gas ??
        getSavedGasPreset(state, userId) ??
        defaultDropMintGasChoice();

    const sm: ScheduledMint = {
        id,
        label: drop.label,
        contract: drop.contract,
        sourceInput: input,
        valueEth,
        valueEthIsHint,
        chainSlug: drop.chainSlug,
        scheduledAt,
        addedBy: userId,
        addedByUsername: params.username,
        addedByFirstName: params.firstName,
        ...scheduledMintGasFields(gas),
    };

    if (!state.scheduledMints) state.scheduledMints = [];
    state.scheduledMints.push(sm);
    await deps.saveState(state);

    armScheduledMint(sm, deps);

    const nowMs = Date.now();
    const fireAt = new Date(scheduledAt);
    const isNow = scheduledAt - nowMs < 5000;
    const timeStr = isNow ? 'immediately' : `at <b>${fireAt.toUTCString()}</b>`;
    const chainNote =
        drop.chainSlug !== 'ethereum'
            ? `\n⚠️ <i>Collection is on <b>${drop.chainSlug}</b> — ensure your RPC supports that chain.</i>`
            : '';

    await deps.notifyAdminUserAction(
        {
            userId,
            username: params.username,
            firstName: params.firstName,
            lastName: params.lastName,
        },
        `📅 <b>Drop mint ${isNow ? 'firing' : 'scheduled'}</b>\n` +
            `🎨 <b>${drop.label}</b>\n` +
            `🏦 <code>${drop.contract}</code>\n` +
            `💰 ${valueEth} ETH${valueEthIsHint ? ' (hint)' : ' (auto)'} · 👛 ${walletCount} wallets\n` +
            `⏰ ${isNow ? 'now' : fireAt.toUTCString()}\n` +
            `⛽ ${formatGasChoiceLabel(gas)}\n` +
            `ID: <code>${id}</code>`
    );

    return { ok: true, id, drop, walletCount, isNow, timeStr, chainNote, valueEthIsHint };
}

export function rearmPendingDropMints(deps: DropMintSchedulerDeps): void {
    const state = deps.getState();
    if (!state.scheduledMints?.length) return;

    const now = Date.now();
    const pending = state.scheduledMints.filter(s => !s.fired && !s.missed);
    const future = pending.filter(s => s.scheduledAt > now);
    const overdue = pending.filter(s => s.scheduledAt <= now);

    console.log(
        `[Scheduler] Re-arming ${future.length} future + ${overdue.length} overdue scheduled drop mint(s)...`
    );

    for (const sm of [...future, ...overdue]) {
        armScheduledMint(sm, deps);
    }
}

export function registerDropMintHandlers(bot: { command: Function; action?: Function }, deps: DropMintSchedulerDeps): void {
    bot.command('dropmint', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        if (!userId) return;

        if (deps.isOnCooldown(userId, 8000)) {
            return ctx.reply('⏳ Please wait a moment before scheduling another mint.');
        }

        const parts = (ctx.message as { text?: string })?.text?.split(/\s+/).slice(1) ?? [];
        if (parts.length === 0) {
            const { startDropMintWizard } = await import('./dropMintWizard.js');
            startDropMintWizard(ctx, userId, deps);
            return;
        }

        const input = parts[0]!;
        const valueEth = parts[1] ?? '0';
        const timeArg = parts[2] ?? 'now';

        const resolveMsg = await ctx.reply(
            `🔍 Resolving collection info from: <code>${input.slice(0, 60)}</code>...`,
            { parse_mode: 'HTML' }
        );

        const result = await scheduleDropMint({
            userId,
            input,
            valueEth,
            timeArg,
            username: ctx.from?.username,
            firstName: ctx.from?.first_name,
            lastName: ctx.from?.last_name,
            deps,
        });

        if (!result.ok) {
            await ctx.telegram
                .editMessageText(
                    ctx.chat!.id,
                    resolveMsg.message_id,
                    undefined,
                    `❌ ${result.error}`,
                    { parse_mode: 'HTML' }
                )
                .catch(() => {});
            return;
        }

        const { drop, walletCount, isNow, timeStr, id, chainNote, valueEthIsHint } = result;
        await ctx.telegram
            .editMessageText(
                ctx.chat!.id,
                resolveMsg.message_id,
                undefined,
                `✅ <b>Drop Mint ${isNow ? 'Firing' : 'Scheduled'}!</b>\n\n` +
                    `🎨 <b>Collection:</b> ${drop.label}\n` +
                    `🏦 <b>Contract:</b> <code>${drop.contract}</code>\n` +
                    `⛓️ <b>Chain:</b> ${drop.chainSlug}\n` +
                    `💰 <b>Value:</b> ${valueEth} ETH${valueEthIsHint ? ' (hint)' : ' (auto at fire)'}\n` +
                    `👛 <b>Wallets:</b> ${walletCount}\n` +
                    `⏰ <b>Fire time:</b> ${timeStr}\n` +
                    chainNote +
                    `\n\n<i>Calldata is re-resolved at fire time (SeaDrop / Scatter / FCFS).</i>\n\n` +
                    `ID: <code>${id}</code> — use /cancelschedule ${id} to cancel.`,
                { parse_mode: 'HTML' }
            )
            .catch(() => {});
    });

    bot.command('scheduled', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        const state = deps.getState();
        const isAdmin = userId === deps.personalId;
        const pending = filterPendingScheduledMints(state.scheduledMints, {
            userId,
            adminUserId: deps.personalId,
        });

        if (pending.length === 0) {
            return ctx.reply('🗓 No drop mints currently scheduled. Use /dropmint to queue one.');
        }

        const lines = pending.map((s, i) => {
            const timeLeft = Math.round((s.scheduledAt - Date.now()) / 1000);
            const mins = Math.floor(timeLeft / 60);
            const secs = timeLeft % 60;
            const owner =
                s.addedBy === userId
                    ? ' (Yours)'
                    : isAdmin
                      ? ` (${deps.userLabelFromStored(s.addedBy, s.addedByUsername, s.addedByFirstName)})`
                      : '';
            const gasLine = s.gasTierId ? ` · ⛽ ${formatGasChoiceLabel(gasChoiceFromScheduledMint(s))}` : '';
            return `${i + 1}. <b>${s.label}</b>${owner}\n   Contract: <code>${s.contract.slice(0, 10)}...</code>\n   Value: ${s.valueEth} ETH${gasLine}\n   Fires in: ${mins}m ${secs}s\n   ID: <code>${s.id}</code>`;
        }).join('\n\n');

        const scope = isAdmin ? '' : ' (your jobs only)';
        ctx.reply(
            `🗓 <b>Scheduled Drop Mints (${pending.length})</b>${scope}\n\n${lines}\n\n<i>Use /cancelschedule &lt;id&gt; to cancel.</i>`,
            { parse_mode: 'HTML' }
        );
    });

    bot.command('cancelschedule', async (ctx: Context) => {
        const userId = ctx.from?.id?.toString();
        const id = (ctx.message as { text?: string })?.text?.split(' ')[1];
        if (!id) return ctx.reply('Usage: /cancelschedule <id>\nGet IDs using /scheduled');

        const state = deps.getState();
        const sm = state.scheduledMints?.find(s => s.id === id);
        if (!sm) return ctx.reply(`❌ Schedule ID <code>${id}</code> not found.`, { parse_mode: 'HTML' });
        if (sm.addedBy !== userId && userId !== deps.personalId) {
            return ctx.reply('🔒 You can only cancel your own scheduled mints.');
        }

        const handle = deps.schedulerHandles.get(id);
        if (handle) {
            clearTimeout(handle);
            deps.schedulerHandles.delete(id);
        }

        state.scheduledMints = state.scheduledMints!.filter(s => s.id !== id);
        await deps.saveState(state);

        ctx.reply(`✅ Cancelled scheduled drop mint: <b>${sm.label}</b>`, { parse_mode: 'HTML' });
    });
}

export function formatDropMintExplainText(): string {
    return (
        `📖 <b>How /dropmint Works</b>\n\n` +
        `Tap <b>Schedule drop mint</b> in the Mint menu — paste a link, pick price & time with buttons, then confirm.\n\n` +
        `1️⃣ <b>Schedule resolve</b>: OpenSea slug/URL via Reservoir (if configured) or OpenSea API; Scatter, Manifold, Zora, or raw contract also work.\n\n` +
        `2️⃣ <b>Precision scheduling</b>: Your mission is saved and fires at the chosen time (Now, +5m, +10m, …).\n\n` +
        `3️⃣ <b>Fire-time resolve</b>: At drop time the bot re-resolves SeaDrop, Scatter, and FCFS calldata and broadcasts from all sub-wallets.\n\n` +
        `4️⃣ <b>Safety</b>: <b>Auto (0)</b> uses detected price at fire. Simulation follows <code>LINK_MINT_SIMULATION_MODE</code>.`
    );
}

export function formatActiveScheduledDropsList(
    state: BotState,
    opts: { userId?: string; adminUserId: string }
): string | null {
    const visible = filterPendingScheduledMints(state.scheduledMints, {
        userId: opts.userId,
        adminUserId: opts.adminUserId,
    });

    if (visible.length === 0) return null;

    let msg = `📅 <b>Active Scheduled Drops (${visible.length})</b>\n\n`;
    visible.forEach((sm, i) => {
        const timeStr = new Date(sm.scheduledAt).toLocaleString();
        msg += `${i + 1}. <b>${sm.label}</b>\n⏰ ${timeStr}\n🆔 <code>${sm.id}</code>\n\n`;
    });
    msg += `Use <code>/cancelschedule &lt;id&gt;</code> to remove one drop.`;
    return msg;
}
