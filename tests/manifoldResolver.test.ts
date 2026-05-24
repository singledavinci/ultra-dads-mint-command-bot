/**
 * Manifold slug HTML parsing (unit — no network)
 * Run: npx tsx tests/manifoldResolver.test.ts
 */

import assert from 'node:assert';
import { extractManifoldInstanceId, extractManifoldPageSlug } from '../src/services/manifoldResolver';
import { extractManifoldInstanceIdFromUrl } from '../src/services/manifoldStudioClient';

console.log('Test 1: extractManifoldPageSlug...');
assert.strictEqual(
    extractManifoldPageSlug('https://app.manifold.xyz/c/my-drop'),
    'my-drop'
);
assert.strictEqual(
    extractManifoldPageSlug('https://app.manifold.xyz/c/creator-name/my-drop'),
    'my-drop'
);
console.log('  ✅ slug extraction');

console.log('Test 2: __NEXT_DATA__ contract extraction (fixture)...');
const fixture = `
<script id="__NEXT_DATA__">{"props":{"pageProps":{"instance":{"contractAddress":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd","chain":"ethereum"}}}}</script>
`;
const match = fixture.match(/"contractAddress"\s*:\s*"(0x[a-fA-F0-9]{40})"/i);
assert(match);
assert.strictEqual(match![1].toLowerCase(), '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
console.log('  ✅ JSON contract pattern');

console.log('Test 3: extractManifoldInstanceId from __NEXT_DATA__...');
const html = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"instanceId":"4150231280"}}}</script>`;
assert.strictEqual(extractManifoldInstanceId(html), '4150231280');
console.log('  ✅ instanceId extraction');

console.log('Test 4: extractManifoldInstanceIdFromUrl (manifold.xyz /id/ links)...');
assert.strictEqual(
    extractManifoldInstanceIdFromUrl('https://manifold.xyz/@creator/id/4150231280'),
    '4150231280'
);
assert.strictEqual(
    extractManifoldInstanceIdFromUrl('https://app.manifold.xyz/c/foo?id=1'),
    null
);
console.log('  ✅ instance id from URL');

console.log('\n✅ All Manifold resolver tests passed.\n');
