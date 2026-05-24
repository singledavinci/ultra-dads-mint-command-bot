/**
 * Parallel Discord broadcast to multiple channels (bot API or webhooks).
 */
import {
    loadDiscordBroadcastConfig,
    truncateDiscordContent,
    type DiscordBroadcastConfig,
    type DiscordBroadcastTarget,
} from '../config/discordBroadcast.js';
import { claimNotification, hashBroadcastMessage } from './notificationLedger.js';
import { stripTelegramHtml } from './notificationService.js';

export interface DiscordBroadcastTargetResult {
    label?: string;
    channelId?: string;
    ok: boolean;
    error?: string;
    status?: number;
}

export interface DiscordBroadcastResult {
    sent: number;
    failed: number;
    totalTargets: number;
    elapsedMs: number;
    skippedDuplicate: boolean;
    results: DiscordBroadcastTargetResult[];
}

export type DiscordFetchFn = typeof fetch;

let fetchImpl: DiscordFetchFn = fetch;

export function setDiscordBroadcastFetch(impl: DiscordFetchFn): void {
    fetchImpl = impl;
}

export function resetDiscordBroadcastFetch(): void {
    fetchImpl = fetch;
}

function targetLabel(t: DiscordBroadcastTarget, index: number): string {
    return t.label || (t.channelId ? `channel-${index + 1}` : `webhook-${index + 1}`);
}

function prepareContent(message: string, fromHtml?: boolean): string {
    const text = fromHtml ? stripTelegramHtml(message) : message;
    return truncateDiscordContent(text);
}

async function postToChannel(
    botToken: string,
    channelId: string,
    content: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
    const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${botToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
    });
    if (res.ok) return { ok: true, status: res.status };
    let detail = res.statusText;
    try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) detail = body.message;
    } catch {
        // ignore
    }
    return { ok: false, status: res.status, error: detail };
}

async function postToWebhook(
    webhookUrl: string,
    content: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
    const res = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });
    if (res.ok) return { ok: true, status: res.status };
    let detail = res.statusText;
    try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) detail = body.message;
    } catch {
        // ignore
    }
    return { ok: false, status: res.status, error: detail };
}

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<DiscordBroadcastTargetResult>
): Promise<DiscordBroadcastTargetResult[]> {
    if (limit <= 0 || limit >= items.length) {
        return Promise.all(items.map((item, i) => fn(item, i)));
    }
    const results: DiscordBroadcastTargetResult[] = new Array(items.length);
    let next = 0;
    async function worker(): Promise<void> {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await fn(items[i], i);
        }
    }
    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

async function sendToTarget(
    config: DiscordBroadcastConfig,
    target: DiscordBroadcastTarget,
    index: number,
    content: string
): Promise<DiscordBroadcastTargetResult> {
    const label = targetLabel(target, index);
    try {
        if (target.webhookUrl) {
            const r = await postToWebhook(target.webhookUrl, content);
            return {
                label,
                ok: r.ok,
                status: r.status,
                error: r.error,
            };
        }
        if (target.channelId && config.botToken) {
            const r = await postToChannel(config.botToken, target.channelId, content);
            return {
                label,
                channelId: target.channelId,
                ok: r.ok,
                status: r.status,
                error: r.error,
            };
        }
        return { label, channelId: target.channelId, ok: false, error: 'Missing bot token' };
    } catch (e) {
        return {
            label,
            channelId: target.channelId,
            ok: false,
            error: (e as Error).message?.slice(0, 120) || 'Request failed',
        };
    }
}

export interface BroadcastToDiscordOpts {
    fromHtml?: boolean;
    dedupeKey?: string;
    skipDedupe?: boolean;
    config?: DiscordBroadcastConfig;
}

export async function broadcastToDiscordChannels(
    message: string,
    opts: BroadcastToDiscordOpts = {}
): Promise<DiscordBroadcastResult> {
    const config = opts.config ?? (await loadDiscordBroadcastConfig());
    const content = prepareContent(message, opts.fromHtml);
    if (!content) {
        throw new Error('Broadcast message is empty');
    }

    const dedupeKey =
        opts.dedupeKey ?? `discord-mass:${hashBroadcastMessage(content)}`;
    if (!opts.skipDedupe) {
        const claimed = await claimNotification(dedupeKey, 'discord_mass_broadcast');
        if (!claimed) {
            return {
                sent: 0,
                failed: 0,
                totalTargets: config.targets.length,
                elapsedMs: 0,
                skippedDuplicate: true,
                results: [],
            };
        }
    }

    const start = Date.now();
    const limit = config.concurrency > 0 ? config.concurrency : config.targets.length;
    const results = await runWithConcurrency(config.targets, limit, (target, i) =>
        sendToTarget(config, target, i, content)
    );
    const elapsedMs = Date.now() - start;

    let sent = 0;
    let failed = 0;
    for (const r of results) {
        if (r.ok) sent++;
        else failed++;
    }

    return {
        sent,
        failed,
        totalTargets: config.targets.length,
        elapsedMs,
        skippedDuplicate: false,
        results,
    };
}

/** Load config for status command without throwing when empty. */
export async function tryLoadDiscordBroadcastConfig(): Promise<DiscordBroadcastConfig | null> {
    try {
        return await loadDiscordBroadcastConfig();
    } catch {
        return null;
    }
}
