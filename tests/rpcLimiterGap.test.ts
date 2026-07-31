import assert from 'node:assert';
import { getLinkMintRpcGapMs } from '../src/services/rpcLimiter';

const previousProvider = process.env.PROVIDER_URL;
const previousExecution = process.env.EXECUTION_RPC_URL;
const previousGap = process.env.LINK_MINT_RPC_GAP_MS;

delete process.env.LINK_MINT_RPC_GAP_MS;
delete process.env.EXECUTION_RPC_URL;
process.env.PROVIDER_URL = 'http://10.66.66.1:8545';
assert.strictEqual(getLinkMintRpcGapMs(), 0, 'dedicated node should not receive artificial delay');

process.env.PROVIDER_URL = 'https://ethereum.publicnode.com';
assert.strictEqual(getLinkMintRpcGapMs(), 220, 'external RPC keeps protective pacing');

process.env.LINK_MINT_RPC_GAP_MS = '15';
assert.strictEqual(getLinkMintRpcGapMs(), 15, 'explicit override remains authoritative');

if (previousProvider === undefined) delete process.env.PROVIDER_URL;
else process.env.PROVIDER_URL = previousProvider;
if (previousExecution === undefined) delete process.env.EXECUTION_RPC_URL;
else process.env.EXECUTION_RPC_URL = previousExecution;
if (previousGap === undefined) delete process.env.LINK_MINT_RPC_GAP_MS;
else process.env.LINK_MINT_RPC_GAP_MS = previousGap;

console.log('endpoint-aware RPC pacing OK');
