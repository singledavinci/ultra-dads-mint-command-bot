import assert from 'node:assert';
import { contractPlanToMintIntent } from '../src/contractMint/copyMintIntentMap.js';
import type { ContractMintPlan } from '../src/contractMint/types.js';

console.log('Test 1: contractPlanToMintIntent maps SeaDrop...');
{
    const plan: ContractMintPlan = {
        chainId: 1,
        tokenContract: '0x1111111111111111111111111111111111111111',
        executionTarget: '0x2222222222222222222222222222222222222222',
        mintType: 'free',
        tokenStandard: 'ERC721',
        functionName: 'mintPublic',
        selector: '0x12345678',
        quantity: 1,
        value: '0x0',
        calldata: '0x12345678',
        confidence: 'high',
        reason: 'SeaDrop public',
        simulationStatus: 'passed',
        executable: true,
        category: 'SUPPORTED_SEADROP_PUBLIC',
    };
    const intent = contractPlanToMintIntent(plan, {
        hash: '0x' + 'a'.repeat(64),
        from: '0x3333333333333333333333333333333333333333',
    }, 1);
    assert.strictEqual(intent.routeType, 'seadrop_public');
    assert.strictEqual(intent.canAutoExecute, true);
    console.log('  OK');
}

console.log('Test 2: SeaDrop allowlist plan maps to seadrop_allowlist...');
{
    const plan: ContractMintPlan = {
        chainId: 1,
        tokenContract: '0x1111111111111111111111111111111111111111',
        executionTarget: '0x0000000000664ceffed39244a8312556a900b938',
        mintType: 'free',
        tokenStandard: 'ERC721',
        functionName: 'seadrop_allowlist',
        selector: '0x46332f08',
        quantity: 1,
        value: '0x0',
        calldata: '0x46332f08',
        confidence: 'high',
        reason: 'GTD',
        simulationStatus: 'skipped',
        executable: true,
        category: 'SUPPORTED_SEADROP_ALLOWLIST',
    };
    const intent = contractPlanToMintIntent(plan, {
        hash: '0x' + 'c'.repeat(64),
        from: '0x3333333333333333333333333333333333333333',
    }, 1);
    assert.strictEqual(intent.routeType, 'seadrop_allowlist');
    assert.strictEqual(intent.canAutoExecute, true);
    assert.strictEqual(intent.requiresProof, true);
    console.log('  OK');
}

console.log('Test 3: non-executable plan blocks auto execute...');
{
    const plan: ContractMintPlan = {
        chainId: 1,
        tokenContract: '0x1111111111111111111111111111111111111111',
        executionTarget: '0x1111111111111111111111111111111111111111',
        mintType: 'unknown',
        tokenStandard: 'unknown',
        functionName: 'allowlistMint',
        selector: '0x46332f08',
        quantity: 1,
        value: '0x0',
        calldata: '0x46332f08',
        confidence: 'low',
        reason: 'proof required',
        simulationStatus: 'not_run',
        executable: false,
        category: 'UNSUPPORTED',
        skipReason: 'skipped: allowlist proof required',
    };
    const intent = contractPlanToMintIntent(plan, {
        hash: '0x' + 'b'.repeat(64),
        from: '0x3333333333333333333333333333333333333333',
    }, 1);
    assert.strictEqual(intent.canAutoExecute, false);
    assert(intent.reason.includes('allowlist'));
    console.log('  OK');
}

console.log('\nAll copyMintBridge tests passed\n');