import { parseNftTokenId } from '../src/utils/collectionSweep';

function test(name: string, fn: () => void) {
    try {
        fn();
        console.log(`${name}: ok`);
    } catch (e) {
        console.error(`${name}: FAIL`, e);
        process.exitCode = 1;
    }
}

test('parse decimal token id', () => {
    if (parseNftTokenId('42') !== 42n) throw new Error('decimal');
});

test('parse hex token id', () => {
    if (parseNftTokenId('0x2a') !== 42n) throw new Error('hex');
});

console.log('collectionSweep tests done');
