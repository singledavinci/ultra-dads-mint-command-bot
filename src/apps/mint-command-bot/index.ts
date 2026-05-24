/**
 * Mint Command Bot — Telegram entrypoint.
 * Manual mint, dropmint, blockmint, link mint, wallets admin — no whale tracker listener.
 */
process.env.BOT_ROLE = process.env.BOT_ROLE || 'mint';
process.env.MINT_BOT_ENABLED = process.env.MINT_BOT_ENABLED ?? 'true';
process.env.COPY_BOT_ENABLED = 'false';

import { resolveTelegramToken } from '../../shared/app/telegramConfig.js';
import { getServiceName } from '../../shared/app/role.js';

process.env.BOT_TOKEN = resolveTelegramToken('mint');

console.log(`[Boot] ${getServiceName('mint')} starting…`);

await import('../../bot/startBot.js');
