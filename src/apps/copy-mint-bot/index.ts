/**
 * Copy Mint Bot — Telegram entrypoint.
 * Tracking + whale detection + automint only. Does not start drop/block/link mint schedulers.
 */
process.env.BOT_ROLE = process.env.BOT_ROLE || 'copy';
process.env.COPY_BOT_ENABLED = process.env.COPY_BOT_ENABLED ?? 'true';
process.env.MINT_BOT_ENABLED = 'false';

import { resolveTelegramToken } from '../../shared/app/telegramConfig.js';
import { getServiceName } from '../../shared/app/role.js';

process.env.BOT_TOKEN = resolveTelegramToken('copy');

console.log(`[Boot] ${getServiceName('copy')} starting…`);

await import('../../bot/startBot.js');
