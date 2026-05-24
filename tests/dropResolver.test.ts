/**
 * dropResolver unit tests (offline — raw address / slug parsing only)
 */

import assert from 'node:assert';

console.log('Test: extractRawAddress via resolveDropTarget...');
{
    const { resolveDropTarget } = await import('../src/utils/dropResolver.js');
    const addr = '0xBC4CA0EdA7c7b6737507E031055fe88Fb0DCf42f';
    const drop = await resolveDropTarget(addr);
    assert(drop);
    assert.strictEqual(drop.contract, addr.toLowerCase());
    assert.strictEqual(drop.chainSlug, 'ethereum');
    console.log('  OK');
}

console.log('Test: etherscan URL resolves contract...');
{
    const { resolveDropTarget } = await import('../src/utils/dropResolver.js');
    const drop = await resolveDropTarget(
        'https://etherscan.io/token/0xBC4CA0EdA7c7b6737507E031055fe88Fb0DCf42f'
    );
    assert(drop);
    assert.strictEqual(drop.contract, '0xbc4ca0eda7c7b6737507e031055fe88fb0dcf42f');
    console.log('  OK');
}

console.log('All dropResolver tests passed.');
