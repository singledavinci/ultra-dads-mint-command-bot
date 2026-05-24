import type { Context, MiddlewareFn } from 'telegraf';
import type { BotRole } from './role.js';
import { extractCommandFromText, isCommandAllowedForRole } from './commandCatalog.js';
import { getServiceName } from './role.js';

export function createCommandGateMiddleware(role: BotRole): MiddlewareFn<Context> {
    if (role === 'all') {
        return async (_ctx, next) => next();
    }

    const service = getServiceName(role);
    const other =
        role === 'copy'
            ? '@MintCommandBot (mint-command-bot service)'
            : '@CopyMintBot (copy-mint-bot service)';

    return async (ctx, next) => {
        const text =
            ctx.message && 'text' in ctx.message
                ? ctx.message.text
                : ctx.message && 'caption' in ctx.message
                  ? ctx.message.caption
                  : undefined;

        const cmd = extractCommandFromText(text);
        if (cmd && !isCommandAllowedForRole(cmd, role)) {
            await ctx.reply(
                `This command is not available on <b>${service}</b>.\n` +
                    `Use the other bot instance: ${other}\n\n` +
                    `<i>Each Telegram bot has its own command menu — register with npm run register:copy / register:mint.</i>`,
                { parse_mode: 'HTML' }
            );
            return;
        }

        return next();
    };
}
