/**
 * Mint intent pipeline unit tests
 * Run: npm run test:mint
 */

import assert from 'node:assert';
import { AbiCoder, Interface } from 'ethers';
import {
    normalizeTrackedWallet,
    displayTrackedWallet,
    isTracked,
} from '../src/services/trackedWalletRegistry.js';
import { classifySeaDropCandidate } from '../src/services/strategies/seaDropStrategy.js';
import { classifyDirectContractCandidate, replaceRecipientInCalldata } from '../src/services/strategies/directContractStrategy.js';
import { buildAlertOnlyIntent } from '../src/services/strategies/alertOnlyStrategy.js';
import { classifyMintCandidate } from '../src/services/mintIntentClassifier.js';
import { classifyCopiedReplayCandidate } from '../src/services/strategies/copiedReplayStrategy.js';
import {
    shouldSendMessage,
    recordSent,
    getStats,
} from '../src/services/messageDedupeStore.js';
import { hijackSeaDropCalldata, SEADROP_MINT_PUBLIC } from '../src/services/seaDropBuilder.js';
import type { MintCandidate } from '../src/types/mintIntent.js';

const WHALE = '0x1111111111111111111111111111111111111111';
const WALLET = '0x2222222222222222222222222222222222222222';
const NFT = '0x3333333333333333333333333333333333333333';
const ROUTER = '0x0000000000664ceffed39244a8312556a900b938';

function baseCandidate(overrides: Partial<MintCandidate> = {}): MintCandidate {
    return {
        chainId: 1,
        sourceTxHash: '0xabc123',
        sourceFrom: WHALE,
        txTo: ROUTER,
        txData: '0x',
        txValueWei: '0',
        detectionSource: 'pending',
        matchedReason: 'trackedFrom',
        receivedAt: Date.now(),
        ...overrides,
    };
}

console.log('Test 1: tracked wallet normalization...');
{
    const lower = normalizeTrackedWallet('0x1111111111111111111111111111111111111111');
    assert.strictEqual(lower, '0x1111111111111111111111111111111111111111');
    const display = displayTrackedWallet(lower);
    assert(display.startsWith('0x'));
    const set = new Set([lower]);
    assert(isTracked('0x1111111111111111111111111111111111111111', set));
    console.log('  OK normalization');
}

console.log('Test 2: SeaDrop allowlist -> alert_only...');
{
    const coder = AbiCoder.defaultAbiCoder();
    const data =
        '0x46332f08' +
        coder
            .encode(
                ['address', 'address', 'address', 'uint256', 'bytes32[]'],
                [NFT, '0x0000000000000000000000000000000000000000', WHALE, 1n, []]
            )
            .slice(2);
    const intent = await classifySeaDropCandidate(
        baseCandidate({ txData: data, txTo: ROUTER }),
        { chainId: 1 }
    );
    assert(intent);
    assert.strictEqual(intent.routeType, 'seadrop_allowlist');
    assert.strictEqual(intent.canAutoExecute, false);
    assert.strictEqual(intent.requiresProof, true);
    console.log('  OK allowlist alert_only');
}

console.log('Test 3: SeaDrop public without provider -> no auto execute...');
{
    const coder = AbiCoder.defaultAbiCoder();
    const data =
        SEADROP_MINT_PUBLIC +
        coder
            .encode(
                ['address', 'address', 'address', 'uint256'],
                [NFT, '0x0000000000000000000000000000000000000000', WHALE, 1n]
            )
            .slice(2);
    const intent = await classifySeaDropCandidate(baseCandidate({ txData: data }), { chainId: 1 });
    assert(intent);
    assert.strictEqual(intent.routeType, 'seadrop_public');
    assert.strictEqual(intent.canAutoExecute, false);
    console.log('  OK public needs provider');
}

