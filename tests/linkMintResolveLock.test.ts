/**
 * Run: npx tsx tests/linkMintResolveLock.test.ts
 */
import {
    contractKeyFromCandidate,
    inflightResolveKey,
    noteWebhookUpdate,
    releaseResolveLock,
    tryAcquireResolveLock,
} from '../src/services/linkMintResolveLock';

const addr = '0xdd37277a84A39fc037Ed54A59FbFF7ef4441fC6a';
const key = inflightResolveKey('123', contractKeyFromCandidate(addr));

const k1 = contractKeyFromCandidate(`https://etherscan.io/address/${addr}`);
if (k1 !== addr.toLowerCase()) throw new Error('contract key from etherscan url');

const a = tryAcquireResolveLock(key, 1);
if (!a.acquired) throw new Error('first acquire should succeed');

const b = tryAcquireResolveLock(key);
if (b.acquired) throw new Error('second acquire should fail');

releaseResolveLock(key);
if (tryAcquireResolveLock(key).acquired !== true) throw new Error('acquire after release');

releaseResolveLock(key);

if (noteWebhookUpdate(42) !== 'new') throw new Error('first update should be new');
if (noteWebhookUpdate(42) !== 'duplicate') throw new Error('same update_id should duplicate');

console.log('linkMintResolveLock.test.ts: ok');
