import type { Context, MiddlewareFn } from 'telegraf';
import { extractCommandFromText } from './commandCatalog.js';

type MintDashEntitlement = {
    active: boolean;
    linked: boolean;
    tier: string | null;
    accessExpiresAt: string | null;
    reason: 'active' | 'not_linked' | 'subscription_inactive' | 'account_restricted';
};

type CachedEntitlement = MintDashEntitlement & {
    checkedAt: number;
};

const entitlementCache = new Map<string, CachedEntitlement>();

function required(): boolean {
    return /^(1|true|yes|on)$/i.test((process.env.MINTDASH_ACCESS_REQUIRED ?? '').trim());
}

function internalUrl(): string {
    return (process.env.MINTDASH_INTERNAL_URL || 'http://app:3000').replace(/\/+$/, '');
}

function cacheMaxAgeMs(): number {
    const value = Number(process.env.MINTDASH_ACCESS_CACHE_MAX_AGE_MS ?? 45_000);
    return Number.isFinite(value) && value >= 5_000 ? value : 45_000;
}

function refreshIntervalMs(): number {
    const value = Number(process.env.MINTDASH_ACCESS_REFRESH_MS ?? 15_000);
    return Number.isFinite(value) && value >= 5_000 ? value : 15_000;
}

function html(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function callMintDash<T>(body: Record<string, unknown>, timeoutMs = 4_000): Promise<T> {
    const secret = process.env.MINTDASH_BOT_API_SECRET?.trim();
    if (!secret) throw new Error('MintDash bot access is not configured');

    const response = await fetch(`${internalUrl()}/api/internal/bot/access`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `MintDash access check failed (${response.status})`);
    return data;
}

function storeEntitlement(userId: string, entitlement: MintDashEntitlement): MintDashEntitlement {
    entitlementCache.set(userId, { ...entitlement, checkedAt: Date.now() });
    return entitlement;
}

export function mintDashAccessRequired(): boolean {
    return required();
}

export function hasCachedMintDashAccess(userId: string): boolean {
    if (!required()) return true;
    const cached = entitlementCache.get(userId);
    if (!cached?.active) return false;
    if (Date.now() - cached.checkedAt > cacheMaxAgeMs()) return false;
    if (cached.accessExpiresAt) {
        const expiresAt = Date.parse(cached.accessExpiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
    }
    return true;
}

export async function checkMintDashAccess(
    telegramUserId: string
): Promise<MintDashEntitlement> {
    if (!required()) {
        return {
            active: true,
            linked: true,
            tier: 'UNRESTRICTED',
            accessExpiresAt: null,
            reason: 'active',
        };
    }
    const entitlement = await callMintDash<MintDashEntitlement>({
        action: 'check',
        telegramUserId,
    });
    return storeEntitlement(telegramUserId, entitlement);
}

export async function linkMintDashAccount(params: {
    code: string;
    telegramUserId: string;
    telegramUsername?: string;
    telegramFirstName?: string;
    telegramLastName?: string;
}): Promise<MintDashEntitlement> {
    const entitlement = await callMintDash<MintDashEntitlement>({
        action: 'link',
        ...params,
    });
    return storeEntitlement(params.telegramUserId, entitlement);
}

export async function refreshMintDashEntitlements(telegramUserIds: string[]): Promise<void> {
    if (!required()) return;
    const unique = [...new Set(telegramUserIds.filter(Boolean))];
    for (let offset = 0; offset < unique.length; offset += 500) {
        const batch = unique.slice(offset, offset + 500);
        if (batch.length === 0) continue;
        const result = await callMintDash<{ entitlements: Record<string, MintDashEntitlement> }>(
            { action: 'check_many', telegramUserIds: batch },
            6_000
        );
        for (const userId of batch) {
            const entitlement = result.entitlements[userId];
            if (entitlement) storeEntitlement(userId, entitlement);
        }
    }
}

export function startMintDashEntitlementRefresh(getUserIds: () => string[]): NodeJS.Timeout | null {
    if (!required()) return null;
    const refresh = () => {
        void refreshMintDashEntitlements(getUserIds()).catch((error) => {
            console.error('[MintDashAccess] refresh failed:', (error as Error).message?.slice(0, 160));
        });
    };
    const timer = setInterval(refresh, refreshIntervalMs());
    timer.unref?.();
    return timer;
}

function deniedMessage(entitlement?: MintDashEntitlement): string {
    const reason =
        entitlement?.reason === 'account_restricted'
            ? 'Your MintDash account is suspended or locked.'
            : entitlement?.linked
              ? 'Your MintDash subscription is not active.'
              : 'Link this Telegram account to an active MintDash subscription.';
    return (
        `🔒 <b>MintDash access required</b>\n\n${reason}\n\n` +
        `1. Open <a href="https://mintdash.xyz/settings#settings-telegram-access">MintDash Settings</a>\n` +
        `2. Generate a Telegram link code\n` +
        `3. Send <code>/link YOUR_CODE</code> here`
    );
}

export function createMintDashAccessMiddleware(): MiddlewareFn<Context> {
    return async (ctx, next) => {
        if (!required() || !ctx.from?.id) return next();

        const userId = ctx.from.id.toString();
        const text =
            ctx.message && 'text' in ctx.message
                ? ctx.message.text
                : ctx.message && 'caption' in ctx.message
                  ? ctx.message.caption
                  : undefined;
        const command = extractCommandFromText(text);

        if (command === 'link') {
            const code = text?.trim().split(/\s+/)[1] ?? '';
            if (!code) {
                await ctx.reply(
                    'Open MintDash Settings → Telegram bot access, generate a code, then send:\n<code>/link YOUR_CODE</code>',
                    { parse_mode: 'HTML' }
                );
                return;
            }
            try {
                const entitlement = await linkMintDashAccount({
                    code,
                    telegramUserId: userId,
                    telegramUsername: ctx.from.username,
                    telegramFirstName: ctx.from.first_name,
                    telegramLastName: ctx.from.last_name,
                });
                await ctx.reply(
                    `✅ <b>MintDash linked</b>\nPlan: <b>${html(entitlement.tier || 'ACTIVE')}</b>\n\nBot access is now enabled while your subscription remains active.`,
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                await ctx.reply(`❌ ${html((error as Error).message || 'Link failed')}`, {
                    parse_mode: 'HTML',
                });
            }
            return;
        }

        if (command === 'subscription') {
            try {
                const entitlement = await checkMintDashAccess(userId);
                await ctx.reply(
                    entitlement.active
                        ? `✅ <b>MintDash active</b>\nPlan: <b>${html(entitlement.tier || 'ACTIVE')}</b>`
                        : deniedMessage(entitlement),
                    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
                );
            } catch {
                await ctx.reply(deniedMessage(), {
                    parse_mode: 'HTML',
                    link_preview_options: { is_disabled: true },
                });
            }
            return;
        }

        try {
            const entitlement = await checkMintDashAccess(userId);
            if (entitlement.active) return next();
            await ctx.reply(deniedMessage(entitlement), {
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
            });
        } catch (error) {
            console.error('[MintDashAccess] command check failed:', (error as Error).message?.slice(0, 160));
            await ctx.reply(
                '🔒 MintDash subscription verification is temporarily unavailable. No command was executed. Try again shortly.'
            );
        }
    };
}
