/**
 * Telegram inline menu layouts and copy — keeps index.ts readable.
 */
import { Markup } from 'telegraf';
import {
    UI_BRAND,
    formatHistoryRow,
    uiLiveDot,
    uiOnOff,
    uiRow,
    uiScreen,
    uiToggleIcon,
} from './premiumMessages';

export interface MainMenuStats {
    trackerOn: boolean;
    wsConnected: boolean;
    autoMint: boolean;
    mevProtection: boolean;
    overdrive: boolean;
    walletCount: number;
    whaleCount: number;
    scheduledCount: number;
    blockMintCount?: number;
    /** Shown when mempool pending is not actively listening (admin). */
    mempoolHint?: string;
    version: string;
}

export function kbBackMain() {
    return Markup.button.callback('« Home', 'menu_main');
}

export function kbRefresh(action: string) {
    return Markup.button.callback('↻ Refresh', action);
}

export function mainMenuText(s: MainMenuStats): string {
    const tracker = uiLiveDot(s.trackerOn);
    const net = s.wsConnected ? 'WebSocket' : 'HTTP';
    const auto = uiOnOff(s.autoMint);
    const mev = s.mevProtection ? 'Protected' : 'Public';
    const gas = s.overdrive ? 'Boost 4×' : 'Standard';

    return uiScreen({
        icon: '⚡',
        title: UI_BRAND,
        body:
            `<code>v${s.version}</code>\n\n` +
            uiRow('Tracker', `${tracker} ${net}`) +
            '\n' +
            uiRow('Auto-mint', auto) +
            '  ·  ' +
            uiRow('Route', mev) +
            '  ·  ' +
            uiRow('Gas', gas) +
            '\n\n' +
            `👛 <b>${s.walletCount}</b> wallets   🐋 <b>${s.whaleCount}</b> whales   📅 <b>${s.scheduledCount}</b> drops` +
            (s.blockMintCount !== undefined
                ? `   🎯 <b>${s.blockMintCount}</b> block`
                : '') +
            (s.mempoolHint ? `\n\n⚠️ <i>Mempool pending: ${s.mempoolHint}</i>` : ''),
        footer: '<i>Select a module below.</i>',
    });
}

export function mainMenuKeyboard(isAdmin: boolean) {
    const rows = [
        [
            Markup.button.callback('Dashboard', 'menu_status'),
            Markup.button.callback('Whales', 'menu_tracker'),
        ],
        [
            Markup.button.callback('Mint', 'menu_drops'),
            Markup.button.callback('Custom', 'menu_custommint'),
        ],
        [
            Markup.button.callback('Wallets', 'menu_wallets'),
            Markup.button.callback('Engine', 'menu_settings'),
        ],
        [
            Markup.button.callback('History', 'menu_executions'),
            Markup.button.callback('RPC', 'menu_rpc'),
        ],
    ];
    if (isAdmin) {
        rows.push([
            Markup.button.callback('Admin', 'menu_security'),
            Markup.button.callback('Emergency', 'menu_emergency'),
        ]);
    }
    rows.push([
        Markup.button.callback('Guide', 'guide_overview'),
        Markup.button.callback('Help', 'menu_help'),
    ]);
    rows.push([Markup.button.callback('About', 'menu_version')]);
    return Markup.inlineKeyboard(rows);
}

export function statusMenuText(params: {
    detectionMode: string;
    trackerRunning: boolean;
    blocksProcessed: number;
    mintsDetected: number;
    engine: string;
    auto: string;
    mev: string;
    overdrive: string;
    sim: string;
    bribe: string;
    maxMint: string;
    walletLine: string;
    whaleLine: string;
    ethSpent: string;
    tradesOk: number;
    tradesFail: number;
}): string {
    const p = params;
    return uiScreen({
        icon: '📊',
        title: 'Dashboard',
        body:
            `<b>Detection</b>\n` +
            uiRow('Mode', p.detectionMode) +
            '\n' +
            uiRow('Tracker', `${uiLiveDot(p.trackerRunning)} ${p.trackerRunning ? 'Live' : 'Stopped'}`) +
            `  ·  Blocks <b>${p.blocksProcessed}</b>  ·  Mints <b>${p.mintsDetected}</b>\n\n` +
            `<b>Execution</b>\n` +
            uiRow('Engine', p.engine) +
            '\n' +
            uiRow('Auto-mint', p.auto) +
            '  ·  ' +
            uiRow('Inclusion', p.mev) +
            '\n' +
            uiRow('Gas', `${p.overdrive}  ·  Sim ${p.sim}`) +
            '\n' +
            uiRow('Limits', `Bribe ${p.bribe}  ·  Cap ${p.maxMint}`) +
            `\n\n<b>Fleet</b>\n${p.walletLine}${p.whaleLine}\n\n` +
            `<b>Session</b>  ${p.ethSpent} ETH spent  ·  ✓${p.tradesOk}  ✗${p.tradesFail}`,
    });
}

