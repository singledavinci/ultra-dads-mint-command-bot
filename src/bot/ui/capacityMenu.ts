/**
 * Interactive capacity menu — status, toggles, and setting explanations.
 */
import { Markup } from 'telegraf';
import type { CapacityStatus } from '../../utils/capacityStatus';
import { isCapacityOverride } from '../../config/capacityOverrides';
import { uiRow, uiScreen } from './premiumMessages';
import { kbBackMain } from './telegramUi';

export type CapacityHelpSection = 'exec' | 'detect' | 'retry' | CapacityHelpItem;

export type CapacityHelpItem =
    | 'automint_users'
    | 'global_mint'
    | 'wallets_exec'
    | 'preflight'
    | 'sim'
    | 'max_wallets'
    | 'stream'
    | 'fast_preflight'
    | 'mempool'
    | 'ws'
    | 'boot_grace'
    | 'pending_rpc'
    | 'pending_concurrent'
    | 'rpc_retry'
    | 'rpc_base';

const HELP: Record<CapacityHelpSection, { title: string; body: string }> = {
    exec: {
        title: 'Execution',
        body:
            '<b>Execution controls</b> govern how many wallets and users mint in parallel.\n\n' +
            'Higher concurrency = faster drops but more RPC load. If you see 429 rate limits, lower these in Railway or use <code>/freerpc</code> between waves.\n\n' +
            'Tap a row below for each setting.',
    },
    detect: {
        title: 'Detection',
        body:
            '<b>Detection</b> is how fast the bot sees whale mints.\n\n' +
            '<b>Mempool (fastest)</b> — needs <code>WS_RPC_URL</code> or <code>TRACKER_WS_RPC_URL</code>. Fires on pending txs (~1–2s).\n\n' +
            '<b>Block fallback</b> — HTTP/WS confirmed blocks (~12s). Always keep ON as backup.\n\n' +
            '<b>Boot grace</b> — ignores stale mempool noise right after restart.',
    },
    retry: {
        title: 'RPC retry',
        body:
            '<b>RPC retry</b> controls backoff when your node returns 429 / rate-limit errors.\n\n' +
            'More attempts = fewer skipped wallets but slower batches on a hot node.\n\n' +
            'Change via Railway: <code>RPC_RETRY_ATTEMPTS</code>, <code>RPC_RETRY_BASE_MS</code> (requires redeploy).\n\n' +
            '<b>Live pressure</b> (top of Capacity menu) shows 429 count, pending throttles, and engine queue depth — refresh after toggling mempool.',
    },
    automint_users: {
        title: 'Users / automint',
        body:
            'Parallel Telegram users processed per whale mint.\n\n' +
            '<b>Default:</b> 4\n' +
            '<b>Env:</b> <code>AUTOMINT_USER_CONCURRENCY</code>\n\n' +
            'When 10+ users have automint on the same whale, higher values finish the wave faster. Each user still runs their own wallet batch.',
    },
    global_mint: {
        title: 'Global mint',
        body:
            'Parallel users for <code>/globalmint</code> and <code>/mintall</code>.\n\n' +
            '<b>Default:</b> 8\n' +
            '<b>Env:</b> <code>GLOBAL_MINT_USER_CONCURRENCY</code>\n\n' +
            'Separate from whale automint — tuned for admin bulk mints across all users.',
    },
    wallets_exec: {
        title: 'Wallets / exec',
        body:
            'How many wallets broadcast in parallel inside one user\'s mint batch.\n\n' +
            '<b>Default:</b> 4\n' +
            '<b>Env:</b> <code>EXECUTION_CONCURRENCY</code>\n\n' +
            'Wallet #1 can still go first when Stream #1 is ON.',
    },
    preflight: {
        title: 'Preflight RPC',
        body:
            'Parallel RPC calls during preflight (nonce, balance, estimateGas).\n\n' +
            '<b>Default:</b> 4\n' +
            '<b>Env:</b> <code>PREFLIGHT_CONCURRENCY</code>\n\n' +
            'SeaDrop/Scatter rebuilds consume preflight slots — if wallets skip with "RPC rate limit", lower this or pause mempool.',
    },
    sim: {
        title: 'Simulation',
        body:
            'Parallel eth_call / estimateGas simulations.\n\n' +
            '<b>Default:</b> 4\n' +
            '<b>Env:</b> <code>SIMULATION_CONCURRENCY</code>\n\n' +
            'Whale automint usually skips simulation (<code>skipSimulation</code> in engine). Link mints and manual /mint use this pool.',
    },
    max_wallets: {
        title: 'Max wallets / run',
        body:
            'Hard cap on wallets per copy-mint execution (HD fleet + imports).\n\n' +
            '<b>Default:</b> 5\n' +
            '<b>Env:</b> <code>MAX_WALLETS_PER_EXECUTION</code>\n\n' +
            'Imported keys always included; cap applies to HD indices first.',
    },
    stream: {
        title: 'Stream #1',
        body:
            'When ON, wallet #1 is prefetched and broadcast <i>before</i> the rest of the fleet.\n\n' +
            '<b>Default:</b> ON\n' +
            '<b>Env:</b> <code>STREAM_BROADCAST</code>\n\n' +
            'Lowers time-to-mempool for your first tx — critical on competitive drops. Toggle here overrides env until redeploy (saved in bot state).',
    },
    fast_preflight: {
        title: 'Fast preflight',
        body:
            'When ON, skips per-wallet <code>estimateGas</code> + balance RPC — uses cached network gas + fixed gas limit.\n\n' +
            '<b>Default:</b> ON\n' +
            '<b>Env:</b> <code>SKIP_RPC_PREFLIGHT</code>\n\n' +
            'Turn OFF if txs revert from too-low gas limits. SeaDrop quantity scaling and Scatter still force estimate when needed. Toggle here overrides env (saved in state).',
    },
    mempool: {
        title: 'Mempool pending',
        body:
            'Subscribes to pending txs via WebSocket — fastest whale detection.\n\n' +
            '<b>Requires:</b> <code>WS_RPC_URL</code> + tracker running\n' +
            '<b>Pause:</b> <code>/freerpc</code> or toggle here\n' +
            '<b>Resume:</b> <code>/freerpc resume</code> or toggle here\n\n' +
            'Paused = confirmed-block detection only (~12s slower). Automint still works.',
    },
    ws: {
        title: 'WebSocket',
        body:
            'Live WS connection to your RPC for pending tx subscription.\n\n' +
            '<b>Env:</b> <code>WS_RPC_URL</code> or <code>TRACKER_WS_RPC_URL</code>\n\n' +
            'If "off", set a WebSocket URL in Railway and redeploy. Without WS, mempool pending cannot run.',
    },
    boot_grace: {
        title: 'Boot grace',
        body:
            'Seconds after startup where mempool detections are ignored (avoids replay flood on WS connect).\n\n' +
            '<b>Default:</b> 5s\n' +
            '<b>Env:</b> <code>TRACKER_BOOT_GRACE_MS</code>\n\n' +
            'Was 25s in older builds — 5s is Tier A default for faster post-restart sniping.',
    },
    pending_rpc: {
        title: 'Pending RPC / sec',
        body:
            'Max <code>getTransaction</code> calls per second for pending hash lookups.\n\n' +
            '<b>Default:</b> 8/s\n' +
            '<b>Env:</b> <code>TRACKER_MAX_PENDING_RPC_PER_SEC</code>\n\n' +
            'Protects free-tier RPCs from mempool firehose. Raise only on premium nodes.',
    },
    pending_concurrent: {
        title: 'Pending concurrent',
        body:
            'Max parallel pending tx fetches at once.\n\n' +
            '<b>Default:</b> 6\n' +
            '<b>Env:</b> <code>TRACKER_MAX_PENDING_CONCURRENT</code>\n\n' +
            'Works with the per-second cap — higher = snappier pending classification, more RPC burst.',
    },
    rpc_retry: {
        title: 'RPC retry attempts',
        body:
            'How many times to retry after a 429 / rate-limit before skipping a wallet.\n\n' +
            '<b>Default:</b> 4\n' +
            '<b>Env:</b> <code>RPC_RETRY_ATTEMPTS</code>\n\n' +
            'Requires redeploy to change.',
    },
    rpc_base: {
        title: 'RPC retry base',
        body:
            'Starting backoff (ms) before retrying a rate-limited RPC — doubles each attempt.\n\n' +
            '<b>Default:</b> 400ms\n' +
            '<b>Env:</b> <code>RPC_RETRY_BASE_MS</code>\n\n' +
            'Requires redeploy to change.',
    },
};

