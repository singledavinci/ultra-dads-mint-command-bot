/**
 * Per-version release notes for auto-announce (/announceversion) and startup broadcast.
 * When bumping BOT_VERSION, add an entry here — never reuse a previous version's text.
 */
const VERSION_CHANGELOGS: Record<string, string> = {
    '3.5.31': [
        '<b>Two-bot architecture</b>',
        '• <code>npm run start:copy</code> — tracker + automint only (COPY_BOT_TOKEN)',
        '• <code>npm run start:mint</code> — mint/drop/block/link commands (MINT_BOT_TOKEN)',
        '• Separate Telegram menus: <code>register:copy</code> / <code>register:mint</code>',
        '• Health: <code>/health/copy-mint</code> and <code>/health/mint-command</code>',
    ].join('\n'),
    '3.5.30': [
        '<b>Automint — success dedupe</b>',
        '• After a wallet confirms a mint, automint skips that wallet on the same contract',
        '• Stops gas burn when another whale mints the same drop you already got',
        '• Default TTL 24h — <code>AUTOMINT_SUCCESS_DEDUPE_TTL_MS</code> · disable with <code>AUTOMINT_SUCCESS_DEDUPE=false</code>',
    ].join('\n'),
    '3.5.29': [
        '<b>Capacity — live stats + faster automint</b>',
        '• Capacity menu shows RPC 429s, pending throttles, engine queue',
        '• Whale gas passed from tracker — no duplicate getTransaction on automint',
        '• SeaDrop public drop cached once per whale (not per user)',
        '• Automint/global concurrency unified in runtimeConfig',
    ].join('\n'),
    '3.5.28': [
        '<b>Capacity menu</b>',
        '• <code>/capacity</code> or <code>/debug_capacity</code> — interactive admin menu',
        '• Toggle Stream #1, fast preflight, auto-mint, mempool pending',
        '• ℹ️ explanations for every concurrency / detection setting',
    ].join('\n'),
    '3.5.27': [
        '<b>Capacity — Tier A defaults</b>',
        '• Execution/preflight concurrency 4 · automint users 4 · boot grace 5s',
        '• Tracker pending RPC 8/s · 6 concurrent lookups',
        '• SeaDrop public automint hijacks whale calldata (no per-wallet re-resolve)',
        '• <code>/debug_capacity</code> — live concurrency + detection snapshot',
    ].join('\n'),
    '3.5.26': [
        '<b>Scatter list order</b>',
        '• Free invite lists are tried before paid (default)',
        '• Set <code>SCATTER_PREFER_PAID_LIST=true</code> to try paid first',
    ].join('\n'),
    '3.5.25': [
        '<b>Fix — Scatter.art mints</b>',
        '• Scatter API calldata per wallet; retries alternate invite lists',
        '• Skip strict payment simulation for Scatter API calldata',
        '• Paste <code>https://www.scatter.art/collection/…</code> or use <code>/scattermint</code>',
    ].join('\n'),
    '3.5.24': [
        '<b>Fix — SeaDrop mints</b>',
        '• <code>mintPublic</code> / allowlist now use <code>minterIfNotPayer = 0</code> for self-mints',
        '• Fixes on-chain <code>PayerNotAllowed()</code> when payer and minter are the same wallet',
    ].join('\n'),
    '3.5.23': [
        '<b>Fix — sweep spam</b>',
        '• <code>/sweep</code> deduped (2 min cooldown per user) — stops repeated Turbo-Sweep messages',
        '• Telegram duplicate <code>update_id</code> ignored (webhook retries / twin instances)',
        '• Menu sweep button no longer re-triggers via fake <code>/sweep</code> replay',
    ].join('\n'),
    '3.5.22': [
        '<b>Fix — copy-mint</b>',
        '• SeaDrop automint again runs <code>estimateGas</code> when quantity is scaled (fixes ~112k gas reverts)',
        '• Per-wallet SeaDrop cap applied in preflight (not only the lead wallet)',
    ].join('\n'),
    '3.5.21': [
        '<b>Admin — RPC relief</b>',
        '• <code>/freerpc</code> — cancel all scheduled drops + block snipes; pause mempool pending',
        '• <code>/freerpc resume</code> / <code>/freerpc status</code> — mempool on/off and queue snapshot',
        '• <code>/resume</code> also restores mempool when paused',
    ].join('\n'),
    '3.5.20': [
        '<b>Access code</b>',
        '• Changing <code>/setcode</code> clears every unlock — all users must <code>/unlock</code> again',
        '• Use this to drop expired subscribers; wallets stay, access resets',
    ].join('\n'),
    '3.5.19': [
        '<b>Access code</b>',
        '• <code>/setcode</code> works for existing wallet users — no forced re-unlock',
        '• New users still use <code>/unlock</code>; <code>/lockuser</code> fully revokes access',
    ].join('\n'),
    '3.5.18': [
        '<b>RPC</b>',
        '• <code>/setrpc</code> live-tests your URL before saving (no more false “configured”)',
        '• <code>/myrpc</code> works — same status probe as <code>/rpc</code>',
        '• <code>wss://</code> accepted; personal RPC falls back to system nodes on rate limits',
    ].join('\n'),
    '3.5.17': [
        '<b>Performance</b>',
        '• Whale alerts send immediately; copy-mint runs in background',
        '• Confirmations no longer block Telegram commands during drops',
    ].join('\n'),
    '3.5.16': [
        '<b>Fix</b>',
        '• Copy-mint now uses the same calldata path as manual /mint (whale rewrite, not per-wallet SeaDrop re-resolve)',
        '• Automint forces estimateGas; balance checks serialized to reduce false skips and RPC errors',
    ].join('\n'),
    '3.5.15': [
        '<b>Fix</b>',
        '• SeaDrop/Scatter copy-mints now use real <code>estimateGas</code> (not ~82k intrinsic cap)',
        '• Gas limit headroom on broadcast; mirror whale tx fees when higher',
    ].join('\n'),
    '3.5.14': [
        '<b>Fix</b>',
        '• Imported wallets always included in copy-mint (correct HD/import split)',
        '• Automint checks every wallet for SeaDrop cap — not only wallet #1',
        '• Gas preflight uses realistic limits; clearer mint vs gas balance errors',
    ].join('\n'),
    '3.5.13': [
        '<b>UI refresh</b>',
        '• Cleaner menus, mint previews, gas advisor, and status messages',
        '• Copy-mint and distribution feedback show clear progress and results',
        '• Whale alerts and history use a consistent premium layout',
    ].join('\n'),
    '3.5.12': [
        '<b>Fix</b>',
        '• <code>/deletewallet</code> now removes any wallet from your list (not only the last one)',
        '• <code>/distribute</code> and mints skip deleted wallets — no more ETH to removed addresses',
    ].join('\n'),
    '3.5.11': [
        '<b>Copy-mint</b>',
        '• Auto-mint fills your SeaDrop <b>per-wallet cap</b> (not just the whale’s quantity)',
        '• <code>/trackingprefs</code> — choose <b>Free mints only</b> or <b>Free + paid</b> copy-mints',
    ].join('\n'),
    '3.5.10': [
        '<b>Fix</b>',
        '• Pasted contracts: resolve runs async — webhook ACK no longer blocked (stops duplicate “Resolving…” spam)',
        '• Per-chat lock + 28s deadline → preview or clear error; /ping stays responsive',
    ].join('\n'),
    '3.5.9': [
        '<b>Fix</b>',
        '• Bot no longer hangs 90s on pasted contracts — faster RPC scans + immediate “Resolving…” reply',
        '• Telegram handler timeout raised to 3 minutes',
    ].join('\n'),
    '3.5.8': [
        '<b>Link mint</b>',
        '• Preview no longer marks contracts as "duplicate" before you mint',
        '• Retry same contract: set <code>LINK_MINT_DEDUPE_ENABLED=false</code> or shorten <code>LINK_MINT_DEDUPE_TTL_MS</code>',
    ].join('\n'),
    '3.5.7': [
        '<b>Link mint</b>',
        '• Direct <code>freeMint()</code> collections: broadcast with competitive gas even when simulation reverts (FCFS)',
        '• Link mint uses live gwei + FCFS tier (default <code>fcfs_plus</code>) — not minimal base fee',
    ].join('\n'),
    '3.5.6': [
        '<b>Gas</b>',
        '• /mint tiers and broadcast now use <b>live network gwei</b> at send time (not fixed 12–15 gwei fallbacks)',
        '• Selected FCFS tier is applied to current base + priority fees from your RPC',
    ].join('\n'),
    '3.5.5': [
        '<b>Fix</b>',
        '• /mint wizard no longer blocks WrongSide-style collections when SeaDrop public is 0/wallet but on-chain mints use <code>freeMint()</code> on the NFT contract',
        '• Faster direct-mint detection with smaller log scans + RPC fallback',
    ].join('\n'),
    '3.5.4': [
        '<b>Fix</b>',
        '• Contracts like WrongSide Punks: detect <code>freeMint()</code> on the NFT contract from recent txs — no longer forced through SeaDrop',
        '• <code>/blockmint auto</code> and <code>/mint</code> send to the NFT contract when on-chain mints do',
    ].join('\n'),
    '3.5.3': [
        '<b>Fix</b>',
        '• SeaDrop mints (e.g. WrongSide Punks) route to the SeaDrop router, not the NFT contract',
        '• Block mint + wizard block when public mint is 0/wallet with clear raw-calldata workaround',
    ].join('\n'),
    '3.5.2': [
        '<b>Fix</b>',
        '• /sweepnfts actually transfers NFTs — Alchemy NFT API + on-chain discovery (Reservoir was dead)',
        '• Honest results: no false “complete” when 0 found or 0 moved; Etherscan tx links on success',
    ].join('\n'),
    '3.5.1': [
        '<b>Fixes</b>',
        '• Imported wallets now always join copy-mint / batch mint (no longer dropped by wallet cap)',
        '• Post-mint reports poll on-chain receipts — fewer false errors and missing summaries',
        '• /sweepnfts &lt;contract&gt; — scan subs + imported wallets, sweep to Wallet #1 (Alchemy discovery)',
    ].join('\n'),
    '3.5.0': [
        '<b>Alerts</b>',
        '• Richer whale alerts — collection image, minted/max supply, tx link',
        '• Admin channel shows which user scheduled drop / block mints',
        '• Non-admin mints no longer spam shared groups — admin channel + minter DM only',
    ].join('\n'),
    '3.4.9': [
        '<b>Fix</b>',
        '• Interactive /mint wizard no longer stalls after picking mint price (gas JSON BigInt crash)',
    ].join('\n'),
    '3.4.8': [
        '<b>New</b>',
        '• Interactive /mint wizard with FCFS gas tiers (gwei + $ estimates)',
        '• Batch mint uses SeaDrop resolution + live estimateGas like link mint',
    ].join('\n'),
    '3.4.7': [
        '<b>Fixes</b>',
        '• Paste-contract / link mint: SeaDrop v1.0 path (correct mintPublic selector + fee recipient)',
        '• Mint sends to SeaDrop router, not NFT contract; link mint always estimateGas (no 150k cap)',
    ].join('\n'),
    '3.4.6': [
        '<b>Fixes</b>',
        '• Mass DMs and whale alerts deduped in Mongo (no repeat broadcasts on deploy)',
        '• Single whale group alert (no double ping)',
        '• /freshadminwallets + wallet generator script',
    ].join('\n'),
    '3.4.5': [
        '<b>Fixes</b>',
        '• /rpc uses raw JSON-RPC probes (fixes false failures and -32003 rate-limit noise)',
        '• Shows mint pool latency (actual FallbackProvider) plus per-endpoint pings',
    ].join('\n'),
    '3.4.4': [
        '<b>Fixes</b>',
        '• Deploy/restart no longer replays piled-up whale mints from earlier sessions',
        '• Boot grace + chain-head sync + Mongo/file seen-tx ledger',
        '• Stale mempool notifications (already-mined txs) are ignored',
        '• /rpc runs live latency probes (per endpoint + optional WebSocket)',
    ].join('\n'),
    '3.4.3': [
        '<b>Fixes</b>',
        '• Duplicate DMs — mint reports, whale alerts, and block mint no longer send the same message twice',
        '• Private mints update your existing chat instead of a second NFT DM',
        '',
        '<b>Version broadcasts</b>',
        '• Auto-announce uses per-version release notes only (no stale text from an older deploy)',
        '• Redeploying the same version will not re-broadcast (Mongo ledger + state guard)',
    ].join('\n'),
    '3.4.2': [
        '<b>Fixes</b>',
        '• Duplicate DMs — mint reports, whale alerts, and block mint no longer send the same message twice',
        '• Private mints update your existing chat instead of sending a second NFT DM',
        '',
        '<b>Version broadcasts</b>',
        '• Auto-announce only sends notes defined for that exact version (no stale changelog text)',
    ].join('\n'),
    '3.4.1': [
        '<b>Fixes</b>',
        '• Version auto-announce is opt-in and idempotent (Mongo + file ledger)',
        '• Restarts and overlapping deploys no longer re-broadcast the same version',
    ].join('\n'),
    '3.4.0': [
        '<b>New</b>',
        '• Wallet display names (<code>/walletname</code>)',
        '• Collection NFT sweep, listing status, auto-accept offers (MVP)',
        '• Dashboard wallet label edits',
    ].join('\n'),
};

/** Release notes body for a version (HTML bullets, no outer title). */
export function getVersionChangelogBody(version: string): string | null {
    const key = version.trim();
    const mapped = VERSION_CHANGELOGS[key];
    if (mapped) return mapped;

    const envTarget = (process.env.VERSION_CHANGELOG_FOR || '').trim();
    const envBody = (process.env.VERSION_CHANGELOG || '').trim();
    if (envBody && (!envTarget || envTarget === key)) {
        return envBody.replace(/\\n/g, '\n');
    }

    return null;
}

/** Full Telegram HTML message for a version broadcast, or null if no notes exist. */
export function buildVersionAnnounceMessage(version: string, body?: string | null): string | null {
    const notes = body ?? getVersionChangelogBody(version);
    if (!notes) return null;

    return (
        `🚀 <b>Ultra Dads Minter Bot — v${version}</b>\n\n` +
        `${notes}\n\n` +
        `✨ <i>Use /menu for the command center.</i>`
    );
}

export function listVersionsWithChangelog(): string[] {
    return Object.keys(VERSION_CHANGELOGS).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
