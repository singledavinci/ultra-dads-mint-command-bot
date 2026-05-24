import {
    shouldSendMessageAsync,
    recordSent,
    getStats as getDedupeStats,
} from './messageDedupeStore';

export interface TelegramSendOpts {
    parseMode?: 'HTML' | 'Markdown';
    chatId?: string;
    disablePreview?: boolean;
    dedupeKey?: string;
    dedupeTtlMs?: number;
}

type TelegramSender = (chatId: string, text: string, opts: TelegramSendOpts) => Promise<void>;
type DiscordSender = (text: string) => Promise<void>;

let telegramSender: TelegramSender | null = null;
let discordSender: DiscordSender | null = null;

const DEFAULT_TELEGRAM_TTL = parseInt(process.env.MESSAGE_DEDUPE_TTL_MS || '300000', 10);

export function configureNotificationSenders(cfg: {
    telegram?: TelegramSender;
    discord?: DiscordSender;
}): void {
    if (cfg.telegram) telegramSender = cfg.telegram;
    if (cfg.discord) discordSender = cfg.discord;
}

function defaultTelegramSender(): TelegramSender {
    return async (chatId, text, opts) => {
        const token = process.env.BOT_TOKEN;
        if (!token) throw new Error('BOT_TOKEN not configured');
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: opts.parseMode ?? 'HTML',
                link_preview_options: opts.disablePreview ? { is_disabled: true } : undefined,
            }),
        });
    };
}

function defaultDiscordSender(): DiscordSender {
    return async text => {
        const webhook = process.env.DISCORD_WEBHOOK_URL;
        if (!webhook) return;
        await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text.slice(0, 1900) }),
        });
    };
}

async function guardedSend(key: string, ttlMs: number, send: () => Promise<void>): Promise<boolean> {
    if (!(await shouldSendMessageAsync(key, ttlMs))) return false;
    await send();
    recordSent(key);
    return true;
}

export async function sendTelegram(text: string, opts: TelegramSendOpts = {}): Promise<boolean> {
    const chatId = opts.chatId || process.env.GROUP_ID || process.env.PERSONAL_ID;
    if (!chatId) return false;

    const key = opts.dedupeKey ?? `tg:${chatId}:${hashText(text)}`;
    const ttl = opts.dedupeTtlMs ?? DEFAULT_TELEGRAM_TTL;
    const sender = telegramSender ?? defaultTelegramSender();

    return guardedSend(key, ttl, async () => {
        await sender(chatId, text, opts);
    });
}

export async function sendDiscord(text: string, dedupeKey?: string): Promise<boolean> {
    if (!process.env.DISCORD_WEBHOOK_URL && !discordSender) return false;
    const key = dedupeKey ?? `discord:${hashText(text)}`;
    const sender = discordSender ?? defaultDiscordSender();
    return guardedSend(key, DEFAULT_TELEGRAM_TTL, () => sender(text));
}

export async function notifyCopyDetected(params: {
    txHash: string;
    whale: string;
    contract: string;
    routeType: string;
    chatId?: string;
}): Promise<boolean> {
    const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
    const text =
        `🐋 <b>Copy detected</b>\n` +
        `Whale: <code>${short(params.whale)}</code>\n` +
        `Contract: <code>${short(params.contract)}</code>\n` +
        `Route: ${params.routeType}\n` +
        `<a href="https://etherscan.io/tx/${params.txHash}">Etherscan</a>`;
    return sendTelegram(text, {
        chatId: params.chatId,
        dedupeKey: `copy-detected:${params.txHash.toLowerCase()}`,
    });
}

export async function notifyCopyPlan(params: {
    txHash: string;
    routeType: string;
    canAutoExecute: boolean;
    reason: string;
    totalValueEth?: string;
    chatId?: string;
}): Promise<boolean> {
    const mode = params.canAutoExecute ? '✅ Auto-execute' : '⚠️ Alert only';
    const text =
        `📋 <b>Copy plan</b> ${mode}\n` +
        `Route: ${params.routeType}\n` +
        `${params.reason}\n` +
        (params.totalValueEth ? `Value: ${params.totalValueEth} ETH\n` : '') +
        `<a href="https://etherscan.io/tx/${params.txHash}">Source tx</a>`;
    return sendTelegram(text, {
        chatId: params.chatId,
        dedupeKey: `copy-plan:${params.txHash.toLowerCase()}:${params.canAutoExecute}`,
    });
}

export async function notifyCopySkipped(params: {
    txHash: string;
    reason: string;
    chatId?: string;
}): Promise<boolean> {
    const text = `⏭️ <b>Copy skipped</b>\n${params.reason}\n<code>${params.txHash.slice(0, 18)}…</code>`;
    return sendTelegram(text, {
        chatId: params.chatId,
        dedupeKey: `copy-skip:${params.txHash.toLowerCase()}`,
        dedupeTtlMs: 120_000,
    });
}

export function getNotificationDedupeStats() {
    return getDedupeStats();
}

/** True when DISCORD_WEBHOOK_URL is set and mirroring is not disabled. */
export function isDiscordMirrorEnabled(): boolean {
    if (!process.env.DISCORD_WEBHOOK_URL?.trim()) return false;
    return process.env.DISCORD_MIRROR_ALERTS !== 'false';
}

/** Strip Telegram HTML to plain text for Discord webhooks. */
export function stripTelegramHtml(html: string): string {
    return html
        .replace(/<a href="([^"]+)">([^<]*)<\/a>/gi, '$2 ($1)')
        .replace(/<code>([^<]*)<\/code>/gi, '`$1`')
        .replace(/<\/?(?:b|i)>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export async function mirrorHtmlToDiscord(html: string, dedupeKey: string): Promise<boolean> {
    if (!isDiscordMirrorEnabled()) return false;
    return sendDiscord(stripTelegramHtml(html), dedupeKey);
}

export async function notifyMintConfirmed(params: {
    collectionName: string;
    contract: string;
    successCount: number;
    failCount: number;
    pendingCount?: number;
    walletTotal?: number;
    sampleTxHash?: string;
    mintedByLabel?: string;
}): Promise<boolean> {
    const name = params.collectionName !== 'Unknown' ? params.collectionName : 'Mint';
    const pending =
        params.pendingCount && params.pendingCount > 0
            ? ` · ${params.pendingCount} still confirming`
            : '';
    const lines = [
        `✅ **${name}** — mint confirmed`,
        `Contract: \`${params.contract}\``,
        `**${params.successCount}** confirmed · **${params.failCount}** reverted${pending}`,
    ];
    if (params.walletTotal && params.walletTotal > 0) {
        lines.push(`Wallets: ${params.walletTotal}`);
    }
    if (params.mintedByLabel) lines.push(params.mintedByLabel);
    if (params.sampleTxHash) {
        lines.push(`https://etherscan.io/tx/${params.sampleTxHash}`);
    }
    const key = `mint-confirm:${params.contract.toLowerCase()}:${params.sampleTxHash?.toLowerCase() || `${params.successCount}-${params.failCount}`}`;
    return sendDiscord(lines.join('\n'), key);
}

export async function notifyWhaleAlertMirror(params: {
    txHash: string;
    html: string;
}): Promise<boolean> {
    return mirrorHtmlToDiscord(params.html, `whale:${params.txHash.toLowerCase()}`);
}

function hashText(text: string): string {
    let h = 0;
    for (let i = 0; i < Math.min(text.length, 200); i++) {
        h = (h * 31 + text.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}
