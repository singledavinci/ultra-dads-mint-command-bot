/**
 * Security helpers and policies
 * Run: npx tsx tests/security.test.ts
 */

import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiPathRequiresAuth, safeCompare } from '../src/utils/apiAuth';
import { getReservoirApiKey, reservoirRequestHeaders } from '../src/config/reservoir';

console.log('Test 1: safeCompare rejects empty and mismatched lengths...');
assert.strictEqual(safeCompare('', 'secret'), false);
assert.strictEqual(safeCompare('a', 'ab'), false);
assert.strictEqual(safeCompare('same-value', 'same-value'), true);
assert.strictEqual(safeCompare('wrong', 'same-value'), false);
console.log('  ✅ safeCompare');

console.log('Test 2: apiPathRequiresAuth scopes sensitive GETs...');
assert.strictEqual(apiPathRequiresAuth('GET', '/status'), false);
assert.strictEqual(apiPathRequiresAuth('GET', '/mints'), false);
assert.strictEqual(apiPathRequiresAuth('GET', '/debug/tracker'), true);
assert.strictEqual(apiPathRequiresAuth('GET', '/engine/config'), true);
assert.strictEqual(apiPathRequiresAuth('POST', '/status'), true);
console.log('  ✅ apiPathRequiresAuth');

console.log('Test 3: no hardcoded demo-api-key in source...');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanDirs = ['src'];
let foundDemo = false;
for (const dir of scanDirs) {
    const base = path.join(root, dir);
    const walk = (p: string) => {
        for (const ent of readdirSync(p, { withFileTypes: true })) {
            const full = path.join(p, ent.name);
            if (ent.isDirectory()) walk(full);
            else if (ent.name.endsWith('.ts') || ent.name.endsWith('.js')) {
                const text = readFileSync(full, 'utf8');
                if (text.includes('demo-api-key')) foundDemo = true;
            }
        }
    };
    walk(base);
}
assert.strictEqual(foundDemo, false, 'demo-api-key must not appear in src/tests');
console.log('  ✅ no demo-api-key in codebase');

console.log('Test 4: Reservoir headers only when key set...');
const prev = process.env.RESERVOIR_API_KEY;
delete process.env.RESERVOIR_API_KEY;
assert.strictEqual(getReservoirApiKey(), undefined);
assert.strictEqual(reservoirRequestHeaders(), undefined);
process.env.RESERVOIR_API_KEY = 'test-key-only';
assert.strictEqual(getReservoirApiKey(), 'test-key-only');
assert.deepStrictEqual(reservoirRequestHeaders(), { 'x-api-key': 'test-key-only' });
if (prev) process.env.RESERVOIR_API_KEY = prev;
else delete process.env.RESERVOIR_API_KEY;
console.log('  ✅ Reservoir env policy');

console.log('\n✅ All security tests passed.\n');
