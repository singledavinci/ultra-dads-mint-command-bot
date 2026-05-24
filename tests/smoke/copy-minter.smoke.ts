/**
 * Copy-minter smoke - no live broadcast unless LIVE_BROADCAST=true
 */
import assert from 'node:assert';
import { classifyMintCandidate, mintCandidateFromDetectedMint } from '../../src/services/mintIntentClassifier.js';
import type { DetectedMint } from '../../src/utils/trackerCore.js';

const LIVE = process.env.LIVE_BROADCAST === 'true';
console.log('[smoke:copy-minter] LIVE_BROADCAST=' + LIVE);

const mint: DetectedMint = {
    hash: '0x' + 'a'.repeat(64),
    from: '0x1111111111111111111111111111111111111111',
    to: '0x4444444444444444444444444444444444444444',
    value: '1000000000000000000',
    data: '0x1249c58b',
    timestamp: Date.now(),
    classificationConfidence: 'high',
    detectionPath: 'pending',
};

const candidate = mintCandidateFromDetectedMint(mint, 1);
assert.strictEqual(candidate.detectionSource, 'pending');
const intent = await classifyMintCandidate(candidate, { chainId: 1, desiredQuantity: 1 });
assert(intent);
console.log('  route=' + intent.routeType + ' canAuto=' + intent.canAutoExecute);
if (!LIVE) console.log('  dry-run only (no broadcast)');
console.log('\n smoke:copy-minter passed\n');