/**
 * Mint Price Detector — queries on-chain price functions to determine mint cost.
 *
 * Tries common price getter patterns used by ERC721/721A contracts:
 *   price(), mintPrice(), cost(), PRICE(), getPrice(), mintFee(),
 *   publicPrice(), MINT_PRICE(), pricePerToken()
 *
 * Also attempts to simulate a mint(1) call with increasing values to find
 * the minimum accepted payment.
 *
 * All RPC is paced + retried to survive strict limits (e.g. 15 req/s tiers).
 */

import { JsonRpcProvider, Contract, formatEther, parseEther, AbiCoder } from 'ethers';
import { rpcRetry, sleepRpcGap, withSerializedRpc } from './rpcLimiter';

export interface DetectedMintInfo {
    price: bigint;
    priceEth: string;
    priceSource: string;
    mintSelector: string;
    mintFunctionName: string;
    totalSupply?: string;
    maxSupply?: string;
    isSoldOut: boolean;
    confidence: 'high' | 'medium' | 'low';
}

const PRICE_ABI = [
    'function price() view returns (uint256)',
    'function mintPrice() view returns (uint256)',
    'function cost() view returns (uint256)',
    'function PRICE() view returns (uint256)',
    'function getPrice() view returns (uint256)',
    'function mintFee() view returns (uint256)',
    'function publicPrice() view returns (uint256)',
    'function MINT_PRICE() view returns (uint256)',
    'function pricePerToken() view returns (uint256)',
    'function tokenPrice() view returns (uint256)',
    'function getMintPrice() view returns (uint256)',
];

const SUPPLY_ABI = [
    'function totalSupply() view returns (uint256)',
    'function maxSupply() view returns (uint256)',
    'function MAX_SUPPLY() view returns (uint256)',
    'function maxTokens() view returns (uint256)',
];

const MINT_FUNCTIONS = [
    { name: 'freeMint()', selector: '0x5b70ea9f', hasQty: false },
    { name: 'mint(uint256)', selector: '0xa0712d68', hasQty: true },
    { name: 'mint()', selector: '0x1249c58b', hasQty: false },
    { name: 'publicMint(uint256)', selector: '0x2db11544', hasQty: true },
    { name: 'mint(address,uint256)', selector: '0x40c10f19', hasQty: true },
    { name: 'mint(uint256,bytes32[])', selector: '0xefef39a1', hasQty: true },
];

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_ADDRESS_TOPIC =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

const SELECTOR_FUNCTION_NAMES: Record<string, string> = {
    '0x5b70ea9f': 'freeMint()',
    '0x1249c58b': 'mint()',
    '0xa0712d68': 'mint(uint256)',
    '0x2db11544': 'publicMint(uint256)',
    '0x40c10f19': 'mint(address,uint256)',
    '0xefef39a1': 'mint(uint256,bytes32[])',
};

export const FREE_MINT_SELECTOR = '0x5b70ea9f';

export interface RecentDirectMintPattern {
    selector: string;
    functionName: string;
    hasQuantityArg: boolean;
    sampleCount: number;
}

function fallbackLogProviders(): JsonRpcProvider[] {
    const urls = new Set<string>();
    for (const part of (process.env.PROVIDER_URL || '').split(',')) {
        const u = part.trim();
        if (u) urls.add(u);
    }
    urls.add('https://ethereum.publicnode.com');
    return [...urls].map(
        url => new JsonRpcProvider(url, 1, { staticNetwork: true, batchMaxCount: 1 })
    );
}

const DIRECT_MINT_CACHE_MS = parseInt(process.env.DIRECT_MINT_CACHE_MS || '120000', 10);
const DIRECT_MINT_LOG_TIMEOUT_MS = parseInt(process.env.DIRECT_MINT_LOG_TIMEOUT_MS || '12000', 10);
const directMintPatternCache = new Map<string, { at: number; value: RecentDirectMintPattern | null }>();

async function withRpcTimeout<T>(promise: Promise<T>, label: string): Promise<T | null> {
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`${label} timeout`)), DIRECT_MINT_LOG_TIMEOUT_MS)
            ),
        ]);
    } catch {
        return null;
    }
}

