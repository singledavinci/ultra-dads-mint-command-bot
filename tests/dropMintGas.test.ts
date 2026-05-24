/**
 * dropMintGas unit tests
 */

import assert from 'node:assert';
import {
    defaultDropMintGasChoice,
    dropMintExecuteOptionsFromScheduled,
    formatGasChoiceLabel,
    gasChoiceFromTierReport,
    parseCustomGweiBribe,
    parseCustomTipEth,
    scheduledMintGasFields,
} from '../src/utils/dropMintGas.js';
import type { ScheduledMint } from '../src/bot/stateManager.js';

console.log('Test: parseCustomGweiBribe...');
{
    assert.deepStrictEqual(parseCustomGweiBribe('5'), { ok: true, value: '5' });
    assert.deepStrictEqual(parseCustomGweiBribe('12 gwei'), { ok: true, value: '12' });
    assert.strictEqual(parseCustomGweiBribe('-1').ok, false);
    console.log('  OK');
}

console.log('Test: parseCustomTipEth...');
{
    assert.deepStrictEqual(parseCustomTipEth('0.004'), { ok: true, value: '0.004' });
    assert.deepStrictEqual(parseCustomTipEth('0 ETH'), { ok: true, value: '0' });
    assert.strictEqual(parseCustomTipEth('x').ok, false);
    console.log('  OK');
}

console.log('Test: gasChoiceFromTierReport...');
{
    const report = JSON.stringify({
        tiers: [
            {
                id: 'fcfs_plus',
                gasBribeGwei: '8',
                priorityBoostEth: 0.004,
                overdrive: false,
                suggestedInclusionMode: 'builder_flashbots',
            },
        ],
    });
    const choice = gasChoiceFromTierReport('fcfs_plus', report);
    assert.ok(choice);
    assert.strictEqual(choice!.gasTierId, 'fcfs_plus');
    assert.strictEqual(choice!.gasBribeGwei, '8');
    assert.strictEqual(choice!.inclusionMode, 'builder_flashbots');
    console.log('  OK');
}

console.log('Test: scheduledMintGasFields round-trip...');
{
    const gas = defaultDropMintGasChoice();
    const fields = scheduledMintGasFields(gas);
    const sm = { id: 'x', label: 'L', contract: '0x1', valueEth: '0', scheduledAt: 0, addedBy: 'u', ...fields };
    assert.strictEqual(sm.gasTierId, gas.gasTierId);
    console.log('  OK');
}

console.log('Test: dropMintExecuteOptionsFromScheduled applies tip...');
{
    const resolved = {
        contract: '0xabc',
        executionTo: '0xabc',
        data: '0x',
        valueEth: '0.08',
        label: 'Test',
        warnings: [],
    };
    const sm: ScheduledMint = {
        id: 'dm_1',
        label: 'Test',
        contract: '0xabc',
        valueEth: '0.08',
        scheduledAt: Date.now(),
        addedBy: '1',
        gasTierId: 'fcfs_plus',
        gasBribeGwei: '8',
        priorityBoostEth: '0.004',
        inclusionMode: 'builder_flashbots',
    };
    const opts = dropMintExecuteOptionsFromScheduled(resolved, sm, {
        autoMintFromLinks: false,
        confirmationRequired: false,
        adminOnly: false,
        maxMintEth: 1,
        maxTotalBatchEth: 5,
        defaultQuantity: 1,
        simulationMode: 'fast',
        allowUnknownLinkMint: false,
        requireKnownSelector: false,
        dedupeTtlMs: 60_000,
        linkMintDedupeEnabled: true,
    });
    assert.strictEqual(opts.gasTierId, 'fcfs_plus');
    assert.strictEqual(opts.gasBribeGwei, '8');
    assert.ok(opts.builderTipWei && BigInt(opts.builderTipWei as string) > 0n);
    assert.strictEqual(opts.inclusionMode, 'builder_flashbots');
    console.log('  OK');
}

console.log('Test: formatGasChoiceLabel...');
{
    const label = formatGasChoiceLabel({ gasTierId: 'fcfs', gasBribeGwei: '3', priorityBoostEth: '0' });
    assert.ok(label.includes('fcfs'));
    console.log('  OK');
}

console.log('dropMintGas tests passed');
