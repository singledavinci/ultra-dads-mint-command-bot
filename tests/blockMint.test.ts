import assert from 'node:assert/strict';
import { parseBlockTarget, OEGP_CONTRACT } from '../src/services/blockMintTargets';

assert.equal(parseBlockTarget('next', 100), 101);
assert.equal(parseBlockTarget('+3', 100), 103);
assert.equal(parseBlockTarget('25109000', 100), 25109000);
assert.equal(OEGP_CONTRACT.startsWith('0x460d7d'), true);
console.log('blockMint.test.ts: ok');