export function capacityHelpContent(section: CapacityHelpSection): string {
    const h = HELP[section];
    return uiScreen({ icon: 'ℹ️', title: h.title, body: h.body, footer: '<i>⬅️ Back to Capacity</i>' });
}

function overrideTag(key: 'streamBroadcast' | 'skipRpcPreflight'): string {
    return isCapacityOverride(key) ? ' <i>(override)</i>' : '';
}

export function capacityMenuText(s: CapacityStatus, autoMint: boolean): string {
    const mp = s.mempoolPending;
    return uiScreen({
        icon: '⚡',
        title: `Capacity · v${s.version}`,
        body:
            '<b>Execution</b>\n' +
            uiRow('Users/automint', `<b>${s.automintUserConcurrency}</b>`) +
            ' · ' +
            uiRow('Global mint', `<b>${s.globalMintUserConcurrency}</b>`) +
            '\n' +
            uiRow('Wallets/exec', `<b>${s.executionConcurrency}</b>`) +
            ' · Preflight: <b>' +
            s.preflightConcurrency +
            '</b> · Sim: <b>' +
            s.simulationConcurrency +
            '</b>\n' +
            uiRow('Max wallets/run', `<b>${s.maxWalletsPerExecution}</b>`) +
            ' · Stream #1: <b>' +
            (s.streamBroadcast ? 'ON' : 'OFF') +
            '</b>' +
            overrideTag('streamBroadcast') +
            '\n' +
            uiRow('Fast preflight', `<b>${s.skipRpcPreflight ? 'ON' : 'OFF'}</b>`) +
            overrideTag('skipRpcPreflight') +
            '\n' +
            uiRow('Auto-mint', `<b>${autoMint ? 'ON' : 'OFF'}</b>`) +
            '\n\n' +
            '<b>Detection</b>\n' +
            uiRow('Mempool', `<b>${mp.menuLabel}</b>`) +
            ' · WS: <b>' +
            (s.wsConnected ? 'connected' : 'off') +
            '</b>\n' +
            uiRow('Boot grace', `<b>${Math.round(s.trackerBootGraceMs / 1000)}s</b>`) +
            ' · Pending RPC: <b>' +
            s.trackerMaxPendingRpcPerSec +
            '/s</b> · Concurrent: <b>' +
            s.trackerMaxPendingConcurrent +
            '</b>\n\n' +
            '<b>Live pressure</b>\n' +
            uiRow('RPC 429s', `<b>${s.live.rpc429Count}</b>`) +
            ' · Read err: <b>' +
            s.live.rpcReadErrors +
            '</b> · Tracker err: <b>' +
            s.live.trackerRpcErrors +
            '</b>\n' +
            uiRow('Pending throttled', `<b>${s.live.pendingLookupThrottled}</b>`) +
            ' · In flight: <b>' +
            s.live.pendingInFlight +
            '</b> · Queue: <b>' +
            s.live.engineQueueDepth +
            '</b>\n' +
            uiRow('Engine', `<b>${s.live.enginePanic ? 'PANIC' : s.live.enginePaused ? 'PAUSED' : 'OK'}</b>`) +
            '\n\n' +
            '<b>RPC retry</b>\n' +
            uiRow('Attempts', `<b>${s.rpcRetryAttempts}</b>`) +
            ' · Base: <b>' +
            s.rpcRetryBaseMs +
            'ms</b>',
        footer: '<i>Tap toggles to change · ℹ️ for explanations · env vars need Railway redeploy</i>',
    });
}

