/**
 * Phase 6 — Test: Execution result classification
 * Run: npx tsx tests/execution.test.ts
 */

import assert from 'node:assert';
import { classifyError } from '../src/types/execution';

console.log('Test 1: Error classification...');
{
    const cases: Array<{ input: string; expected: string }> = [
        { input: 'exceeded its compute units per second capacity', expected: 'rpc_rate_limit' },
        { input: 'HTTP 429 Too Many Requests', expected: 'rpc_rate_limit' },
        { input: 'insufficient funds for gas * price + value', expected: 'insufficient_funds' },
        { input: 'nonce too low', expected: 'nonce_too_low' },
        { input: 'replacement transaction underpriced', expected: 'underpriced' },
        { input: 'execution reverted: PayerNotAllowed()', expected: 'simulation_revert' },
        { input: 'missing revert data in call exception', expected: 'simulation_revert' },
        { input: 'Value 0.5 ETH exceeds Max Mint Limit of 0.1 ETH', expected: 'max_mint_exceeded' },
        { input: 'some random unknown error happened', expected: 'unknown' },
    ];

    for (const c of cases) {
        const result = classifyError(new Error(c.input));
        assert.strictEqual(result.failure, c.expected,
            `"${c.input.slice(0, 30)}..." → expected ${c.expected}, got ${result.failure}`);
    }
    console.log(`  ✅ All ${cases.length} error classifications correct`);
}

console.log('Test 2: classifyError handles non-Error inputs...');
{
    const r1 = classifyError('string error');
    assert(r1.failure === 'unknown', 'String input should classify as unknown');

    const r2 = classifyError({ message: 'nonce too low', code: 'NONCE_EXPIRED' });
    assert(r2.failure === 'nonce_too_low', 'Object with message should classify');

    const r3 = classifyError(null);
    assert(r3.failure === 'unknown', 'null should classify as unknown');
    console.log('  ✅ Non-Error inputs handled gracefully');
}

console.log('\n✅ All execution tests passed.\n');
