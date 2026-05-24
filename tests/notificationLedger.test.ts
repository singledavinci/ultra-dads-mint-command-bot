/**
 * notificationLedger — concurrent claim must not spuriously reject automint path
 */

import assert from 'node:assert';
import { claimNotification } from '../src/services/notificationLedger.js';

console.log('Test: concurrent claims on different keys both succeed...');
{
    const tx = `0xtest${Date.now().toString(16)}`;
    const [a, b] = await Promise.all([
        claimNotification(`whale:automint:${tx}`, 'whale'),
        claimNotification(`whale:alert:${tx}`, 'whale'),
    ]);
    assert.strictEqual(a, true);
    assert.strictEqual(b, true);
    console.log('  OK');
}

console.log('Test: duplicate automint claim fails...');
{
    const tx = `0xdup${Date.now().toString(16)}`;
    assert.strictEqual(await claimNotification(`whale:automint:${tx}`, 'whale'), true);
    assert.strictEqual(await claimNotification(`whale:automint:${tx}`, 'whale'), false);
    console.log('  OK');
}

console.log('notificationLedger tests passed');
