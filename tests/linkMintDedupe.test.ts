/**
 * Link mint dedupe — preview must not mark; execute marks
 * Run: npx tsx tests/linkMintDedupe.test.ts
 */
import assert from 'node:assert/strict';
import {
    clearLinkMintDedupe,
    linkMintDedupeKey,
    markLinkMintExecuted,
    shouldBlockLinkMintRetry,
} from '../src/services/linkMintDedupe';

const key = linkMintDedupeKey('0x75e43a3eee0c70cb04327dac42771156b4893b6d', '0x5b70ea9f');
clearLinkMintDedupe(key);

assert.equal(shouldBlockLinkMintRetry(key, 60_000), false);
markLinkMintExecuted(key);
assert.equal(shouldBlockLinkMintRetry(key, 60_000), true);
clearLinkMintDedupe(key);
assert.equal(shouldBlockLinkMintRetry(key, 60_000), false);
assert.equal(shouldBlockLinkMintRetry(key, 0), false);

console.log('linkMintDedupe.test.ts: ok');
