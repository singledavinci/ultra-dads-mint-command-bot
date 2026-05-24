/**
 * Telegram token resolution for split-bot deployments.
 * Discord env names (COPY_BOT_DISCORD_TOKEN) are accepted as aliases for migration docs.
 */
import type { BotRole } from './role.js';

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
    for (const v of values) {
        const t = v?.trim();
        if (t) return t;
    }
    return undefined;
}

export function resolveTelegramToken(role: BotRole): string {
    const legacy = process.env.BOT_TOKEN?.trim();

    if (role === 'copy') {
        const token = firstNonEmpty(
            process.env.COPY_BOT_TOKEN,
            process.env.COPY_BOT_DISCORD_TOKEN,
            legacy
        );
        if (!token) {
            throw new Error(
                '[copy-mint-bot] Missing COPY_BOT_TOKEN (or legacy BOT_TOKEN). Create a dedicated BotFather bot for copy-mint only.'
            );
        }
        return token;
    }

    if (role === 'mint') {
        const token = firstNonEmpty(
            process.env.MINT_BOT_TOKEN,
            process.env.MINT_BOT_DISCORD_TOKEN,
            legacy
        );
        if (!token) {
            throw new Error(
                '[mint-command-bot] Missing MINT_BOT_TOKEN (or legacy BOT_TOKEN). Create a dedicated BotFather bot for mint commands only.'
            );
        }
        return token;
    }

    if (!legacy) {
        throw new Error('[bot] Missing BOT_TOKEN for monolith (BOT_ROLE=all) mode.');
    }
    return legacy;
}

export function resolveServicePort(role: BotRole, fallback: number): number {
    const raw =
        role === 'copy'
            ? process.env.COPY_BOT_PORT || process.env.PORT
            : role === 'mint'
              ? process.env.MINT_BOT_PORT || process.env.PORT
              : process.env.PORT;
    const n = parseInt(raw || String(fallback), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
