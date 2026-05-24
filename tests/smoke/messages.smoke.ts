/**
 * Notification + dedupe smoke
 * Run: npm run smoke:messages
 */

import assert from 'node:assert';
import {
    configureNotificationSenders,
    notifyCopyDetected,
    getNotificationDedupeStats,
} from '../../src/services/notificationService.js';
import { shouldSendMessage, recordSent } from '../../src/services/messageDedupeStore.js';

const LIVE = process.env.LIVE_BROADCAST === 'true';
console.log(`[smoke:messages] LIVE_BROADCAST=${LIVE}`);

let sent = 0;
configureNotificationSenders({ telegram: async () => { sent++; } });

const key = `smoke-msg-${Date.now()}`;
assert(shouldSendMessage(key, 30_000));
recordSent(key);
assert(!shouldSendMessage(key, 30_000));

if (LIVE) {
    await notifyCopyDetected({
        txHash: '0x' + 'b'.repeat(64),
        whale: '0x1111111111111111111111111111111111111111',
        contract: '0x2222222222222222222222222222222222222222',
        routeType: 'seadrop_public',
        chatId: process.env.GROUP_ID,
    });
    assert(sent >= 1);
} else {
    const prevGroup = process.env.GROUP_ID;
    const prevPersonal = process.env.PERSONAL_ID;
    process.env.GROUP_ID = '';
    process.env.PERSONAL_ID = '';
    const ok = await notifyCopyDetected({
        txHash: '0x' + 'd'.repeat(64),
        whale: '0x1111111111111111111111111111111111111111',
        contract: '0x2222222222222222222222222222222222222222',
        routeType: 'alert_only',
    });
    if (prevGroup !== undefined) process.env.GROUP_ID = prevGroup;
    else delete process.env.GROUP_ID;
    if (prevPersonal !== undefined) process.env.PERSONAL_ID = prevPersonal;
    else delete process.env.PERSONAL_ID;
    assert.strictEqual(ok, false);
    assert.strictEqual(sent, 0);
}

const stats = getNotificationDedupeStats();
assert(stats.activeKeys >= 0);
console.log('\n smoke:messages passed\n');
