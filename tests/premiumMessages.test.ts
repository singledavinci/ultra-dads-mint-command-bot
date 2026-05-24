import assert from 'node:assert/strict';
import {
    formatMintExecutionSummary,
    shortenAddress,
    uiScreen,
} from '../src/bot/ui/premiumMessages';

console.log('premiumMessages: uiScreen...');
{
    const s = uiScreen({ title: 'Test', body: 'Body', footer: 'Foot' });
    assert(s.includes('<b>Test</b>'));
    assert(s.includes('Body'));
    assert(s.includes('Foot'));
}

console.log('premiumMessages: mint summary...');
{
    const s = formatMintExecutionSummary({
        title: '✓ <b>Done</b>',
        successCount: 8,
        failCount: 2,
        pendingCount: 1,
        walletTotal: 10,
    });
    assert(s.includes('8'));
    assert(s.includes('2'));
    assert(s.includes('pending'));
}

console.log('premiumMessages: shortenAddress...');
assert.ok(shortenAddress('0x1234567890123456789012345678901234567890').length < 20);

console.log('premiumMessages.test.ts: ok');
