/**
 * Link mint resolution + error hints
 * Run: npx tsx tests/linkMint.test.ts
 */

import assert from 'node:assert';
import {
    findCachedByContract,
    getCachedSimulation,
    setCachedSimulation,
} from '../src/services/simulationCache';
import {
    formatLinkMintFailureHint,
    isSeaDropMintFailureMessage,
    isSimulationFailureMessage,
} from '../src/utils/linkMintErrors';

const CONTRACT = '0x839c86d5357de31189d334b9f0ecd83872db11e95';
const DATA =
    '0xa0712d68' +
    '0000000000000000000000000000000000000000000000000000000000000001';

console.log('Test 1: findCachedByContract returns latest sim for contract...');
{
    setCachedSimulation(CONTRACT, DATA, {
        selector: '0xa0712d68',
        data: DATA,
        value: '0x38d7ea4c68000',
        quantity: 1,
    });
    const hit = findCachedByContract(CONTRACT);
    assert(hit, 'expected cache hit');
    assert.strictEqual(hit!.selector, '0xa0712d68');
    assert.strictEqual(hit!.value, '0x38d7ea4c68000');
    assert(getCachedSimulation(CONTRACT, DATA), 'exact key lookup still works');
    console.log('  ✅ Contract-level cache lookup works');
}

console.log('Test 2: simulation failure hints...');
{
    assert(isSimulationFailureMessage('All simulations failed — mint may be private'));
    const hint = formatLinkMintFailureHint('All simulations failed');
    assert(hint.includes('/custommint'), 'hint mentions /custommint');
    assert(hint.includes('/forcesim'), 'hint mentions /forcesim');
    assert(isSeaDropMintFailureMessage('SeaDrop public phase has ended'));
    const seaHint = formatLinkMintFailureHint('skipped: SeaDrop drop inactive');
    assert(seaHint.includes('OPENSEA_API_KEY'), 'SeaDrop hint mentions OpenSea key');
    console.log('  ✅ Actionable hints present');
}

console.log('\n✅ All link mint tests passed.\n');
