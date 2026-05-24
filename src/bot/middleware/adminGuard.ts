/**
 * Reusable Telegram authorization helpers.
 *
 * Phase 1 keeps these lightweight; the bot still wires them in-line at the top
 * of each command. Later phases can lift `bot.command(...)` registration into a
 * factory that calls `requireAdmin` automatically.
 */

import type { Context } from 'telegraf';
import { loadEnv } from '../../config/env';

const env = loadEnv();

/**
 * Returns true and lets execution continue when the caller is admin.
 * Otherwise replies with a generic refusal and returns false.
 *
 * Use as: `if (!(await requireAdmin(ctx))) return;`
 */
export async function requireAdmin(ctx: Context): Promise<boolean> {
    const uid = ctx.from?.id?.toString();
    if (uid === env.PERSONAL_ID) return true;
    try {
        if ('callbackQuery' in (ctx.update as any) && (ctx.update as any).callback_query) {
            await ctx.answerCbQuery('Admin only.', { show_alert: true }).catch(() => {});
        } else {
            await ctx.reply('🔒 Admin only command.').catch(() => {});
        }
    } catch {
        // ignore
    }
    return false;
}

export function isAdmin(ctx: Context): boolean {
    return ctx.from?.id?.toString() === env.PERSONAL_ID;
}

/** Per-user cooldown gate, keyed by command label. */
const cooldowns = new Map<string, number>();

export function isOnCooldown(userId: string | undefined, label: string, ms: number): boolean {
    if (!userId) return false;
    const key = `${userId}:${label}`;
    const last = cooldowns.get(key) ?? 0;
    const now = Date.now();
    if (now - last < ms) return true;
    cooldowns.set(key, now);
    return false;
}

/** Strip newlines/control chars before logging a possibly-injected user value. */
export function safeLogValue(s: string | undefined | null, max = 80): string {
    if (!s) return '';
    return s.replace(/[\r\n\t\u0000-\u001F]/g, ' ').slice(0, max);
}
