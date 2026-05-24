/**
 * Discord multi-server broadcast targets — env, file, or hybrid.
 * Never log tokens or webhook URLs.
 */
import fs from 'fs-extra';
import path from 'node:path';

const SNOWFLAKE = /^\d{17,20}$/;
const WEBHOOK_HOST = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//i;

export interface DiscordBroadcastTarget {
    label?: string;
    channelId?: string;
    webhookUrl?: string;
}

export interface DiscordBroadcastConfig {
    botToken?: string;
    targets: DiscordBroadcastTarget[];
    concurrency: number;
}

function readConcurrency(): number {
    const raw = process.env.DISCORD_BROADCAST_CONCURRENCY?.trim();
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) return 0;
    return n;
}

function normalizeTarget(raw: unknown, index: number): DiscordBroadcastTarget | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const label =
        typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 64) : undefined;
    const channelId =
        typeof o.channelId === 'string' && SNOWFLAKE.test(o.channelId.trim())
            ? o.channelId.trim()
            : undefined;
    const webhookUrl =
        typeof o.webhookUrl === 'string' && WEBHOOK_HOST.test(o.webhookUrl.trim())
            ? o.webhookUrl.trim()
            : undefined;
    if (!channelId && !webhookUrl) return null;
    if (channelId && webhookUrl) {
        throw new Error(
            `Discord broadcast target #${index + 1}: use channelId or webhookUrl, not both`
        );
    }
    return { label, channelId, webhookUrl };
}

function parseTargetsJson(json: string): DiscordBroadcastTarget[] {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
        throw new Error('DISCORD_BROADCAST_TARGETS must be a JSON array');
    }
    const out: DiscordBroadcastTarget[] = [];
    for (let i = 0; i < parsed.length; i++) {
        const t = normalizeTarget(parsed[i], i);
        if (t) out.push(t);
    }
    return out;
}

function parseTargetsLines(text: string): DiscordBroadcastTarget[] {
    const out: DiscordBroadcastTarget[] = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [idPart, labelPart] = trimmed.split('|').map(s => s.trim());
        if (WEBHOOK_HOST.test(idPart)) {
            out.push({ webhookUrl: idPart, label: labelPart || undefined });
        } else if (SNOWFLAKE.test(idPart)) {
            out.push({ channelId: idPart, label: labelPart || undefined });
        }
    }
    return out;
}

function parseWebhookList(text: string): DiscordBroadcastTarget[] {
    return text
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(u => WEBHOOK_HOST.test(u))
        .map((webhookUrl, i) => ({ webhookUrl, label: `webhook-${i + 1}` }));
}

async function loadTargetsFile(filePath: string): Promise<DiscordBroadcastTarget[]> {
    if (!(await fs.pathExists(filePath))) return [];
    const raw = await fs.readFile(filePath, 'utf8');
    return parseTargetsJson(raw);
}

/**
 * Load broadcast targets from env and optional JSON file.
 * Env DISCORD_BROADCAST_TARGETS takes precedence over file when non-empty.
 */
export async function loadDiscordBroadcastConfig(): Promise<DiscordBroadcastConfig> {
    const botToken = process.env.DISCORD_BOT_TOKEN?.trim() || undefined;
    const concurrency = readConcurrency();
    const targets: DiscordBroadcastTarget[] = [];

    const envTargets = process.env.DISCORD_BROADCAST_TARGETS?.trim();
    if (envTargets) {
        if (envTargets.startsWith('[')) {
            targets.push(...parseTargetsJson(envTargets));
        } else {
            targets.push(...parseTargetsLines(envTargets));
        }
    }

    const envWebhooks = process.env.DISCORD_BROADCAST_WEBHOOKS?.trim();
    if (envWebhooks) {
        targets.push(...parseWebhookList(envWebhooks));
    }

    if (targets.length === 0) {
        const filePath =
            process.env.DISCORD_BROADCAST_TARGETS_FILE?.trim() ||
            path.join(process.cwd(), 'data', 'discord-broadcast-targets.json');
        targets.push(...(await loadTargetsFile(filePath)));
    }

    const needsBot = targets.some(t => t.channelId);
    if (needsBot && !botToken) {
        throw new Error(
            'DISCORD_BOT_TOKEN is required when broadcast targets use channelId'
        );
    }

    const deduped = dedupeTargets(targets);
    if (deduped.length === 0) {
        throw new Error(
            'No Discord broadcast targets configured. Set DISCORD_BROADCAST_TARGETS or data/discord-broadcast-targets.json'
        );
    }

    return { botToken, targets: deduped, concurrency };
}

function dedupeTargets(targets: DiscordBroadcastTarget[]): DiscordBroadcastTarget[] {
    const seen = new Set<string>();
    const out: DiscordBroadcastTarget[] = [];
    for (const t of targets) {
        const key = t.channelId ? `c:${t.channelId}` : `w:${t.webhookUrl}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
    }
    return out;
}

/** Status summary without secrets (labels + counts only). */
export function describeDiscordBroadcastTargets(
    targets: DiscordBroadcastTarget[]
): { total: number; labels: string[]; channelCount: number; webhookCount: number } {
    let channelCount = 0;
    let webhookCount = 0;
    const labels: string[] = [];
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (t.channelId) channelCount++;
        if (t.webhookUrl) webhookCount++;
        labels.push(t.label || (t.channelId ? `channel-${i + 1}` : `webhook-${i + 1}`));
    }
    return { total: targets.length, labels, channelCount, webhookCount };
}

/** Exported for tests — parse env-style targets without file I/O. */
export function parseDiscordBroadcastTargetsFromEnv(
    envTargets?: string,
    envWebhooks?: string
): DiscordBroadcastTarget[] {
    const targets: DiscordBroadcastTarget[] = [];
    const t = envTargets?.trim();
    if (t) {
        if (t.startsWith('[')) targets.push(...parseTargetsJson(t));
        else targets.push(...parseTargetsLines(t));
    }
    const w = envWebhooks?.trim();
    if (w) targets.push(...parseWebhookList(w));
    return dedupeTargets(targets);
}

export function truncateDiscordContent(text: string, max = 1900): string {
    const trimmed = text.trim();
    if (trimmed.length <= max) return trimmed;
    return trimmed.slice(0, max - 1) + '…';
}