async function scanDirectMintLogs(
    contractAddress: string,
    provider: JsonRpcProvider,
    lookbackBlocks: number
): Promise<RecentDirectMintPattern | null> {
    const contract = contractAddress.toLowerCase();
    const block = await pacedCall('directMint/blockNumber', async () => provider.getBlockNumber());
    const fromBlock = Math.max(0, block - lookbackBlocks);

    const logs = await withRpcTimeout(
        pacedCall(`directMint/mintLogs/${lookbackBlocks}`, async () =>
            provider.getLogs({
                address: contractAddress,
                fromBlock,
                toBlock: block,
                topics: [TRANSFER_TOPIC, ZERO_ADDRESS_TOPIC],
            })
        ),
        `getLogs/${lookbackBlocks}`
    );
    if (!logs?.length) return null;

    if (!logs.length) return null;

    const selectorMeta = new Map<string, { count: number; hasArgs: boolean }>();
    const seenTx = new Set<string>();
    let directSamples = 0;

    for (let i = logs.length - 1; i >= 0 && directSamples < 10; i--) {
        const txHash = logs[i].transactionHash;
        if (seenTx.has(txHash)) continue;
        seenTx.add(txHash);

        const tx = await withRpcTimeout(
            pacedCall(`directMint/tx/${txHash.slice(0, 10)}`, async () =>
                provider.getTransaction(txHash)
            ),
            'getTransaction'
        );
        if (!tx) continue;
        if (!tx?.to || tx.to.toLowerCase() !== contract) continue;
        if (!tx.data || tx.data.length < 10) continue;

        directSamples++;
        const selector = tx.data.slice(0, 10).toLowerCase();
        const prev = selectorMeta.get(selector) || { count: 0, hasArgs: false };
        selectorMeta.set(selector, {
            count: prev.count + 1,
            hasArgs: prev.hasArgs || tx.data.length > 10,
        });
    }

    if (!directSamples) return null;

    let bestSelector = '';
    let bestCount = 0;
    let bestHasArgs = false;
    for (const [sel, meta] of selectorMeta) {
        if (meta.count > bestCount) {
            bestCount = meta.count;
            bestSelector = sel;
            bestHasArgs = meta.hasArgs;
        }
    }

    const functionName = SELECTOR_FUNCTION_NAMES[bestSelector] || `unknown(${bestSelector})`;

    return {
        selector: bestSelector,
        functionName,
        hasQuantityArg: bestHasArgs,
        sampleCount: bestCount,
    };
}

/** True when recent mint txs call the NFT contract directly (not SeaDrop router). */
export async function detectRecentDirectMintPattern(
    contractAddress: string,
    provider: JsonRpcProvider
): Promise<RecentDirectMintPattern | null> {
    const cacheKey = contractAddress.toLowerCase();
    const cached = directMintPatternCache.get(cacheKey);
    if (cached && Date.now() - cached.at < DIRECT_MINT_CACHE_MS) {
        return cached.value;
    }

    let hit: RecentDirectMintPattern | null = null;
    for (const lookback of [2_500, 6_000]) {
        hit = await scanDirectMintLogs(contractAddress, provider, lookback);
        if (hit) break;
    }

    if (!hit) {
        const primaryUrl = (provider as { _getConnection?: () => { url?: string } })._getConnection?.()?.url;
        const fallback = fallbackLogProviders()[0];
        const fbUrl = (fallback as { _getConnection?: () => { url?: string } })._getConnection?.()?.url;
        if (fallback && primaryUrl !== fbUrl) {
            hit = await scanDirectMintLogs(contractAddress, fallback, 3_000);
        }
    }

    directMintPatternCache.set(cacheKey, { at: Date.now(), value: hit });
    return hit;
}

export function encodeDirectMintCalldata(selector: string, quantity: number): string {
    if (selector === '0x1249c58b' || selector === '0x5b70ea9f') {
        return selector;
    }
    const coder = AbiCoder.defaultAbiCoder();
    return selector + coder.encode(['uint256'], [quantity]).slice(2);
}

async function pacedCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return withSerializedRpc(async () => {
        await sleepRpcGap();
        return rpcRetry(fn, label);
    });
}

/**
 * Detect mint price and function for a contract.
 */
