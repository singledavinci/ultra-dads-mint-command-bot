/**
 * Minted NFT report helpers
 * Run: npx tsx tests/mintedNftReport.test.ts
 */
import assert from 'node:assert';
import { extractMintedTokensFromReceipt } from '../src/services/mintedNftReport';

console.log('Test 1: extract Transfer mint from receipt logs...');
{
    const tokenId = 42n;
    const contract = '0x460d7dfa7aefb52ddb7b87a767485325b31272d9';
    const to = '0x1111111111111111111111111111111111111111';
    const { Interface } = await import('ethers');
    const iface = new Interface([
        'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    ]);
    const encoded = iface.encodeEventLog('Transfer', [
        '0x0000000000000000000000000000000000000000',
        to,
        tokenId,
    ]);

    const receipt = {
        hash: '0xabc',
        logs: [
            {
                address: contract,
                topics: encoded.topics as string[],
                data: encoded.data,
            },
        ],
    };

    const minted = extractMintedTokensFromReceipt(receipt as any, {
        contractHint: contract,
        recipientHint: to,
    });
    assert.strictEqual(minted.length, 1);
    assert.strictEqual(minted[0].tokenId, '42');
    assert.strictEqual(minted[0].to, to);
    console.log('  ✅ Transfer parsed');
}

console.log('Test 2: premium global report is aggregated (no per-user dump)...');
{
    const { formatCompactGlobalMintReport } = await import('../src/services/mintedNftReport.js');
    const msg = formatCompactGlobalMintReport({
        collectionName: 'SeaDrop',
        collectionSymbol: 'DROP',
        contract: '0x00000000000001ad428e4906ae943a6d5e6f53d3',
        successCount: 31,
        failCount: 152,
        walletTotal: 183,
        participantCount: 42,
        tokens: [{ contract: '0xabc', tokenId: '1', to: '0x1', txHash: '0xtx' }],
        valueEth: '0',
    });
    assert(!msg.includes('✓'), 'should not use checkmark clutter');
    assert(!msg.includes('4147'), 'should not list user ids');
    assert(msg.includes('Partial'), 'partial status when mixed results');
    assert(msg.includes('17% hit rate'), 'hit rate shown');
    assert(msg.includes('42 users'), 'participant count');
    assert(msg.includes('Wallet-level detail'), 'failures point to DMs');
    console.log('  ✅ premium global format');
}

console.log('Test 3: global report shows minting user...');
{
    const { formatCompactGlobalMintReport } = await import('../src/services/mintedNftReport.js');
    const msg = formatCompactGlobalMintReport({
        collectionName: 'Test',
        contract: '0xabc',
        successCount: 1,
        failCount: 0,
        walletTotal: 1,
        participantCount: 1,
        tokens: [],
        mintedByLabel: 'Mint by @alice',
    });
    assert(msg.includes('@alice'), 'setter label');
    console.log('  ✅ minted-by label');
}

console.log('\n✅ All minted NFT report tests passed.\n');
