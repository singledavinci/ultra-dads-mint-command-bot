/**
 * Whale alert formatting
 * Run: npx tsx tests/whaleAlert.test.ts
 */
import assert from 'node:assert';
import { formatWhaleAlertMessage } from '../src/services/whaleAlert';

console.log('Test 1: whale alert includes supply, tx, and links...');
{
    const text = formatWhaleAlertMessage({
        mint: {
            hash: '0x' + 'ab'.repeat(32),
            from: '0x1111111111111111111111111111111111111111',
            to: '0x2222222222222222222222222222222222222222',
            value: '1000000000000000000',
            data: '0x',
            timestamp: Date.now(),
            classificationConfidence: 'high',
            detectionPath: 'pending',
        },
        meta: { name: 'Cool Cats', symbol: 'CAT', totalSupply: '5000', maxSupply: '10000' },
    });
    assert(text.includes('5000 / 10000'), 'minted/max supply');
    assert(text.includes('etherscan.io/tx/'), 'tx link');
    assert(text.includes('Cool Cats'), 'collection name');
    assert(text.includes('Whale mint'), 'title');
    assert(text.includes('Supply'), 'supply row');
    console.log('  ✅ rich whale format');
}

console.log('\n✅ All whale alert tests passed.\n');
