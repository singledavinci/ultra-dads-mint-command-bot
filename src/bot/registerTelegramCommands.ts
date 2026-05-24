import type { Telegraf } from 'telegraf';
import type { BotRole } from '../shared/app/role.js';
import { getTelegramCommandsForRole } from '../shared/app/commandCatalog.js';

/**
 * Register Telegram command menu for this bot role only.
 * Use separate BotFather bots (COPY_BOT_TOKEN vs MINT_BOT_TOKEN) so menus never overwrite each other.
 */
export async function registerTelegramCommandsForRole(
    bot: Telegraf,
    role: BotRole,
    opts?: { includeAdminSeedCommands?: boolean }
): Promise<void> {
    let commands = getTelegramCommandsForRole(role);

    if (opts?.includeAdminSeedCommands) {
        const adminExtras = [
            { command: 'clearseed', description: '(Admin) Purge stored seed; reset admin HD fleet' },
            { command: 'exportseed', description: '(Admin) Show MNEMONIC from env (DM only)' },
        ];
        const seen = new Set(commands.map(c => c.command));
        for (const extra of adminExtras) {
            if (!seen.has(extra.command)) commands.push(extra);
        }
    }

    await bot.telegram.setMyCommands(commands);
    console.log(
        `[Telegram] Registered ${commands.length} commands for role=${role} (${commands
            .slice(0, 4)
            .map(c => c.command)
            .join(', ')}…)`
    );
}