export function capacityMenuKeyboard(s: CapacityStatus, autoMint: boolean) {
    const mp = s.mempoolPending;
    const canToggleMempool =
        mp.effective === 'on' || mp.effective === 'paused';
    const mempoolBtn = canToggleMempool
        ? Markup.button.callback(
              mp.effective === 'paused' ? '▶️ Mempool' : '⏸ Mempool',
              'cap_toggle_mempool'
          )
        : Markup.button.callback('ℹ️ Mempool (off)', 'cap_help_mempool');

    return Markup.inlineKeyboard([
        [
            Markup.button.callback(
                `Stream #1: ${s.streamBroadcast ? 'ON' : 'OFF'}`,
                'cap_toggle_stream'
            ),
            Markup.button.callback(
                `Fast preflight: ${s.skipRpcPreflight ? 'ON' : 'OFF'}`,
                'cap_toggle_fastpreflight'
            ),
        ],
        [
            Markup.button.callback(`Auto-mint: ${autoMint ? 'ON' : 'OFF'}`, 'cap_toggle_automint'),
            mempoolBtn,
        ],
        [
            Markup.button.callback('ℹ️ Execution', 'cap_help_exec'),
            Markup.button.callback('ℹ️ Detection', 'cap_help_detect'),
            Markup.button.callback('ℹ️ RPC retry', 'cap_help_retry'),
        ],
        [
            Markup.button.callback('🔄 Refresh', 'menu_capacity'),
            Markup.button.callback('🧹 Free RPC', 'action_freerpc'),
        ],
        [Markup.button.callback('⬅️ Engine', 'menu_settings'), kbBackMain()],
    ]);
}