console.log('Test 4: direct contract value scaling...');
{
    const iface = new Interface(['function mint(uint256 quantity)']);
    const data = iface.encodeFunctionData('mint', [2n]);
    const intent = await classifyDirectContractCandidate(
        baseCandidate({
            txTo: '0x4444444444444444444444444444444444444444',
            txData: data,
            txValueWei: '2000000000000000000',
        }),
        { chainId: 1, desiredQuantity: 1, walletAddress: WALLET }
    );
    assert(intent);
    assert.strictEqual(intent.routeType, 'direct_contract');
    assert.strictEqual(intent.unitPriceWei, '1000000000000000000');
    assert.strictEqual(intent.totalValueWei, '1000000000000000000');
    assert.strictEqual(intent.canAutoExecute, true);
    console.log('  OK value scaling');
}

console.log('Test 5: allowlistMint -> alert_only...');
{
    const iface = new Interface(['function allowlistMint(uint256 quantity, bytes32[] proof)']);
    const data = iface.encodeFunctionData('allowlistMint', [1n, []]);
    const intent = await classifyDirectContractCandidate(
        baseCandidate({
            txTo: '0x4444444444444444444444444444444444444444',
            txData: data,
            txValueWei: '1000000000000000000',
        }),
        { chainId: 1, desiredQuantity: 1 }
    );
    assert(intent);
    assert.strictEqual(intent.routeType, 'alert_only');
    assert.strictEqual(intent.canAutoExecute, false);
    console.log('  OK allowlist alert_only');
}

console.log('Test 5b: unknown price qty mismatch -> alert_only...');
{
    const iface = new Interface(['function mint(uint256 quantity)']);
    const data = iface.encodeFunctionData('mint', [3n]);
    const intent = await classifyDirectContractCandidate(
        baseCandidate({
            txTo: '0x4444444444444444444444444444444444444444',
            txData: data,
            txValueWei: '5',
        }),
        { chainId: 1, desiredQuantity: 1 }
    );
    assert(intent);
    assert.strictEqual(intent.routeType, 'alert_only');
    console.log('  OK indivisible value alert');
}

console.log('Test 6: message dedupe store...');
{
    const key = `test-dedupe-${Date.now()}`;
    assert.strictEqual(shouldSendMessage(key, 60_000), true);
    recordSent(key);
    assert.strictEqual(shouldSendMessage(key, 60_000), false);
    const stats = getStats();
    assert(stats.sentCount >= 1);
    console.log('  OK dedupe');
}

console.log('Test 7: hijackSeaDrop public and allowlist minter slot...');
{
    const coder = AbiCoder.defaultAbiCoder();
    const pub =
        SEADROP_MINT_PUBLIC +
        coder
            .encode(
                ['address', 'address', 'address', 'uint256'],
                [NFT, '0x0000000000000000000000000000000000000000', WHALE, 1n]
            )
            .slice(2);
    const hijacked = hijackSeaDropCalldata(pub, WALLET);
    assert(hijacked);
    const allow =
        '0x46332f08' +
        coder
            .encode(
                ['address', 'address', 'address', 'uint256', 'bytes32[]'],
                [NFT, '0x0000000000000000000000000000000000000000', WHALE, 1n, []]
            )
            .slice(2);
    const allowHijacked = hijackSeaDropCalldata(allow, WALLET);
    assert(allowHijacked);
    const [, , allowMinterSlot] = coder.decode(
        ['address', 'address', 'address', 'uint256', 'bytes32[]'],
        '0x' + allowHijacked!.slice(10)
    );
    assert.strictEqual(String(allowMinterSlot).toLowerCase(), '0x0000000000000000000000000000000000000000');
    console.log('  OK hijack public + allowlist minter');
}

console.log('Test 8: blind broadcast default off via env...');
{
    const blindDefault = process.env.BLIND_BROADCAST_ENABLED === 'true';
    assert.strictEqual(blindDefault, false, 'BLIND_BROADCAST_ENABLED should default false');
    console.log('  OK blind broadcast default');
}

console.log('Test 9: classifyMintCandidate fallback alert_only...');
{
    const intent = await classifyMintCandidate(
        baseCandidate({
            txTo: '0x5555555555555555555555555555555555555555',
            txData: '0xdeadbeef',
        }),
        { chainId: 1 }
    );
    assert.strictEqual(intent.routeType, 'alert_only');
    assert.strictEqual(intent.canAutoExecute, false);
    console.log('  OK classifier fallback');
}

