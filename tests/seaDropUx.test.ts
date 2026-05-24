/**
 * SeaDrop Telegram UX helpers (unit — no network)
 * Run: npx tsx tests/seaDropUx.test.ts
 */

import assert from 'node:assert';
import {
    buildSeaDropPublicStatus,
    classifySeaDropPublicPhase,
    formatSeaDropStatusTelegram,
    shouldBlockBatchMintForSeaDrop,
    seaDropInactiveBlocksLinkMint,
} from '../src/services/seaDropUx';
import type { SeaDropPublicDropInfo } from '../src/services/seaDropBuilder';

function mockDrop(overrides: Partial<SeaDropPublicDropInfo>): SeaDropPublicDropInfo {
    const now = Math.floor(Date.now() / 1000);
    return {
        router: '0x00005ea00ac477b1030ce78506496e8c2de24bf5',
        mintPrice: 0n,
        maxPerWallet: 10,
        startTime: now - 3600,
        endTime: 0,
        isActive: true,
        restrictFeeRecipients: false,
        ...overrides,
    };
}

console.log('Test 1: classify not_started...');
{
    const now = Math.floor(Date.now() / 1000);
    const drop = mockDrop({ startTime: now + 7200, isActive: false });
    assert.strictEqual(classifySeaDropPublicPhase(drop), 'not_started');
    console.log('  ✅ not_started');
}

console.log('Test 2: classify zero_wallet_limit...');
{
    const drop = mockDrop({ maxPerWallet: 0, isActive: false });
    assert.strictEqual(classifySeaDropPublicPhase(drop), 'zero_wallet_limit');
    console.log('  ✅ zero_wallet_limit');
}

console.log('Test 3: format message includes UTC window...');
{
    const now = Math.floor(Date.now() / 1000);
    const drop = mockDrop({ startTime: now + 100, endTime: now + 99999, isActive: false });
    const status = buildSeaDropPublicStatus(drop, true);
    const msg = formatSeaDropStatusTelegram(status, '0x1234567890123456789012345678901234567890');
    assert(msg.includes('UTC'));
    assert(msg.includes('OPENSEA_API_KEY'));
    console.log('  ✅ telegram format');
}

console.log('Test 4: batch block when public ended + detected path...');
{
    const blocked = shouldBlockBatchMintForSeaDrop({
        mintPath: 'detected',
        executionTo: '0x00005ea00ac477b1030ce78506496e8c2de24bf5',
        contractAddress: '0x1234567890123456789012345678901234567890',
        seaDropStatus: { publicPhase: 'ended', summary: 'x', blockedReason: 'ended' },
        paymentConfidence: 'low',
    });
    assert(blocked);
    console.log('  ✅ batch block ended');
}

console.log('Test 5: no batch block for direct_nft FCFS...');
{
    const blocked = shouldBlockBatchMintForSeaDrop({
        mintPath: 'direct_nft',
        executionTo: '0x1234567890123456789012345678901234567890',
        contractAddress: '0x1234567890123456789012345678901234567890',
        detectedSelector: '0xa0712d68',
        suggestedCalldata: '0xa0712d68',
        allowSimulationBypass: true,
        seaDropStatus: { publicPhase: 'zero_wallet_limit', summary: 'x', blockedReason: '0' },
    });
    assert(!blocked);
    console.log('  ✅ FCFS direct allowed');
}

console.log('Test 6: link mint block message for 0/wallet...');
{
    const err = seaDropInactiveBlocksLinkMint({
        mintPath: 'detected',
        executionTo: '0xrouter',
        contractAddress: '0x1234567890123456789012345678901234567890',
        seaDropStatus: {
            publicPhase: 'zero_wallet_limit',
            blockedReason: '0 per wallet',
        },
        paymentConfidence: 'low',
    });
    assert(err?.includes('0 per wallet'));
    console.log('  ✅ link block hint');
}

console.log('\n✅ All SeaDrop UX tests passed.\n');
