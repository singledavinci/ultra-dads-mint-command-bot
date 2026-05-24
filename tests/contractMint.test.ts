/**
 * Contract mint pipeline unit tests
 * Run: npx tsx tests/contractMint.test.ts
 */

import assert from 'node:assert';
import { id, Interface } from 'ethers';
import {
    classifyBySelector,
    classifyByAbiFunction,
    calldataContainsWhalePadded,
} from '../src/contractMint/MintFunctionClassifier.js';
import { parseMintLogs } from '../src/contractMint/mintLogParser.js';
import { normalizeContractMintInput, extractTxHash } from '../src/contractMint/inputNormalizer.js';
import { getContractMintConfig, resetContractMintConfigForTests } from '../src/contractMint/config.js';
import { shouldProcess, resetIdempotencyForTests } from '../src/contractMint/idempotency.js';
import { classifyCopiedReplayCandidate } from '../src/services/strategies/copiedReplayStrategy.js';

console.log('Test 1: allowlist selector unsupported...');
{
    const r = classifyBySelector('0x46332f08');
    assert(r);
    assert.strictEqual(r!.category, 'UNSUPPORTED');
    assert.strictEqual(r!.hasProofOrSignature, true);
    console.log('  OK');
}

console.log('Test 2: public mint selector supported...');
{
    const r = classifyBySelector('0xa0712d68');
    assert(r);
    assert.strictEqual(r!.category, 'SUPPORTED_PUBLIC_MINT');
    console.log('  OK');
}

console.log('Test 3: signed mint ABI name unsupported...');
{
    const r = classifyByAbiFunction('mintSigned', [
        { type: 'uint256', name: 'qty' },
        { type: 'bytes', name: 'sig' },
    ]);
    assert.strictEqual(r.category, 'UNSUPPORTED');
    console.log('  OK');
}

console.log('Test 4: ERC721 mint log parse...');
{
    const erc721 = new Interface([
        'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    ]);
    const encoded = erc721.encodeEventLog('Transfer', [
        '0x0000000000000000000000000000000000000000',
        '0x00000000000000000000000000000000000000aa',
        1n,
    ]);
    const logs = [
        {
            address: '0x1111111111111111111111111111111111111111',
            topics: encoded.topics as string[],
            data: encoded.data,
        },
    ] as any;
    const mints = parseMintLogs(logs);
    assert.strictEqual(mints.length, 1);
    assert.strictEqual(mints[0].tokenStandard, 'ERC721');
    console.log('  OK');
}

console.log('Test 5: duplicate idempotency...');
{
    resetIdempotencyForTests();
    const k = 'test:dup';
    assert.strictEqual(shouldProcess(k), true);
    assert.strictEqual(shouldProcess(k), false);
    console.log('  OK');
}

console.log('Test 6: simulation required default...');
{
    resetContractMintConfigForTests();
    process.env.SIMULATION_REQUIRED = 'true';
    process.env.UNSAFE_OVERRIDE_SIMULATION = 'false';
    const cfg = getContractMintConfig();
    assert.strictEqual(cfg.simulationRequired, true);
    assert.strictEqual(cfg.unsafeOverrideSimulation, false);
    console.log('  OK');
}

console.log('Test 7: free mint copied replay medium+...');
{
    const iface = new Interface(['function mint(uint256)']);
    const data = iface.encodeFunctionData('mint', [1n]);
    const intent = classifyCopiedReplayCandidate(
        {
            chainId: 1,
            sourceTxHash: '0xabc',
            sourceFrom: '0x1111111111111111111111111111111111111111',
            txTo: '0x2222222222222222222222222222222222222222',
            txData: data,
            txValueWei: '0',
            detectionSource: 'block',
            matchedReason: 'trackedFrom',
            receivedAt: Date.now(),
            classificationConfidence: 'high',
        },
        { chainId: 1, walletAddress: '0x3333333333333333333333333333333333333333' },
        { forceAutomint: true }
    );
    assert(intent);
    assert.strictEqual(intent!.canAutoExecute, true);
    console.log('  OK');
}

console.log('Test 8: input normalizer extracts tx...');
{
    const tx = extractTxHash('see https://etherscan.io/tx/0x' + 'a'.repeat(64));
    assert(tx);
    assert.strictEqual(tx!.length, 66);
    console.log('  OK');
}

console.log('\nAll contractMint tests passed\n');