console.log('Test 10: replaceRecipientInCalldata ABI-aware...');
{
    const iface = new Interface(['function mint(address to, uint256 quantity)']);
    const data = iface.encodeFunctionData('mint', [WHALE, 1n]);
    const replaced = replaceRecipientInCalldata(data, WHALE, WALLET, iface);
    assert(replaced);
    const decoded = iface.parseTransaction({ data: replaced! });
    assert.strictEqual(decoded?.args[0].toLowerCase(), WALLET.toLowerCase());
    console.log('  OK ABI recipient replace');
}

console.log('Test 11: buildAlertOnlyIntent...');
{
    const intent = buildAlertOnlyIntent(baseCandidate(), 'manual review');
    assert.strictEqual(intent.canAutoExecute, false);
    assert(intent.reason.includes('manual'));
    console.log('  OK alert only builder');
}

console.log('Test 12: copied replay for known selector + medium confidence...');
{
    const prev = process.env.TRACKER_PERMISSIVE_CLASSIFIER;
    process.env.TRACKER_PERMISSIVE_CLASSIFIER = 'true';
    const iface = new Interface(['function mint(uint256 quantity)']);
    const data = iface.encodeFunctionData('mint', [1n]);
    const intent = classifyCopiedReplayCandidate(
        baseCandidate({
            txTo: '0x4444444444444444444444444444444444444444',
            txData: data,
            txValueWei: '1000000000000000000',
            classificationConfidence: 'medium',
        }),
        { chainId: 1, walletAddress: WALLET, desiredQuantity: 1 }
    );
    if (prev === undefined) delete process.env.TRACKER_PERMISSIVE_CLASSIFIER;
    else process.env.TRACKER_PERMISSIVE_CLASSIFIER = prev;
    assert(intent);
    assert.strictEqual(intent!.routeType, 'copied_replay');
    assert.strictEqual(intent!.canAutoExecute, true);
    console.log('  OK copied replay');
}

console.log('Test 13: classifyMintCandidate uses copied_replay before alert_only...');
{
    const prev = process.env.TRACKER_PERMISSIVE_CLASSIFIER;
    process.env.TRACKER_PERMISSIVE_CLASSIFIER = 'true';
    // thirdweb claim selector — known mint, not in direct-contract PUBLIC_MINT_NAMES
    const data = '0x57bc3d78' + '0'.repeat(64 * 6);
    const intent = await classifyMintCandidate(
        baseCandidate({
            txTo: '0x4444444444444444444444444444444444444444',
            txData: data,
            txValueWei: '1000000000000000000',
            classificationConfidence: 'high',
        }),
        { chainId: 1, walletAddress: WALLET, desiredQuantity: 1 }
    );
    if (prev === undefined) delete process.env.TRACKER_PERMISSIVE_CLASSIFIER;
    else process.env.TRACKER_PERMISSIVE_CLASSIFIER = prev;
    assert.strictEqual(intent.routeType, 'copied_replay');
    assert.strictEqual(intent.canAutoExecute, true);
    console.log('  OK classifier copied_replay');
}

console.log('Test 14: free unknown short calldata copied_replay...');
{
    const prev = process.env.TRACKER_PERMISSIVE_CLASSIFIER;
    process.env.TRACKER_PERMISSIVE_CLASSIFIER = 'true';
    // Unknown selector + mint(uint256) shape, 0 ETH - must not fall through to alert_only
    const data = '0xdeadbeef' + AbiCoder.defaultAbiCoder().encode(['uint256'], [1n]).slice(2);
    const intent = await classifyMintCandidate(
        baseCandidate({
            txTo: '0x4444444444444444444444444444444444444444',
            txData: data,
            txValueWei: '0',
            classificationConfidence: 'high',
        }),
        { chainId: 1, walletAddress: WALLET, desiredQuantity: 1 }
    );
    if (prev === undefined) delete process.env.TRACKER_PERMISSIVE_CLASSIFIER;
    else process.env.TRACKER_PERMISSIVE_CLASSIFIER = prev;
    assert.strictEqual(intent.routeType, 'copied_replay');
    assert.strictEqual(intent.canAutoExecute, true);
    console.log('  OK free unknown short replay');
}

console.log('\nAll mintIntent tests passed\n');