export function statusMenuKeyboard() {
    return Markup.inlineKeyboard([
        [kbRefresh('menu_status'), Markup.button.callback('History', 'menu_executions')],
        [
            Markup.button.callback('Pause', 'action_pause'),
            Markup.button.callback('Resume', 'action_resume'),
            Markup.button.callback('Kill', 'action_kill'),
        ],
        [kbBackMain()],
    ]);
}

export function settingsMenuText(params: {
    auto: string;
    mev: string;
    bribe: string;
    overdrive: string;
    skip: string;
    maxMint: string;
    rpcHost: string;
}): string {
    const p = params;
    return uiScreen({
        icon: '⚙️',
        title: 'Engine',
        body:
            uiRow('Auto-mint', p.auto) +
            '     ' +
            uiRow('Inclusion', p.mev) +
            '\n' +
            uiRow('Gas bribe', p.bribe) +
            '     ' +
            uiRow('Overdrive', p.overdrive) +
            '\n' +
            uiRow('Simulation', p.skip) +
            '     ' +
            uiRow('Max mint', p.maxMint) +
            `\n${uiRow('RPC', `<code>${p.rpcHost}</code>`)}`,
        footer: '<i>Tap a control to toggle.</i>',
    });
}

export function settingsMenuKeyboard(
    params: {
        auto: string;
        mev: string;
        bribe: string;
        overdrive: string;
        skip: string;
        maxMint: string;
    },
    isAdmin = false
) {
    const p = params;
    const tail = isAdmin
        ? [
              Markup.button.callback('Emergency', 'menu_emergency'),
              Markup.button.callback('Free RPC', 'action_freerpc'),
          ]
        : [Markup.button.callback('Emergency', 'menu_emergency')];
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(`Auto ${p.auto}`, 'action_toggle_automint'),
            Markup.button.callback(`Route ${p.mev}`, 'action_toggle_mev'),
        ],
        [
            Markup.button.callback(`Bribe ${p.bribe}`, 'menu_bribe'),
            Markup.button.callback(`Cap ${p.maxMint}`, 'menu_maxmint'),
        ],
        [
            Markup.button.callback(`Sim ${p.skip}`, 'action_toggle_sim'),
            Markup.button.callback(`Gas ${p.overdrive}`, 'action_toggle_overdrive'),
        ],
        [
            Markup.button.callback('RPC', 'menu_rpc'),
            Markup.button.callback('Whales', 'menu_tracker'),
        ],
        ...(isAdmin ? [[Markup.button.callback('⚡ Capacity', 'menu_capacity')]] : []),
        tail,
        [kbBackMain()],
    ]);
}

export function walletsMenuText(params: {
    walletCount: number;
    importedCount: number;
    rpcLabel: string;
}): string {
    return uiScreen({
        icon: '👛',
        title: 'Wallets',
        body:
            uiRow('Active fleet', `<b>${params.walletCount}</b>`) +
            '     ' +
            uiRow('Imported', `<b>${params.importedCount}</b>`) +
            '\n' +
            uiRow('RPC', `<b>${params.rpcLabel}</b>`),
        footer: '<i>Adjust size, distribute ETH, or sweep back to #1.</i>',
    });
}

export function walletsMenuKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('+1', 'adj_wallets_+1'),
            Markup.button.callback('+5', 'adj_wallets_+5'),
            Markup.button.callback('+10', 'adj_wallets_+10'),
        ],
        [
            Markup.button.callback('−1', 'adj_wallets_-1'),
            Markup.button.callback('−5', 'adj_wallets_-5'),
            Markup.button.callback('−10', 'adj_wallets_-10'),
        ],
        [Markup.button.callback('List wallets', 'action_view_wallets')],
        [
            Markup.button.callback('Custom RPC', 'action_prompt_rpc'),
            Markup.button.callback('Reset RPC', 'action_reset_rpc'),
        ],
        [
            Markup.button.callback('Sweep → #1', 'action_confirm_sweep'),
            Markup.button.callback('Distribute', 'action_confirm_distribute'),
        ],
        [Markup.button.callback('Mint', 'menu_drops'), Markup.button.callback('RPC', 'menu_rpc')],
        [kbBackMain()],
    ]);
}