export async function detectMintInfo(
    contractAddress: string,
    provider: JsonRpcProvider,
    quantity: number = 1,
    simulateFrom?: string
): Promise<DetectedMintInfo | null> {
    const simFrom = simulateFrom || '0x0000000000000000000000000000000000000001';
    const contract = new Contract(contractAddress, [...PRICE_ABI, ...SUPPLY_ABI], provider);

    // 1. Try to read price from common getter functions
    let price: bigint | null = null;
    let priceSource = '';

    const priceFunctions = [
        'price', 'mintPrice', 'cost', 'PRICE', 'getPrice',
        'mintFee', 'publicPrice', 'MINT_PRICE', 'pricePerToken',
        'tokenPrice', 'getMintPrice',
    ];

    for (const fn of priceFunctions) {
        try {
            const result = await pacedCall(`linkMint/price.${fn}`, async () => contract[fn]());
            if (result !== undefined && result > 0n) {
                price = result as bigint;
                priceSource = `${fn}()`;
                break;
            }
        } catch {
            // Function doesn't exist or reverted — try next
        }
    }

    // 2. Get supply info
    let totalSupply: string | undefined;
    let maxSupply: string | undefined;

    try {
        totalSupply = (await pacedCall('linkMint/totalSupply', async () => contract.totalSupply())).toString();
    } catch { /* ignore */ }
    try {
        maxSupply = (await pacedCall('linkMint/maxSupply', async () => contract.maxSupply())).toString();
    } catch { /* ignore */ }
    if (!maxSupply) {
        try {
            maxSupply = (await pacedCall('linkMint/MAX_SUPPLY', async () => contract.MAX_SUPPLY())).toString();
        } catch { /* ignore */ }
    }

    // Check if sold out
    const isSoldOut = !!(totalSupply && maxSupply && BigInt(totalSupply) >= BigInt(maxSupply));

    // 3. Determine which mint function works
    let mintSelector = '0xa0712d68'; // default: mint(uint256)
    let mintFunctionName = 'mint(uint256)';
    const coder = new AbiCoder();
    const totalValue = price ? price * BigInt(quantity) : 0n;

    const recentDirect = await detectRecentDirectMintPattern(contractAddress, provider);
    if (recentDirect) {
        mintSelector = recentDirect.selector;
        mintFunctionName = recentDirect.functionName;
    }

    // Try simulating each mint function
    for (const fn of MINT_FUNCTIONS) {
        try {
            let calldata: string;
            if (fn.hasQty) {
                calldata = fn.selector + coder.encode(['uint256'], [quantity]).slice(2);
            } else {
                calldata = fn.selector;
            }

            await pacedCall(`linkMint/estimate.${fn.name}`, async () =>
                provider.estimateGas({
                    to: contractAddress,
                    data: calldata,
                    value: totalValue > 0n ? '0x' + totalValue.toString(16) : '0x0',
                    from: simFrom,
                })
            );

            mintSelector = fn.selector;
            mintFunctionName = fn.name;
            break;
        } catch {
            // Try next function
        }
    }

    // 4. If no price found via getters, try to detect via simulation with increasing values
    if (!price) {
        const testValues = [
            0n, parseEther('0.0001'), parseEther('0.001'), parseEther('0.005'),
            parseEther('0.01'), parseEther('0.02'), parseEther('0.05'), parseEther('0.08'), parseEther('0.1'),
        ];
        const calldata = encodeDirectMintCalldata(mintSelector, 1);

        for (const testValue of testValues) {
            try {
                await pacedCall(`linkMint/priceProbe/${testValue}`, async () =>
                    provider.estimateGas({
                        to: contractAddress,
                        data: calldata,
                        value: testValue > 0n ? '0x' + testValue.toString(16) : '0x0',
                        from: simFrom,
                    })
                );
                price = testValue;
                priceSource = `simulation (value=${formatEther(testValue)} ETH)`;
                break;
            } catch {
                // Value too low or function reverts — try higher
            }
        }
    }

    if (price === null) {
        return {
            price: 0n,
            priceEth: '0',
            priceSource: 'unknown (could not detect)',
            mintSelector,
            mintFunctionName,
            totalSupply,
            maxSupply,
            isSoldOut,
            confidence: 'low',
        };
    }

    return {
        price: price * BigInt(quantity),
        priceEth: formatEther(price * BigInt(quantity)),
        priceSource,
        mintSelector,
        mintFunctionName,
        totalSupply,
        maxSupply,
        isSoldOut,
        confidence: priceSource.includes('simulation') ? 'medium' : 'high',
    };
}
