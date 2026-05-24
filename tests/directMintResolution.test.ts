/**
 * Direct NFT mint resolution helpers
 * Run: npx tsx tests/directMintResolution.test.ts
 */
import assert from 'node:assert/strict';
import { isDirectNftMintResolution } from '../src/services/linkMintService';
import type { ResolvedMintTarget } from '../src/services/linkMintService';

const base: ResolvedMintTarget = {
    input: '0x75e43',
    contractAddress: '0x75e43a3eee0c70cb04327dac42771156b4893b6d',
    executionTo: '0x75e43a3eee0c70cb04327dac42771156b4893b6d',
    chainSlug: 'ethereum',
    platform: 'raw_address',
    name: 'test',
    confidence: 'high',
    warnings: ['SeaDrop public mint allows 0 per wallet'],
    suggestedCalldata: '0x5b70ea9f',
    suggestedValue: '0',
    detectedSelector: '0x5b70ea9f',
    detectedFunctionName: 'freeMint()',
    requiresManualCalldata: false,
    paymentPrevalidated: false,
    paymentConfidence: 'low',
    mintPath: 'detected',
};

assert.equal(isDirectNftMintResolution(base), true);
assert.equal(
    isDirectNftMintResolution({ ...base, mintPath: undefined, detectedSelector: undefined }),
    true
);
assert.equal(
    isDirectNftMintResolution({
        ...base,
        suggestedCalldata: '0xa0712d6800000001',
        detectedSelector: '0xa0712d68',
        executionTo: '0x00005ea00ac477b1030ce78506496e8c2de24bf5',
    }),
    false
);

console.log('directMintResolution.test.ts: ok');
