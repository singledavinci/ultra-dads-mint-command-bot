/**
 * dropMintScheduler unit tests
 */

import assert from 'node:assert';
import {
    parseDropMintTimeArg,
    pendingScheduledMints,
    DROP_MINT_CATCHUP_GRACE_MS,
} from '../src/utils/dropMintScheduleUtils.js';

console.log('Test: parseDropMintTimeArg now...');
{
    const t0 = 1_700_000_000_000;
    const r = parseDropMintTimeArg('now', t0);
    assert(typeof r === 'number');
    assert.strictEqual(r, t0 + 2000);
    console.log('  OK');
}

console.log('Test: parseDropMintTimeArg +5m...');
{
    const t0 = 1_700_000_000_000;
    const r = parseDropMintTimeArg('+5m', t0);
    assert(typeof r === 'number');
    assert.strictEqual(r, t0 + 5 * 60_000);
    console.log('  OK');
}

console.log('Test: parseDropMintTimeArg 14:30 UTC rollover...');
{
    const t0 = Date.UTC(2026, 0, 15, 15, 0, 0);
    const r = parseDropMintTimeArg('14:30', t0);
    assert(typeof r === 'number');
    const d = new Date(r as number);
    assert.strictEqual(d.getUTCHours(), 14);
    assert.strictEqual(d.getUTCMinutes(), 30);
    assert.strictEqual(d.getUTCDate(), 16);
    console.log('  OK');
}

console.log('Test: parseDropMintTimeArg invalid...');
{
    const r = parseDropMintTimeArg('bad');
    assert(typeof r === 'object' && r !== null && 'error' in r);
    console.log('  OK');
}

console.log('Test: pendingScheduledMints filters by user...');
{
    const scheduledMints = [
            {
                id: 'a',
                label: 'A',
                contract: '0x1',
                valueEth: '0',
                scheduledAt: Date.now() + 60_000,
                addedBy: 'user1',
            },
            {
                id: 'b',
                label: 'B',
                contract: '0x2',
                valueEth: '0',
                scheduledAt: Date.now() + 60_000,
                addedBy: 'user2',
            },
        ];
    const mine = pendingScheduledMints(scheduledMints, { userId: 'user1', adminUserId: 'admin' });
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0]!.id, 'a');
    const all = pendingScheduledMints(scheduledMints, { userId: 'admin', adminUserId: 'admin' });
    assert.strictEqual(all.length, 2);
    console.log('  OK');
}

console.log('Test: DROP_MINT_CATCHUP_GRACE_MS default...');
{
    assert(DROP_MINT_CATCHUP_GRACE_MS >= 60_000);
    console.log('  OK');
}

console.log('All dropMintScheduler tests passed.');
