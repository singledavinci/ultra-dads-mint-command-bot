/**
 * Premium Telegram copy — shared layout, status lines, and mint feedback.
 * HTML parse_mode safe (escape user content via escapeHtml).
 */

export const UI_DIVIDER = '──────────────────────';
export const UI_BRAND = 'ULTRA DADS';

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function shortenAddress(addr: string, head = 6, tail = 4): string {
    if (!addr || addr.length < head + tail + 2) return addr || '';
    return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function etherscanTxLink(hash: string, label = 'Etherscan'): string {
    if (!hash || hash === 'N/A') return label;
    return `<a href="https://etherscan.io/tx/${hash}">${label}</a>`;
}

export function etherscanAddrLink(addr: string, label?: string): string {
    const text = label || shortenAddress(addr);
    return `<a href="https://etherscan.io/address/${addr}">${escapeHtml(text)}</a>`;
}

/** Screen header: icon + title + divider + body + optional footer. */
export function uiScreen(params: {
    title: string;
    icon?: string;
    body: string;
    footer?: string;
}): string {
    const head = params.icon ? `${params.icon} <b>${params.title}</b>` : `<b>${params.title}</b>`;
    let out = `${head}\n${UI_DIVIDER}\n${params.body}`;
    if (params.footer) out += `\n\n${params.footer}`;
    return out;
}

export function uiRow(label: string, value: string): string {
    return `${label}  ${value}`;
}

export function uiOnOff(on: boolean, onLabel = 'ON', offLabel = 'off'): string {
    return on ? `<b>${onLabel}</b>` : `<i>${offLabel}</i>`;
}

export function uiToggleIcon(on: boolean): string {
    return on ? '●' : '○';
}

export function uiLiveDot(live: boolean): string {
    return live ? '🟢' : '🔴';
}

export function uiConfidenceBadge(conf: string): string {
    const c = conf.toLowerCase();
    if (c === 'high') return '<b>High</b>';
    if (c === 'medium') return '<b>Medium</b>';
    return '<i>Low</i>';
}

/** Post-confirmation summary (group or DM). */
export function formatMintExecutionSummary(params: {
    title: string;
    successCount: number;
    failCount: number;
    pendingCount?: number;
    walletTotal: number;
    mempoolLinks?: string;
}): string {
    const { title, successCount, failCount, pendingCount = 0, walletTotal, mempoolLinks } = params;
    const rate = walletTotal > 0 ? Math.round((successCount / walletTotal) * 100) : 0;
    const pendingLine =
        pendingCount > 0 ? `  ·  <b>${pendingCount}</b> pending` : '';
    const stats =
        `✓ <b>${successCount}</b> confirmed` +
        (failCount > 0 ? `  ·  ✗ <b>${failCount}</b> reverted` : '') +
        pendingLine +
        `  ·  <b>${rate}%</b> hit` +
        `  ·  ${walletTotal} wallet${walletTotal === 1 ? '' : 's'}`;
    const links = mempoolLinks?.trim() ? `\n\n${mempoolLinks.trim()}` : '';
    return `${title}\n${UI_DIVIDER}\n${stats}${links}`;
}

export function formatAutomintExecuting(params: {
    contract: string;
    participants: number;
    route?: string;
    qty?: number;
}): string {
    const routeLine = params.route
        ? uiRow('Route', `<code>${escapeHtml(params.route)}</code>`)
        : '';
    const qtyLine =
        params.qty && params.qty > 1
            ? uiRow('Quantity', `<b>${params.qty}</b> per wallet`)
            : '';
    return uiScreen({
        icon: '⚡',
        title: 'Copy-mint in progress',
        body:
            uiRow('Contract', `<code>${escapeHtml(shortenAddress(params.contract, 8, 6))}</code>`) +
            '\n' +
            uiRow('Participants', `<b>${params.participants}</b>`) +
            (routeLine ? `\n${routeLine}` : '') +
            (qtyLine ? `\n${qtyLine}` : ''),
        footer: '<i>Broadcasting to your fleet — confirmations follow shortly.</i>',
    });
}

export function formatAutomintSubmitted(params: {
    submitted: number;
    route: string;
    planContext?: string;
    walletLines: string;
}): string {
    return uiScreen({
        icon: '✓',
        title: 'Copy-mint submitted',
        body:
            uiRow('Transactions', `<b>${params.submitted}</b> in mempool`) +
            '\n' +
            uiRow('Route', `<code>${escapeHtml(params.route)}</code>`) +
            (params.planContext ? `\n${params.planContext}` : '') +
            (params.walletLines ? `\n\n${params.walletLines.trim()}` : ''),
        footer: '<i>Waiting for on-chain confirmation…</i>',
    });
}

export function formatAutomintSkipped(params: {
    reason: string;
    detail?: string;
    route?: string;
}): string {
    return uiScreen({
        icon: '⊘',
        title: 'Auto-mint skipped',
        body:
            uiRow('Reason', escapeHtml(params.reason)) +
            (params.route ? `\n${uiRow('Route', `<code>${escapeHtml(params.route)}</code>`)}` : '') +
            (params.detail ? `\n\n<i>${escapeHtml(params.detail)}</i>` : ''),
    });
}

export function formatAutomintNoSubmit(params: {
    route: string;
    engineReason: string;
    planContext?: string;
    extra?: string;
}): string {
    return uiScreen({
        icon: '⊘',
        title: 'No transactions submitted',
        body:
            uiRow('Route', `<code>${escapeHtml(params.route)}</code>`) +
            '\n' +
            uiRow('Detail', `<i>${escapeHtml(params.engineReason)}</i>`) +
            (params.extra ? `\n\n<i>${escapeHtml(params.extra)}</i>` : '') +
            (params.planContext ? `\n${params.planContext}` : ''),
        footer: '<i>Check wallet ETH, eligibility, or /trackingprefs</i>',
    });
}

export function formatAutomintFailed(params: { detail: string }): string {
    return uiScreen({
        icon: '✗',
        title: 'Copy-mint failed',
        body: `<i>${escapeHtml(params.detail)}</i>`,
        footer: '<i>Check Railway logs · /debug_lastskip · /debug_automint</i>',
    });
}

/** Short DM to a user after whale automint with only their wallet lines. */
export function formatUserAutomintResult(params: {
    submitted: number;
    totalWallets: number;
    lines: string;
}): string {
    return uiScreen({
        icon: params.submitted > 0 ? '✓' : '⊘',
        title: params.submitted > 0 ? 'Your copy-mint sent' : 'Your copy-mint — nothing sent',
        body:
            uiRow('Your txs', `<b>${params.submitted}</b> / ${params.totalWallets} wallets`) +
            (params.lines ? `\n\n${params.lines.trim()}` : '\n\n<i>All wallets skipped (balance, cap, or payment filter).</i>'),
    });
}

export function formatDistributionProgress(params: {
    mode: 'fixed' | 'all';
    amountEth?: string;
    perWalletEth?: string;
    walletCount: number;
    reservedGasEth?: string;
}): string {
    if (params.mode === 'all') {
        return uiScreen({
            icon: '💸',
            title: 'Distributing all ETH',
            body:
                uiRow('Split', `<b>${params.perWalletEth}</b> ETH × <b>${params.walletCount}</b> wallets`) +
                (params.reservedGasEth
                    ? `\n${uiRow('Gas reserve', `<i>${params.reservedGasEth} ETH</i>`)}`
                    : ''),
            footer: '<i>Funding from Wallet #1…</i>',
        });
    }
    return uiScreen({
        icon: '💸',
        title: 'Distributing ETH',
        body: uiRow('Amount', `<b>${params.amountEth}</b> ETH → each of <b>${params.walletCount}</b> sub-wallets`),
        footer: '<i>Funding from Wallet #1…</i>',
    });
}

export function formatDistributionComplete(params: {
    successCount: number;
    failCount: number;
    txLines: string;
}): string {
    return uiScreen({
        icon: '✓',
        title: 'Distribution complete',
        body:
            uiRow('Result', `✓ <b>${params.successCount}</b>  ·  ✗ <b>${params.failCount}</b>`) +
            (params.txLines ? `\n\n${params.txLines.trim()}` : ''),
    });
}

export function formatWalletFleetList(
    wallets: { address: string; balance: string }[],
    formatLabel: (index: number) => string,
    isCompromised?: (index: number) => boolean
): string {
    const lines = wallets.map((w, i) => {
        const label = formatLabel(i);
        const bal = parseFloat(w.balance);
        const balStr = Number.isFinite(bal) ? bal.toFixed(4) : w.balance;
        const namePart =
            label !== `W#${i + 1}` ? `<b>${escapeHtml(label)}</b> ` : '';
        const poison = isCompromised?.(i) ? ' <b>☠️ compromised</b>' : '';
        return `${namePart}<b>#${i + 1}</b>  <code>${shortenAddress(w.address)}</code>  ·  ${balStr} ETH${poison}`;
    });
    return uiScreen({
        icon: '👛',
        title: `Your fleet (${wallets.length})`,
        body: lines.join('\n'),
        footer:
            '<i>Rename · /walletname N Label\nKeys · /wallet N  ·  Remove · /deletewallet N\nCompromised · /compromised N · /uncompromised N</i>',
    });
}

export function formatLinkMintResolving(): string {
    return uiScreen({
        icon: '◷',
        title: 'Resolving mint',
        body: '<i>Reading contract, drop phase, and calldata…</i>',
    });
}

export function formatBatchMintWizardStart(): string {
    return uiScreen({
        icon: '🎯',
        title: 'Batch mint',
        body:
            'Paste a <b>contract address</b> or OpenSea / Etherscan link.\n\n' +
            '<i>Flow: target → price → gas tier → broadcast all wallets</i>',
    });
}

export function formatBatchMintBroadcasting(params: {
    tierId: string;
    routeLabel: string;
    walletCount: number;
    overdrive: boolean;
}): string {
    return uiScreen({
        icon: '⚡',
        title: 'Broadcasting',
        body:
            uiRow('Gas tier', `<b>${escapeHtml(params.tierId)}</b>`) +
            '\n' +
            uiRow('Route', escapeHtml(params.routeLabel)) +
            '\n' +
            uiRow('Wallets', `<b>${params.walletCount}</b>`) +
            '\n' +
            uiRow('Overdrive', uiOnOff(params.overdrive)),
        footer: '<i>Transactions entering the mempool…</i>',
    });
}

export function formatHistoryRow(params: {
    time: string;
    status: string;
    label: string;
    hash?: string;
    error?: string;
}): string {
    const icon = params.status === 'Success' ? '✓' : '✗';
    const link =
        params.hash && params.hash !== 'N/A' ? ` ${etherscanTxLink(params.hash, 'tx')}` : '';
    let line = `${icon} <code>${params.time}</code>  ${escapeHtml(params.label)}${link}`;
    if (params.error) line += `\n   <i>${escapeHtml(params.error.slice(0, 48))}</i>`;
    return line;
}