export function mintCommanderText(params: {
    scheduledCount: number;
    blockMintCount?: number;
    isAdmin?: boolean;
}): string {
    let body =
        uiRow('Scheduled drops', `<b>${params.scheduledCount}</b> active`) +
        (params.blockMintCount !== undefined
            ? '\n' + uiRow('Block snipes', `<b>${params.blockMintCount}</b> armed`)
            : '') +
        '\n\n' +
        'Tap <b>Schedule drop mint</b> for a guided flow (paste link → price → time → confirm).\n\n' +
        '<code>/dropmint</code> — same wizard · <code>/dropmint url 0.08 +10m</code> one-liner\n' +
        '<code>/blockmint &lt;contract&gt; free next</code> — per-block cap snipes\n' +
        '<code>/scheduled</code> · <code>/cancelschedule &lt;id&gt;</code>\n' +
        '<code>/mint</code> — interactive batch + gas advisor\n' +
        '<code>/mint &lt;contract&gt; [eth] [hex]</code> — instant';
    if (params.isAdmin) {
        body +=
            '\n\n<b>Admin — RPC relief</b>\n' +
            '<code>/freerpc</code> — cancel <i>all</i> scheduled + block jobs; pause mempool\n' +
            '<code>/freerpc resume</code> · <code>/freerpc status</code>';
    }
    return uiScreen({ icon: '🎯', title: 'Mint', body });
}

export function mintCommanderKeyboard(isAdmin = false) {
    const rows = [
        [Markup.button.callback('📅 Schedule drop mint', 'dropmint_start')],
        [Markup.button.callback('Interactive batch mint', 'batchmint_start')],
        [Markup.button.callback('How it works', 'explain_drops')],
        [
            Markup.button.callback('Scheduled', 'action_list_scheduled'),
            Markup.button.callback('Clear done', 'action_clear_fired'),
        ],
    ];
    if (isAdmin) {
        rows.push([Markup.button.callback('🧹 Free RPC (cancel all)', 'action_freerpc')]);
    }
    rows.push(
        [Markup.button.callback('Custom mint', 'menu_custommint')],
        [Markup.button.callback('Wallets', 'menu_wallets'), Markup.button.callback('Engine', 'menu_settings')],
        [kbBackMain()]
    );
    return Markup.inlineKeyboard(rows);
}

export function emergencyMenuText(params: {
    autoMint: boolean;
    trackerRunning: boolean;
    scheduledCount: number;
    blockMintCount: number;
    mempoolLabel: string;
}): string {
    const auto = params.autoMint ? '🟢 ARMED' : '🔴 OFF';
    const trackerState = params.trackerRunning ? '🟢 Running' : '🔴 Stopped';
    const mempool = params.mempoolLabel;
    return (
        `🚨 <b>EMERGENCY</b>\n\n` +
        uiRow('Auto-mint', auto) +
        '\n' +
        uiRow('Tracker', trackerState) +
        '\n' +
        uiRow('Mempool pending', mempool) +
        '\n' +
        uiRow('Scheduled drops', `<b>${params.scheduledCount}</b>`) +
        '  ·  ' +
        uiRow('Block snipes', `<b>${params.blockMintCount}</b>`) +
        '\n\n' +
        `<b>⏸ Pause</b> — stop auto-mint (tracker stays on)\n` +
        `<b>▶️ Resume</b> — re-enable auto-mint + mempool if paused\n` +
        `<b>🛑 Kill</b> — stop auto-mint and tracker (full safe mode)\n` +
        `<b>🧹 Free RPC</b> — cancel all scheduled drops + block snipes; pause mempool (automint stays on)\n\n` +
        `<code>/freerpc</code> · <code>/freerpc resume</code> · <code>/freerpc status</code>\n\n` +
        `<i>After Kill: /resume and restart tracker. After Free RPC: Resume RPC or /resume.</i>`
    );
}

export function emergencyMenuKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('⏸️ PAUSE', 'action_pause'), Markup.button.callback('▶️ RESUME', 'action_resume')],
        [Markup.button.callback('🛑 KILL', 'action_kill')],
        [
            Markup.button.callback('🧹 FREE RPC', 'action_freerpc'),
            Markup.button.callback('▶️ Resume RPC', 'action_freerpc_resume'),
        ],
        [Markup.button.callback('📊 RPC queue', 'action_freerpc_status')],
        [kbBackMain()],
    ]);
}

export function rpcMenuAdminFooter(): string {
    return (
        `\n\n<b>Admin — RPC relief</b>\n` +
        `<code>/freerpc</code> — clear scheduled + block snipes, pause mempool\n` +
        `<code>/freerpc resume</code> · <code>/freerpc status</code>\n` +
        `<code>/chain &lt;url&gt;</code> — set global RPC`
    );
}

