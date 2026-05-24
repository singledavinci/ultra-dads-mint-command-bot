/**
 * Register Telegram command menu for the copy-mint bot only.
 * Run: npm run register:copy
 */
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { resolveTelegramToken } from '../../shared/app/telegramConfig.js';
import { registerTelegramCommandsForRole } from '../../bot/registerTelegramCommands.js';

process.env.BOT_ROLE = 'copy';
const token = resolveTelegramToken('copy');
const bot = new Telegraf(token);

await registerTelegramCommandsForRole(bot, 'copy', { includeAdminSeedCommands: true });
console.log('✅ Copy-mint bot commands registered. Use this bot’s @username in Telegram.');
process.exit(0);
