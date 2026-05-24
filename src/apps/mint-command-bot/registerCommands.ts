/**
 * Register Telegram command menu for the mint-command bot only.
 * Run: npm run register:mint
 */
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { resolveTelegramToken } from '../../shared/app/telegramConfig.js';
import { registerTelegramCommandsForRole } from '../../bot/registerTelegramCommands.js';

process.env.BOT_ROLE = 'mint';
const token = resolveTelegramToken('mint');
const bot = new Telegraf(token);

await registerTelegramCommandsForRole(bot, 'mint', { includeAdminSeedCommands: true });
console.log('✅ Mint-command bot commands registered. Use this bot’s @username in Telegram.');
process.exit(0);
