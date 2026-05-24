/**
 * scheduledDropResolver unit tests
 */

import assert from 'node:assert';
import { detectMintTargetFromMessage } from '../src/services/linkMintService.js';
import { valueEthFromTarget, scheduledDropExecuteOptions } from '../src/services/scheduledDropResolver.js';
import type { ResolvedMintTarget } from '../src/services/linkMintService.js';

console.log('Test: detectMintTargetFromMessage for OpenSea URL...');
{
    const c = detectMintTargetFromMessage('https://opensea.io/collection/azuki');
    assert(c.length > 0);
    assert.strictEqual(c[0]!.type, 'opensea');
    console.log('  OK');
}

console.log('Test: detectMintTargetFromMessage for raw address...');
{
    const addr = '0xBC4CA0EdA7c7b6737507E031055fe88Fb0DCf42f';
    const c = detectMintTargetFromMessage(addr);
    assert(c.some(x => x.type === 'raw_address'));
    console.log('  OK');
}

console.log('Test: valueEthFromTarget prefers resolved when no hint flag...');
{
    const target = {
        suggestedValue: '80000000000000000',
    } as ResolvedMintTarget;
    assert.strictEqual(valueEthFromTarget(target, '0.01', false), '0.08');
    console.log('  OK');
}

console.log('Test: valueEthFromTarget uses hint when flag set...');
{
    const target = {
        suggestedValue: '80000000000000000',
    } as ResolvedMintTarget;
    assert.strictEqual(valueEthFromTarget(target, '0.05', true), '0.05');
    console.log('  OK');
}

console.log('Test: valueEthFromTarget zero hint uses resolved...');
{
    const target = {
        suggestedValue: '0',
    } as ResolvedMintTarget;
    assert.strictEqual(valueEthFromTarget(target, '0', true), '0.0');
    console.log('  OK');
}

console.log('Test: scheduledDropExecuteOptions respects fast simulation...');
{
    const prev = process.env.LINK_MINT_SIMULATION_MODE;
    process.env.LINK_MINT_SIMULATION_MODE = 'fast';
    const opts = scheduledDropExecuteOptions({
        contract: '0xabc',
        executionTo: '0xabc',
        data: '0x',
        valueEth: '0',
        label: 't',
        warnings: [],
    });
    assert.strictEqual(opts.skipSimulation, true);
    if (prev === undefined) delete process.env.LINK_MINT_SIMULATION_MODE;
    else process.env.LINK_MINT_SIMULATION_MODE = prev;
    console.log('  OK');
}

console.log('All scheduledDropResolver tests passed.');
