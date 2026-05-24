/**
 * Broadcast audience resolution
 * Run: npx tsx tests/broadcast.test.ts
 */
import assert from 'node:assert';
import { resolveBroadcastAudience } from '../src/bot/broadcast';
import type { BotState } from '../src/bot/stateManager';

console.log('Test 1: unions userWallets + unlockedUsers...');
{
    const state = {
        unlockedUsers: ['111'],
        userWallets: { '111': 3, '222': 5, '333': 1 },
        chatMembers: ['444'],
    } as unknown as BotState;

    const audience = await resolveBroadcastAudience(state);
    assert(audience.userIds.includes('111'));
    assert(audience.userIds.includes('222'));
    assert(audience.userIds.includes('333'));
    assert(audience.userIds.includes('444'));
    assert.strictEqual(audience.counts.totalUsers, 4);
    console.log('  ✅ union includes wallet-only users');
}

console.log('Test 2: ignores group chat ids...');
{
    const state = {
        unlockedUsers: ['-100123'],
        userWallets: { '999': 1 },
    } as unknown as BotState;
    const audience = await resolveBroadcastAudience(state);
    assert(!audience.userIds.includes('-100123'));
    assert(audience.userIds.includes('999'));
    console.log('  ✅ negative chat ids filtered');
}

console.log('\n✅ All broadcast tests passed.\n');
