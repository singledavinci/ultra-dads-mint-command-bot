/**
 * Interactive /guide — user manual with section navigation.
 */
import { Markup } from 'telegraf';

export type GuideSection = 'overview' | 'mint' | 'whales' | 'wallets' | 'engine' | 'alerts' | 'admin';

const SECTIONS: GuideSection[] = ['overview', 'mint', 'whales', 'wallets', 'engine', 'alerts'];

export function guideSectionLabel(s: GuideSection): string {
    const labels: Record<GuideSection, string> = {
        overview: 'Overview',
        mint: 'Minting',
        whales: 'Whales',
        wallets: 'Wallets',
        engine: 'Engine',
        alerts: 'Alerts',
        admin: 'Admin',
    };
    return labels[s];
}

export function getGuideContent(
    section: GuideSection,
    opts: { isAdmin: boolean; version: string }
): string {
    const v = opts.version;
    switch (section) {
        case 'overview':
            return (
                `<b>Ultra Dads — Guide</b>  <code>v${v}</code>\n` +
                `<i>Overview</i>\n\n` +
                `Ultra Dads is an Ethereum minting bot built for speed: multi-wallet batch mints, whale copy-trading, scheduled drops, and block-targeted snipes.\n\n` +
                `<b>Quick start</b>\n` +
                `1. <code>/unlock</code> your access code\n` +
                `2. <code>/wallets</code> — set how many sub-wallets you need\n` +
                `3. <code>/distribute</code> — fund sub-wallets from wallet #1\n` +
                `4. <code>/setrpc</code> — optional personal Alchemy/Infura URL\n` +
                `5. <code>/track 0x…</code> — follow a whale, <code>/trackingprefs</code>, then <code>/automint on</code>\n\n` +
                `<b>Main surfaces</b>\n` +
                `• <code>/menu</code> — visual command center\n` +
                `• <code>/guide</code> — this manual (tap sections below)\n` +
                `• <code>/help</code> — flat command list (2 messages)\n\n` +
                `<b>After a mint</b>\n` +
                `You receive a private DM with the NFT name, token ID, and links. The alert group gets a short summary only — no per-wallet spam.` +
                (opts.isAdmin
                    ? `\n\n<b>RPC load</b>\n` +
                      `Between drops, <code>/freerpc</code> clears scheduled missions and block snipes and pauses mempool polling. Automint stays on. Use <code>/freerpc resume</code> before the next FCFS wave.`
                    : '')
            );

        case 'mint':
            return (
                `<b>Minting</b>\n\n` +
                `<b>/dropmint</b> <code>&lt;url|contract|slug&gt; [eth] [time]</code>\n` +
                `Schedule or mint immediately. ETH <code>0</code> = auto price at fire; non-zero = hint.\n` +
                `Resolves via Reservoir (if configured) or OpenSea; re-resolves SeaDrop/Scatter at fire.\n` +
                `• <code>… now</code> — fire immediately\n` +
                `• <code>… 14:30</code> — today UTC\n` +
                `• <code>… +10m</code> — in 10 minutes\n\n` +
                `<b>/mint</b> <code>&lt;url|contract&gt; [eth] [hex]</code>\n` +
                `Manual batch mint across your wallets. Omit hex data to auto-encode <code>mint(1)</code>.\n` +
                `Admin: add <code>global</code> to mint all users' wallets.\n\n` +
                `<b>/blockmint</b> <code>&lt;contract&gt; &lt;mode&gt; &lt;target&gt;</code>\n` +
                `Fire when a block arrives — for per-block caps (e.g. OEGP <code>freePlanting()</code>).\n` +
                `• <code>free next</code> — next block\n` +
                `• <code>free at 25109000</code> — specific block\n` +
                `• <code>free every 20</code> — 20 consecutive blocks\n` +
                `• <code>/blockmint list</code> · <code>cancel &lt;id&gt;</code>\n\n` +
                `<b>Scheduling</b>\n` +
                `<code>/scheduled</code> — pending drop missions\n` +
                `<code>/cancelschedule &lt;id&gt;</code> — cancel one mission\n` +
                (opts.isAdmin
                    ? `Admin: <code>/freerpc</code> — cancel <i>all</i> scheduled + block snipes (see Engine)\n\n`
                    : '\n') +
                `<b>/custommint</b> <code>&lt;contract&gt; &lt;eth&gt; &lt;mode&gt; …</code>\n` +
                `Advanced ABI modes: <code>tokenid</code>, <code>allowlist</code>, <code>phase</code>, <code>recipient</code>, <code>sig</code>, <code>raw</code>.\n\n` +
                `<b>Link mint</b>\n` +
                `Paste an OpenSea or contract URL in chat — the bot offers a preview with <b>Mint Now</b> / dry run.\n\n` +
                `<i>Tip: never mint directly to SeaDrop/Seaport router addresses — use the NFT contract.</i>`
            );

        case 'whales':
            return (
                `<b>Whale tracker &amp; copy-mint</b>\n\n` +
                `<b>/track 0x…</b> — add a wallet to <i>your</i> list\n` +
                `<b>/untrack 0x…</b> — remove from your list\n` +
                `<b>/mytracks</b> — view your list + current prefs summary\n` +
                `<b>/followglobal on|off</b> — quick toggle global alerts + auto-mint\n` +
                `<b>/trackingprefs</b> — fine-tune sources (menu or command):\n` +
                `• <b>Personal / Global / Community</b> — which whale pools alert you and auto-mint\n` +
                `• <b>Copy-mint</b> — <i>Free mints only</i> vs <i>Free + paid</i> (paid whale txs skipped when free-only)\n\n` +
                `<b>/automint on|off</b>\n` +
                `When ON, the bot clones qualifying mints from whales you follow across your wallets.\n` +
                `SeaDrop public drops: fills your <b>remaining per-wallet cap</b> per sub-wallet (not only wallet #1), with proper <code>estimateGas</code> when quantity is scaled above the whale’s qty.\n\n` +
                `<b>How detection works</b>\n` +
                `• WebSocket pending txs when configured (<code>WS_RPC_URL</code>)\n` +
                `• Otherwise HTTP block polling\n` +
                `• Payment mode is detected (free vs paid) before broadcast\n\n` +
                `<b>Admin only</b>\n` +
                `<code>/globaltrack</code> · <code>/globaluntrack</code> · <code>/trackingaudit</code> · bulk .txt import in chat\n\n` +
                `<i>Whale alerts post to the bound group; your mint results go to DM.</i>`
            );

        case 'wallets':
            return (
                `<b>Wallets &amp; funds</b>\n\n` +
                `<b>Fleet</b>\n` +
                `Wallets are HD-derived sub-accounts plus optional imported keys. Wallet <b>#1</b> is the hub.\n\n` +
                `<code>/wallets</code> — balances &amp; count\n` +
                `<code>/wallets 10</code> — set fleet size (max 50)\n` +
                `<code>/walletname N Label</code> — custom name in copy-mint reports\n` +
                `<code>/wallet N</code> — DM private key for wallet N\n` +
                `<code>/deletewallet</code> · <code>/cleanwallets</code>\n` +
                `<code>/importwallet 0x…</code> · <code>/clearimported</code>\n\n` +
                `<b>Moving ETH</b>\n` +
                `<code>/distribute 0.05</code> — split fixed ETH to each sub-wallet\n` +
                `<code>/distribute all</code> — split wallet #1 evenly\n` +
                `<code>/sweep</code> — pull ETH from subs back to #1\n` +
                `<code>/sweep 0xDest</code> — sweep to a custom address\n\n` +
                `<b>NFTs</b>\n` +
                `<code>/sweepnfts &lt;contract&gt; [dest] [id,id]</code> — sweep one collection across subs.\n` +
                `<code>/sweepcollection</code> — alias for collection sweep.\n` +
                `<code>/listingstatus</code> — auto-list / profit monitor / offer-accept status.\n\n` +
                `<i>Keep wallet #1 funded; subs need gas for mints.</i>`
            );

        case 'engine':
            return (
                `<b>Engine settings</b>\n\n` +
                `Toggle from <code>/menu</code> → Engine, or use commands:\n\n` +
                `<b>/automint on|off</b> — copy-trade sniper\n` +
                `<b>/forcesim</b> — simulation before broadcast (off = blind, faster, more reverts)\n` +
                `<b>/overdrive</b> — aggressive gas multiplier\n` +
                `<b>/mev on|off</b> — MEV protection routing\n` +
                `<b>/bribe &lt;gwei|off&gt;</b> — priority fee tip\n` +
                `<b>/maxmint &lt;eth&gt;</b> — per-mint ETH safety cap\n\n` +
                `<b>RPC</b>\n` +
                `<code>/setrpc https://…</code> — your private node (live-tested before save; <code>wss://</code> OK)\n` +
                `<code>/myrpc</code> or <code>/rpc</code> — probe latency and fallbacks\n` +
                `<code>/setrpc reset</code> — system default\n` +
                `<code>/myrpc</code> · <code>/rpc</code> — health &amp; latency\n` +
                `Admin: <code>/chain &lt;url&gt;</code> — global RPC for everyone\n\n` +
                `<b>Emergency</b>\n` +
                `<code>/pause</code> — stop auto-mint\n` +
                `<code>/resume</code> — re-enable (+ mempool if paused)\n` +
                `<code>/kill</code> — stop auto-mint + tracker (admin)\n` +
                `<code>/freerpc</code> — cancel <i>all</i> scheduled drops &amp; block snipes; pause mempool pending (admin). Automint + confirmed-block whales stay on.\n` +
                `<code>/freerpc resume</code> — restore mempool speed · <code>/freerpc status</code> — queue snapshot\n` +
                `Also in <code>/menu</code> → Emergency or Mint (admin buttons)\n\n` +
                `<b>Diagnostics</b>\n` +
                `<code>/status</code> · <code>/execution</code> · <code>/lastexec</code> · <code>/gas</code>`
            );

        case 'alerts':
            return (
                `<b>Alerts &amp; notifications</b>\n\n` +
                `<b>Group binding</b>\n` +
                `Admin runs <code>/bind &lt;chat_id&gt;</code> (or forwards group ID) so whale alerts and global mint summaries post there.\n\n` +
                `<b>What posts in the group</b>\n` +
                `• Whale mint detected (contract, ETH, Etherscan)\n` +
                `• Copy-mint execution summary (aggregated — wallets confirmed / reverted / hit rate)\n` +
                `• Scheduled drop fired\n\n` +
                `<b>What stays in DM</b>\n` +
                `• Per-wallet transaction links\n` +
                `• NFT image + OpenSea link after confirmation\n` +
                `• Private keys from <code>/wallet</code>\n` +
                `• Skipped auto-mint reasons\n\n` +
                `<b>Price monitor</b> (admin)\n` +
                `<code>/monitor &lt;contract&gt; &lt;floor_eth&gt;</code> — floor alert\n` +
                `<code>/unmonitor &lt;contract&gt;</code>`
            );

        case 'admin':
            if (!opts.isAdmin) {
                return `<b>Admin</b>\n\n<i>This section is only available to the bot administrator.</i>`;
            }
            return (
                `<b>Admin</b>\n\n` +
                `<b>Access</b>\n` +
                `<code>/setcode &lt;code|off&gt;</code> — lock bot; changing code forces everyone to <code>/unlock</code> again\n` +
                `<code>/listusers</code> · <code>/lockuser &lt;id&gt;</code>\n` +
                `<code>/broadcast &lt;message&gt;</code> — all known users (wallets + unlocked + DB) + alert group\n` +
                `<code>/listusers</code> — preview full broadcast audience\n\n` +
                `<b>Global mint</b>\n` +
                `<code>/globalmint &lt;link or contract&gt;</code> — link-mint all fleets (runs in background; shows progress)\n` +
                `<code>/mint global 0xContract 0.08 [calldata]</code> — raw batch for all users\n` +
                `<code>/mintall &lt;link&gt;</code> — any user: full personal fleet\n\n` +
                `<b>Tracker</b>\n` +
                `<code>/globaltrack</code> · <code>/cleartrack</code> · <code>/trackingaudit</code>\n` +
                `POST <code>/api/admin/resync-tracks</code> (dashboard API key)\n\n` +
                `<b>RPC relief</b>\n` +
                `<code>/freerpc</code> — bulk-cancel scheduled + block mint jobs; pause mempool <code>pending</code> RPC\n` +
                `<code>/freerpc resume</code> · <code>/freerpc status</code>\n` +
                `Menu: Emergency → <b>FREE RPC</b> / <b>Resume RPC</b> / <b>RPC queue</b>\n\n` +
                `<b>Compromised / drained wallets</b>\n` +
                `<code>/compromised N</code> — mark wallet #N (excluded from mint; still sweep <i>from</i> it)\n` +
                `<code>/uncompromised N</code> · <code>/compromised</code> — list marked slots\n` +
                `<code>/wallets</code> shows ☠️ on poisoned slots\n` +
                `<code>/deletewallet N</code> · <code>/clearimported</code>\n` +
                `<code>/clearseed</code> — wipe legacy seed from saved state + clear admin fleet\n` +
                `<code>/freshadminwallets purge 5</code> — same + set HD slots after new env <code>MNEMONIC</code>\n` +
                `<code>/freshadminwallets import 3</code> — import-only (other users unaffected)\n` +
                `Never <code>/sweep</code> into a compromised wallet — use <code>/sweep 0xColdWallet</code>\n` +
                `<i>Seed lives in Railway <code>MNEMONIC</code> only — not state.json / Mongo.</i>\n\n` +
                `<b>Infrastructure</b>\n` +
                `<code>/chain</code> · <code>/exportseed</code> · <code>/kick</code>\n` +
                `Railway env: <code>PROVIDER_URL</code>, <code>WS_RPC_URL</code>, <code>MNEMONIC</code>, <code>BOT_TOKEN</code>\n\n` +
                `<b>Debug</b>\n` +
                `<code>/debug_status</code> · <code>/debug_automint</code> · <code>/debug_tracker</code> · <code>/debug_lastskip</code>`
            );

        default:
            return getGuideContent('overview', opts);
    }
}

export function getGuideKeyboard(active: GuideSection, isAdmin: boolean) {
    const sections: GuideSection[] = isAdmin ? [...SECTIONS, 'admin'] : SECTIONS;
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];

    for (let i = 0; i < sections.length; i += 3) {
        const chunk = sections.slice(i, i + 3).map(s => {
            const prefix = s === active ? '• ' : '';
            return Markup.button.callback(`${prefix}${guideSectionLabel(s)}`, `guide_${s}`);
        });
        rows.push(chunk);
    }

    rows.push([
        Markup.button.callback('« Home', 'menu_main'),
        Markup.button.callback('Full /help', 'guide_help'),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function parseGuideSection(data: string): GuideSection | null {
    const m = data.match(/^guide_(overview|mint|whales|wallets|engine|alerts|admin)$/);
    return m ? (m[1] as GuideSection) : null;
}