export function trackerMenuText(params: {
    globalCount: number;
    personalCount: number;
    prefsSummary: string;
    trackerRunning: boolean;
    watching: number;
    unionCount: number;
    syncWarning: boolean;
    adminView: boolean;
    addressPreview: string;
}): string {
    const p = params;
    let body =
        uiRow('Global whales', `<b>${p.globalCount}</b>`) +
        '  ·  ' +
        uiRow('Yours', `<b>${p.personalCount}</b>`) +
        '\n' +
        `${p.prefsSummary}\n` +
        uiRow('Sync', `${uiLiveDot(p.trackerRunning)} <b>${p.watching}</b> / ${p.unionCount}`) +
        '\n';
    if (p.syncWarning) {
        body += '\n⚠️ <i>Some addresses not on tracker — /trackingaudit</i>\n';
    }
    body += `\n${p.addressPreview}\n`;
    return uiScreen({
        icon: '🐋',
        title: 'Whales',
        body,
        footer: '<code>/track</code>  <code>/untrack</code>  <code>/trackingprefs</code>',
    });
}

export function trackerMenuKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Alert & auto-mint sources', 'menu_tracking_prefs')],
        [kbRefresh('menu_tracker')],
        [kbBackMain()],
    ]);
}

export function trackingPrefsMenuText(prefsSummary: string): string {
    return uiScreen({
        icon: '⚙️',
        title: 'Tracking sources',
        body:
            prefsSummary +
            '\n\n<b>Sources</b>\n' +
            '• <b>Personal</b> — <code>/track</code> whales\n' +
            '• <b>Global</b> — admin list\n' +
            '• <b>Community</b> — whales others track\n\n' +
            '<b>Copy-mint</b> — free only, or free + paid',
        footer: '<i>Global auto-mint must be ON for copy-mint to run.</i>',
    });
}

export function trackingPrefsMenuKeyboard(prefs: {
    alertPersonal: boolean;
    alertGlobal: boolean;
    alertCommunity: boolean;
    autoMintPersonal: boolean;
    autoMintGlobal: boolean;
    autoMintCommunity: boolean;
    copyMintPaymentFilter: 'free_only' | 'all';
}) {
    const t = (on: boolean) => uiToggleIcon(on);
    const payLabel =
        prefs.copyMintPaymentFilter === 'free_only' ? 'Free only' : 'Free + paid';
    return Markup.inlineKeyboard([
        [
            Markup.button.callback(`Alert you ${t(prefs.alertPersonal)}`, 'tp_ap'),
            Markup.button.callback(`Alert global ${t(prefs.alertGlobal)}`, 'tp_ag'),
        ],
        [Markup.button.callback(`Alert community ${t(prefs.alertCommunity)}`, 'tp_ac')],
        [
            Markup.button.callback(`Mint you ${t(prefs.autoMintPersonal)}`, 'tp_mp'),
            Markup.button.callback(`Mint global ${t(prefs.autoMintGlobal)}`, 'tp_mg'),
        ],
        [Markup.button.callback(`Mint community ${t(prefs.autoMintCommunity)}`, 'tp_mc')],
        [Markup.button.callback(`Copy-mint: ${payLabel}`, 'tp_pay')],
        [
            Markup.button.callback('Personal only', 'tp_preset_personal'),
            Markup.button.callback('Global + you', 'tp_preset_global'),
        ],
        [
            Markup.button.callback('All sources', 'tp_preset_all'),
            Markup.button.callback('Alerts only', 'tp_preset_alerts'),
        ],
        [Markup.button.callback('← Whales', 'menu_tracker'), kbBackMain()],
    ]);
}

export function executionsMenuText(
    trades: { timestamp: number; status: string; target?: string; hash?: string; error?: string; nftName?: string; tokenId?: string }[],
    totals: { ok: number; fail: number; eth: string }
): string {
    if (trades.length === 0) {
        return uiScreen({
            icon: '📋',
            title: 'History',
            body: '<i>No mints yet. Copy-trades and manual mints appear here.</i>',
        });
    }
    const rows = trades.slice(0, 10).map(trade => {
        const time = new Date(trade.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
        const label =
            trade.nftName ||
            (trade.tokenId ? `#${trade.tokenId}` : (trade.target || '').slice(0, 10));
        return formatHistoryRow({
            time,
            status: trade.status,
            label,
            hash: trade.hash,
            error: trade.error,
        });
    });
    return uiScreen({
        icon: '📋',
        title: 'History',
        body:
            rows.join('\n') +
            `\n\n✓ <b>${totals.ok}</b>  ·  ✗ <b>${totals.fail}</b>  ·  ${totals.eth} ETH spent`,
    });
}

export function executionsMenuKeyboard() {
    return Markup.inlineKeyboard([[kbRefresh('menu_executions')], [kbBackMain()]]);
}
