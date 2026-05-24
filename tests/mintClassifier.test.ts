/**
 * Mint classifier + confidence helpers
 * Run: npx tsx tests/mintClassifier.test.ts
 */

import assert from 'node:assert';
import {
    classifyMintTransaction,
    classifyTrackedWalletTx,
    confidenceMeetsMinimum,
    isKnownMintSelector,
} from '../src/services/mintClassifier';

console.log('Test 1: confidenceMeetsMinimum...');
{
    assert(confidenceMeetsMinimum('high', 'medium'));
    assert(confidenceMeetsMinimum('medium', 'medium'));
    assert(!confidenceMeetsMinimum('low', 'medium'));
    console.log('  ✅ confidenceMeetsMinimum works');
}

console.log('Test 2: Multicall selector rejected as non-mint...');
{
    const r = classifyMintTransaction(
        '0xac9650d800000000000000000000000000000000000000000000000000000000',
        '1000000000000000',
        null,
        false
    );
    assert(!r.isMint);
    console.log('  ✅ multicall rejected');
}

console.log('Test 3: Known SeaDrop selector high confidence...');
{
    const data =
        '0x510619880000000000000000000000001111111111111111111111111111111111111111' +
        '000000000000000000000000222222222222222222222222222222222222222222' +
        '000000000000000000000000333333333333333333333333333333333333333333' +
        '000000000000000000000000000000000000000000000000000000000000000001';
    const r = classifyMintTransaction(data, '0', null, false);
    assert(r.isMint && r.confidence === 'high');
    assert(isKnownMintSelector('0x51061988'));
    console.log('  ✅ SeaDrop public classified');
}

console.log('Test 4: Odd-length short calldata with ETH not mint...');
{
    const r = classifyMintTransaction('0xdeadbeef12', '1000000000000000', null, false);
    assert(!r.isMint);
    console.log('  ✅ odd tail rejected');
}

console.log('Test 5: Free allowlist mint (0 ETH, long calldata) accepted for tracked wallet...');
{
    const longAllowlist =
        '0xaabbccdd0000000000000000000000000000000000000000000000000000000000000001' +
        '0000000000000000000000000000000000000000000000000000000000000040' +
        '0000000000000000000000000000000000000000000000000000000000000002' +
        'c000000000000000000000000000000000000000000000000000000000000000' +
        '0000000000000000000000000000000000000000000000000000000000000040';
    const strict = classifyMintTransaction(longAllowlist, '0', null, false);
    const permissive = classifyTrackedWalletTx(longAllowlist, '0', '0xcontract');
    assert(!strict.isMint, 'strict classifier should reject unknown free mint');
    assert(permissive.isMint && permissive.confidence === 'medium', 'permissive should accept');
    console.log('  ✅ permissive tracked-wallet classifier works');
}

console.log('Test 6: OEGP freePlanting() selector-only...');
{
    const r = classifyMintTransaction('0x4d7cc1ec', '0', null, false);
    assert(r.isMint && r.confidence === 'high');
    assert(isKnownMintSelector('0x4d7cc1ec'));
    console.log('  ✅ freePlanting classified');
}

console.log('Test 7: NFT setApprovalForAll rejected...');
{
    const data =
        '0xa22cb46500000000000000000000000operator0000000000000000000000000000000001' +
        '0000000000000000000000000000000000000000000000000000000000000001';
    const strict = classifyMintTransaction(data, '0', null, false);
    const tracked = classifyTrackedWalletTx(data, '0', '0xcontract');
    assert(!strict.isMint && !tracked.isMint);
    console.log('  ✅ setApprovalForAll rejected');
}

console.log('Test 8: Seaport fulfillBasicOrder_efficient rejected...');
{
    const data =
        '0x87201b410000000000000000000000000000000000000000000000000000000000000020' +
        '0000000000000000000000000000000000000000000000000000000000000040' +
        '0000000000000000000000000000000000000000000000000000000000000080' +
        '00000000000000000000000000000000000000000000000000000000000000c0';
    const strict = classifyMintTransaction(data, '1000000000000000', null, false);
    const tracked = classifyTrackedWalletTx(data, '1000000000000000', '0xseaport');
    assert(!strict.isMint && !tracked.isMint);
    console.log('  ✅ Seaport efficient fulfill rejected');
}

console.log('Test 9: Gnosis Safe execTransaction rejected...');
{
    const data =
        '0x6a7612020000000000000000000000000000000000000000000000000000000000000020' +
        '0000000000000000000000000000000000000000000000000000000000000040';
    const tracked = classifyTrackedWalletTx(data, '0', '0xsafe');
    assert(!tracked.isMint);
    console.log('  ✅ Safe exec rejected');
}

console.log('Test 10: Random short 0 ETH call not treated as mint...');
{
    const tracked = classifyTrackedWalletTx('0xdeadbeef0000000001', '0', '0xcontract');
    assert(!tracked.isMint);
    console.log('  ✅ spurious 0 ETH call rejected');
}

console.log('\n✅ All mint classifier tests passed.\n');
