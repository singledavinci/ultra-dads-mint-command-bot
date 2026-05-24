/**
 * Notification service — HTML strip + Discord mirror gating
 */

import assert from 'node:assert';
import {
    isDiscordMirrorEnabled,
    stripTelegramHtml,
} from '../src/services/notificationService.js';

const env = { ...process.env };

function restoreEnv() {
    process.env = { ...env };
}

console.log('Test 1: stripTelegramHtml...');
const stripped = stripTelegramHtml(
    '<b>Cool</b> <code>0xabc</code> <a href="https://etherscan.io/tx/0x1">Tx</a>'
);
assert(stripped.includes('Cool'));
assert(stripped.includes('`0xabc`'));
assert(stripped.includes('Tx (https://etherscan.io/tx/0x1)'));
console.log('  ✅ strip');

console.log('Test 2: discord mirror gating...');
delete process.env.DISCORD_WEBHOOK_URL;
assert.strictEqual(isDiscordMirrorEnabled(), false);
process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
assert.strictEqual(isDiscordMirrorEnabled(), true);
process.env.DISCORD_MIRROR_ALERTS = 'false';
assert.strictEqual(isDiscordMirrorEnabled(), false);
restoreEnv();
console.log('  ✅ gating');

console.log('\n✅ All notification tests passed.\n');