export function capacityHelpKeyboard(section: CapacityHelpSection) {
    const itemRows: CapacityHelpItem[][] = [
        ['automint_users', 'global_mint', 'wallets_exec'],
        ['preflight', 'sim', 'max_wallets'],
        ['stream', 'fast_preflight'],
    ];
    const detectRows: CapacityHelpItem[][] = [
        ['mempool', 'ws', 'boot_grace'],
        ['pending_rpc', 'pending_concurrent'],
    ];
    const retryRows: CapacityHelpItem[][] = [['rpc_retry', 'rpc_base']];

    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    const mapSection = (items: CapacityHelpItem[]) =>
        items.map(id => {
            const h = HELP[id];
            const short = h.title.length > 14 ? h.title.slice(0, 12) + '…' : h.title;
            return Markup.button.callback(`ℹ️ ${short}`, `cap_help_${id}`);
        });

    if (section === 'exec') {
        for (const row of itemRows) rows.push(mapSection(row));
    } else if (section === 'detect') {
        for (const row of detectRows) rows.push(mapSection(row));
    } else if (section === 'retry') {
        for (const row of retryRows) rows.push(mapSection(row));
    }

    rows.push([Markup.button.callback('⬅️ Capacity', 'menu_capacity')]);
    return Markup.inlineKeyboard(rows);
}

export function capacityItemHelpKeyboard(_item: CapacityHelpItem) {
    return Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Capacity', 'menu_capacity')],
    ]);
}

export function parseCapacityHelpCallback(data: string): CapacityHelpSection | null {
    if (data === 'cap_help_exec') return 'exec';
    if (data === 'cap_help_detect') return 'detect';
    if (data === 'cap_help_retry') return 'retry';
    if (data.startsWith('cap_help_')) {
        const item = data.slice('cap_help_'.length) as CapacityHelpItem;
        if (item in HELP) return item;
    }
    return null;
}
