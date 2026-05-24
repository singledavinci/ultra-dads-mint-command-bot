/**
 * Discord broadcast — target parsing, truncation, parallel mock fetch
 */

import assert from 'node:assert';
import {
    parseDiscordBroadcastTargetsFromEnv,
    truncateDiscordContent,
    describeDiscordBroadcastTargets,
} from '../src/config/discordBroadcast.js';
import {
    broadcastToDiscordChannels,
    setDiscordBroadcastFetch,
    resetDiscordBroadcastFetch,
} from '../src/services/discordBroadcastService.js';
import type { DiscordBroadcastConfig } from '../src/config/discordBroadcast.js';

console.log('Test 1: parse JSON targets...');
const jsonTargets = parseDiscordBroadcastTargetsFromEnv(
    '[{"channelId":"123456789012345678","label":"A"},{"webhookUrl":"https://discord.com/api/webhooks/1/secret"}]'
);
assert.strictEqual(jsonTargets.length, 2);
assert.strictEqual(jsonTargets[0].label, 'A');
assert.ok(jsonTargets[1].webhookUrl?.includes('/webhooks/'));
console.log('  ✅ JSON');

console.log('Test 2: parse line targets...');
const lineTargets = parseDiscordBroadcastTargetsFromEnv(
    '123456789012345678|ServerA\n# comment\n987654321098765432'
);
assert.strictEqual(lineTargets.length, 2);
assert.strictEqual(lineTargets[0].label, 'ServerA');
console.log('  ✅ lines');

console.log('Test 3: truncateDiscordContent...');
const long = 'x'.repeat(2000);
const short = truncateDiscordContent(long);
assert.ok(short.length <= 1900);
assert.ok(short.endsWith('…'));
console.log('  ✅ truncate');

console.log('Test 4: describe targets (no secrets)...');
const desc = describeDiscordBroadcastTargets(jsonTargets);
assert.strictEqual(desc.total, 2);
assert.strictEqual(desc.channelCount, 1);
assert.strictEqual(desc.webhookCount, 1);
assert.ok(!JSON.stringify(desc).includes('secret'));
console.log('  ✅ describe');

const calls: string[] = [];
setDiscordBroadcastFetch(async (input, init) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify({ id: '1' }), { status: 200 });
});

const mockConfig: DiscordBroadcastConfig = {
    botToken: 'test-token',
    concurrency: 0,
    targets: [
        { channelId: '111111111111111111', label: 'one' },
        { channelId: '222222222222222222', label: 'two' },
        {
            webhookUrl: 'https://discord.com/api/webhooks/99/abc',
            label: 'wh',
        },
    ],
};

console.log('Test 5: parallel broadcast mock fetch...');
try {
    const result = await broadcastToDiscordChannels('Hello Discord', {
        skipDedupe: true,
        config: mockConfig,
    });
    assert.strictEqual(result.sent, 3);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(result.totalTargets, 3);
    assert.strictEqual(calls.length, 3);
    assert.ok(calls.some(u => u.includes('/channels/111')));
    assert.ok(calls.some(u => u.includes('/webhooks/99')));
    console.log('  ✅ parallel mock');
} finally {
    resetDiscordBroadcastFetch();
}

console.log('\n✅ All discord broadcast tests passed.\n');
