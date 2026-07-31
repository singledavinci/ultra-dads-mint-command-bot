/**
 * RPC endpoint resolution (tracker vs execution vs WS)
 */

import assert from 'node:assert';
import {
    getTrackerHttpUrl,
    resolveExecutionUrls,
    resolveTrackerHttpUrls,
    resolveTrackerWsUrl,
    toHttpRpcUrl,
} from '../src/config/rpcEndpoints.js';

const env = { ...process.env };

function restoreEnv() {
    process.env = { ...env };
}

console.log('Test 1: tracker HTTP prefers TRACKER_RPC_URL...');
process.env.TRACKER_RPC_URL = 'https://tracker.example/rpc';
process.env.PROVIDER_URL = 'https://main.example/rpc';
assert.deepStrictEqual(resolveTrackerHttpUrls(), ['https://tracker.example/rpc']);
restoreEnv();
console.log('  ✅ tracker HTTP');

console.log('Test 2: tracker WS prefers TRACKER_WS_RPC_URL...');
process.env.TRACKER_WS_RPC_URL = 'wss://tracker-ws.example/ws';
process.env.WS_RPC_URL = 'wss://main-ws.example/ws';
assert.strictEqual(resolveTrackerWsUrl(), 'wss://tracker-ws.example/ws');
restoreEnv();
console.log('  ✅ tracker WS');

console.log('Test 3: execution URLs merge EXECUTION + BACKUP...');
process.env.EXECUTION_RPC_URL = 'https://exec1.example';
process.env.BACKUP_RPC_URLS = 'https://exec2.example,https://exec3.example';
assert.deepStrictEqual(resolveExecutionUrls(), [
    'https://exec1.example',
    'https://exec2.example',
    'https://exec3.example',
]);
restoreEnv();
console.log('  ✅ execution URLs');

console.log('Test 4: wss → https for block polling...');
delete process.env.TRACKER_RPC_URL;
delete process.env.PROVIDER_URL;
delete process.env.TRACKER_WS_RPC_URL;
delete process.env.WS_RPC_URL;
assert.strictEqual(getTrackerHttpUrl(), null);
process.env.TRACKER_RPC_URL = 'wss://ankr.example/ws/key';
assert.strictEqual(toHttpRpcUrl('wss://ankr.example/ws/key'), 'https://ankr.example/ws/key');
assert.strictEqual(getTrackerHttpUrl(), 'https://ankr.example/ws/key');
restoreEnv();
console.log('  ✅ http conversion');

console.log('Test 5: blast URLs exclude Flashbots Protect...');
{
    const { isPrivateMempoolRpcUrl, resolveBlastRpcUrls } = await import(
        '../src/engine/inclusion/RawTxBlast.js'
    );
    assert.strictEqual(isPrivateMempoolRpcUrl('https://rpc.flashbots.net'), true);
    assert.strictEqual(isPrivateMempoolRpcUrl('https://rpc.flashbots.net/fast'), true);
    assert.strictEqual(isPrivateMempoolRpcUrl('https://ethereum.publicnode.com'), false);
    process.env.EXECUTION_RPC_URL = 'http://10.66.66.1:8545';
    process.env.BACKUP_RPC_URLS =
        'https://ethereum.publicnode.com,https://rpc.flashbots.net,https://1rpc.io/eth';
    process.env.PROVIDER_URL = 'http://10.66.66.1:8545';
    const urls = resolveBlastRpcUrls();
    assert(!urls.some(u => u.includes('flashbots')), 'protect excluded from blast');
    assert(urls.includes('http://10.66.66.1:8545'));
    assert(urls.includes('https://ethereum.publicnode.com'));
    restoreEnv();
    console.log('  ✅ protect filtered from Direct blast');
}

console.log('\n✅ All rpcEndpoints tests passed.\n');
