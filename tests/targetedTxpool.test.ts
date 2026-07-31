import assert from 'node:assert';
import { collectTargetedTxpoolEntries } from '../src/utils/trackerCore';

const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const hash = `0x${'a'.repeat(64)}`;

const entries = collectTargetedTxpoolEntries(
    {
        pending: {
            '0x1': { hash, from: owner, to: other, input: '0x1249c58b', value: '0x0' },
            '0x2': { hash: `0x${'b'.repeat(64)}`, from: other, to: owner, input: '0x1249c58b' },
        },
        queued: {
            '0x1': { hash, from: owner, to: other, input: '0x1249c58b', value: '0x0' },
        },
    },
    owner
);

assert.strictEqual(entries.length, 1, 'owner filter and hash dedupe should leave one tx');
assert.strictEqual(entries[0].hash, hash);
console.log('targeted txpool collection OK');
