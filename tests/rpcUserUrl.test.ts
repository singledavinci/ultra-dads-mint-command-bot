import { normalizeUserRpcUrl, isHttpRpcUrl } from '../src/services/rpcUrlUtils.js';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

assert(normalizeUserRpcUrl('  https://x.com  ') === 'https://x.com', 'trim');
assert(
    normalizeUserRpcUrl('wss://eth-mainnet.g.alchemy.com/v2/key') ===
        'https://eth-mainnet.g.alchemy.com/v2/key',
    'wss→https'
);
assert(
    normalizeUserRpcUrl('ws://localhost:8545') === 'http://localhost:8545',
    'ws→http'
);
assert(isHttpRpcUrl('wss://x'), 'wss is http after normalize');
assert(!isHttpRpcUrl('ftp://x'), 'reject ftp');

console.log('rpcUserUrl.test.ts: ok');
