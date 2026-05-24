import { applyExecutionWalletCap } from '../src/utils/walletExecution';

function test(name: string, fn: () => void) {
    try {
        fn();
        console.log(`${name}: ok`);
    } catch (e) {
        console.error(`${name}: FAIL`, e);
        process.exitCode = 1;
    }
}

test('keeps all keys when under cap', () => {
    const keys = ['a', 'b', 'c'];
    const out = applyExecutionWalletCap(keys, 5, 1);
    if (out.length !== 3 || out.join() !== 'a,b,c') throw new Error('unexpected');
});

test('always includes imported trailing keys', () => {
    const keys = ['hd1', 'hd2', 'hd3', 'hd4', 'hd5', 'hd6', 'imp1', 'imp2'];
    const out = applyExecutionWalletCap(keys, 5, 6);
    if (out.length !== 5) throw new Error(`len ${out.length}`);
    if (!out.includes('imp1') || !out.includes('imp2')) throw new Error('missing imported');
    if (out.filter(k => k.startsWith('hd')).length !== 3) throw new Error('hd cap wrong');
});

test('naive slice would drop imported', () => {
    const keys = ['hd1', 'hd2', 'hd3', 'hd4', 'hd5', 'imp1'];
    const naive = keys.slice(0, 5);
    if (naive.includes('imp1')) throw new Error('test setup');
    const out = applyExecutionWalletCap(keys, 5, 5, 1);
    if (!out.includes('imp1')) throw new Error('imported must be kept');
});

test('hdWalletKeyCount when imported count is zero (understated)', () => {
    const keys = ['hd1', 'hd2', 'hd3', 'hd4', 'hd5', 'hd6', 'imp1'];
    const wrongImported = applyExecutionWalletCap(keys, 5, 0, 0);
    const withHd = applyExecutionWalletCap(keys, 5, 6);
    if (!withHd.includes('imp1')) throw new Error('hd count must keep trailing import');
    if (wrongImported.includes('imp1')) throw new Error('missing hd count must not keep import');
});

console.log('walletExecution tests done');
